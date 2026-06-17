//! # Custom Classes (Webflow-style, Tailwind-native)
//!
//! Phase 0 of the visual editor's custom-class feature: detection + read-only
//! listing. A custom class is a named rule in the project's entry stylesheet,
//! composed from the same Tailwind tokens the editor's controls already emit:
//!
//! ```css
//! @layer components {
//!   .btn-primary { @apply px-4 py-2 bg-blue-500 text-white rounded; }
//! }
//! ```
//!
//! Editing such a rule's `@apply` list updates every element carrying the class
//! at once — Webflow's edit-once-update-all, expressed natively in CSS.
//!
//! These commands only READ. Parsing is conservative: a rule we can't faithfully
//! round-trip (raw declarations mixed in, nested rules, multi-selector) is
//! reported as `editable: false` rather than guessed at — mirroring the
//! "fail instead of guess" ethos of [`super::i18n`].

use crate::errors::CommandError;
use crate::utils::validate_project_path;
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

/// Which Tailwind generation the project uses — decides where/how a custom
/// class is written (`@apply` is valid in both, but the entry file differs).
#[derive(Debug, Serialize, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum TailwindVersion {
    /// v3: `tailwind.config.*` + `@tailwind base/components/utilities` directives.
    V3,
    /// v4: CSS-first, `@import "tailwindcss"`.
    V4,
    /// No recognizable Tailwind setup found.
    None,
}

/// Where and how custom classes can be managed in this project.
#[derive(Debug, Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TailwindSetup {
    pub version: TailwindVersion,
    /// POSIX-relative path to the stylesheet that imports Tailwind — the file an
    /// `@apply`-based class must live in (or `@reference`) to compile. `None`
    /// when no entry stylesheet could be located.
    pub entry_css: Option<String>,
    /// Whether `entry_css` already contains a writable `@layer components { … }`
    /// block (so Phase 1 appends to it rather than creating one).
    pub components_layer: bool,
}

/// One custom class parsed from the entry stylesheet.
#[derive(Debug, Serialize, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CustomClass {
    /// Class name without the leading dot (e.g. `btn-primary`).
    pub name: String,
    /// The utility tokens in its `@apply` list, in source order.
    pub tokens: Vec<String>,
    /// True when the rule is a pure `@apply` list we can round-trip safely.
    /// False when it mixes raw declarations or nested rules (Phase 2 / AI).
    pub editable: bool,
}

// ───────────────────────────── Commands ─────────────────────────────────────

/// Detect the project's Tailwind generation and locate the entry stylesheet
/// where custom classes should live.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub fn detect_tailwind_setup(project_path: String) -> Result<TailwindSetup, CommandError> {
    let root = validate_project_path(&project_path)?;
    Ok(detect_setup_at(&root))
}

/// List the custom classes defined in the project's entry stylesheet. Read-only:
/// returns `[]` when there's no entry stylesheet or it can't be read.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub fn list_custom_classes(project_path: String) -> Result<Vec<CustomClass>, CommandError> {
    let root = validate_project_path(&project_path)?;
    let setup = detect_setup_at(&root);
    let Some(entry) = setup.entry_css else {
        return Ok(vec![]);
    };
    let Ok(css) = std::fs::read_to_string(root.join(&entry)) else {
        return Ok(vec![]);
    };
    Ok(parse_custom_classes(&css))
}

// ───────────────────────── Setup detection ──────────────────────────────────

fn detect_setup_at(root: &Path) -> TailwindSetup {
    // Scan project CSS once, bucketing files by the entry signal they carry.
    // `@import "tailwindcss"` is the definitive v4 marker; `@tailwind` directives
    // are the v3 marker. The `ignore` walker skips node_modules/.next/.git.
    let mut v4_entries: Vec<PathBuf> = Vec::new();
    let mut v3_entries: Vec<PathBuf> = Vec::new();
    for entry in ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .build()
        .flatten()
    {
        let path = entry.path();
        let is_css = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("css"))
            .unwrap_or(false);
        if !is_css {
            continue;
        }
        if let Ok(css) = std::fs::read_to_string(path) {
            if css_imports_tailwind(&css) {
                v4_entries.push(path.to_path_buf());
            } else if css_has_tailwind_directive(&css) {
                v3_entries.push(path.to_path_buf());
            }
        }
    }

    let has_v3_config = [
        "tailwind.config.js",
        "tailwind.config.ts",
        "tailwind.config.cjs",
        "tailwind.config.mjs",
    ]
    .iter()
    .any(|n| root.join(n).exists());

    // Prefer the shallowest, then lexicographically-first candidate — the global
    // entry stylesheet (e.g. `src/index.css`) over a deeply-nested component CSS.
    let pick = |mut v: Vec<PathBuf>| -> Option<PathBuf> {
        v.sort_by_key(|p| (p.components().count(), p.to_string_lossy().into_owned()));
        v.into_iter().next()
    };

    let (version, entry_abs) = if !v4_entries.is_empty() {
        (TailwindVersion::V4, pick(v4_entries))
    } else if !v3_entries.is_empty() {
        (TailwindVersion::V3, pick(v3_entries))
    } else if has_v3_config {
        // Config present but no parseable entry CSS — still v3, just can't locate
        // the entry stylesheet for write-back.
        (TailwindVersion::V3, None)
    } else {
        (TailwindVersion::None, None)
    };

    let components_layer = entry_abs
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|css| has_components_layer(&css))
        .unwrap_or(false);

    TailwindSetup {
        version,
        entry_css: entry_abs.map(|abs| rel_posix(root, &abs)),
        components_layer,
    }
}

fn rel_posix(root: &Path, abs: &Path) -> String {
    abs.strip_prefix(root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

/// True if any code-level `@import` statement references `tailwindcss` (the v4
/// entry signal). Bracket/quote forms both work since we just scan the statement.
fn css_imports_tailwind(css: &str) -> bool {
    let kind = css_scan(css);
    let mut from = 0;
    while let Some(rel) = css[from..].find("@import") {
        let at = from + rel;
        from = at + "@import".len();
        if kind[at] != CssKind::Code {
            continue;
        }
        let end = css[at..]
            .find(';')
            .map(|e| at + e)
            .unwrap_or_else(|| css.len());
        if css[at..end].contains("tailwindcss") {
            return true;
        }
    }
    false
}

/// True if a code-level `@tailwind` directive is present (the v3 entry signal).
fn css_has_tailwind_directive(css: &str) -> bool {
    let kind = css_scan(css);
    let mut from = 0;
    while let Some(rel) = css[from..].find("@tailwind") {
        let at = from + rel;
        from = at + "@tailwind".len();
        if kind[at] == CssKind::Code {
            return true;
        }
    }
    false
}

/// True if the stylesheet contains a `@layer components { … }` BLOCK (not just a
/// `@layer a, components, b;` declaration list).
fn has_components_layer(css: &str) -> bool {
    let kind = css_scan(css);
    let bytes = css.as_bytes();
    let mut from = 0;
    while let Some(rel) = css[from..].find("@layer") {
        let at = from + rel;
        from = at + "@layer".len();
        if kind[at] != CssKind::Code {
            continue;
        }
        // Walk to the statement terminator: `{` (a block) or `;` (a declaration).
        let mut j = at + "@layer".len();
        while j < bytes.len()
            && !(kind[j] == CssKind::Code && (bytes[j] == b'{' || bytes[j] == b';'))
        {
            j += 1;
        }
        if j < bytes.len() && bytes[j] == b'{' {
            let names = &css[at + "@layer".len()..j];
            if names
                .split([',', ' ', '\t', '\n', '\r'])
                .any(|n| n.trim() == "components")
            {
                return true;
            }
        }
    }
    false
}

// ───────────────────────── CSS scanning (pure) ──────────────────────────────

/// Byte classification for a comment/string-aware pass over CSS. CSS has only
/// block comments (`/* */`) and single/double-quoted strings — no line comments
/// or template literals — so this is simpler than the JS scanner in [`super::i18n`].
#[derive(Clone, Copy, PartialEq, Debug)]
enum CssKind {
    Code,
    Comment,
    Str,
}

fn css_scan(src: &str) -> Vec<CssKind> {
    let bytes = src.as_bytes();
    let mut kind = vec![CssKind::Code; bytes.len()];
    let mut i = 0;
    let mut in_str: Option<u8> = None;
    let mut in_comment = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_comment {
            kind[i] = CssKind::Comment;
            if c == b'*' && bytes.get(i + 1) == Some(&b'/') {
                kind[i + 1] = CssKind::Comment;
                in_comment = false;
                i += 2;
                continue;
            }
        } else if let Some(q) = in_str {
            kind[i] = CssKind::Str;
            if c == b'\\' {
                if i + 1 < bytes.len() {
                    kind[i + 1] = CssKind::Str;
                }
                i += 2;
                continue;
            }
            // CSS strings can't span unescaped newlines — recover so a stray
            // quote doesn't swallow the rest of the file.
            if c == q || c == b'\n' {
                in_str = None;
            }
        } else {
            match c {
                b'/' if bytes.get(i + 1) == Some(&b'*') => {
                    in_comment = true;
                    kind[i] = CssKind::Comment;
                }
                b'"' | b'\'' => {
                    in_str = Some(c);
                    kind[i] = CssKind::Str;
                }
                _ => {}
            }
        }
        i += 1;
    }
    kind
}

/// The innermost code-level `{` enclosing byte `pos`, or `None` at top level.
fn enclosing_open_brace(bytes: &[u8], kind: &[CssKind], pos: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut i = pos;
    while i > 0 {
        i -= 1;
        if kind[i] != CssKind::Code {
            continue;
        }
        match bytes[i] {
            b'}' => depth += 1,
            b'{' => {
                if depth == 0 {
                    return Some(i);
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    None
}

/// The code-level `}` matching the `{` at `open`.
fn match_brace(bytes: &[u8], kind: &[CssKind], open: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut i = open;
    while i < bytes.len() {
        if kind[i] == CssKind::Code {
            match bytes[i] {
                b'{' => depth += 1,
                b'}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(i);
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

/// Bytes of `s` that aren't inside comments, as a lossy string. Used to read a
/// selector prelude or `@apply` value without comment noise.
fn code_text(s: &str, kind: &[CssKind]) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    for (i, &b) in bytes.iter().enumerate() {
        if kind[i] != CssKind::Comment {
            out.push(b);
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The selector text immediately preceding the rule body that opens at `open`
/// (back to the previous code-level `}`, `{`, or `;`), comments stripped.
fn selector_prelude(css: &str, kind: &[CssKind], open: usize) -> String {
    let bytes = css.as_bytes();
    let mut start = open;
    while start > 0 {
        let i = start - 1;
        if kind[i] == CssKind::Code && matches!(bytes[i], b'}' | b'{' | b';') {
            break;
        }
        start -= 1;
    }
    code_text(&css[start..open], &kind[start..open])
        .trim()
        .to_string()
}

/// If `prelude` is exactly one simple class selector (`.name`), return `name`.
/// Rejects combinators, commas, pseudo-classes, combos (`.a.b`), tag-qualified
/// (`div.a`) — anything we can't treat as a standalone managed class.
fn single_class_name(prelude: &str) -> Option<String> {
    let rest = prelude.trim().strip_prefix('.')?;
    let mut chars = rest.chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_' || first == '-') {
        return None;
    }
    if !rest
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return None;
    }
    Some(rest.to_string())
}

/// Parse a rule body into its `@apply` tokens and whether it's a pure `@apply`
/// rule (editable) vs. one mixing raw declarations / nested rules (not).
fn parse_rule_body(body: &str, kind: &[CssKind]) -> (Vec<String>, bool) {
    let bytes = body.as_bytes();
    let mut tokens = Vec::new();
    let mut consumed = vec![false; bytes.len()];

    let mut from = 0;
    while let Some(rel) = body[from..].find("@apply") {
        let at = from + rel;
        from = at + "@apply".len();
        if kind[at] != CssKind::Code {
            continue;
        }
        // Value runs to the next code-level `;` outside any [] / () group
        // (arbitrary tokens like `[content:';']` keep their semicolons).
        let val_start = at + "@apply".len();
        let mut j = val_start;
        let mut group = 0i32;
        while j < bytes.len() {
            if kind[j] == CssKind::Code {
                match bytes[j] {
                    b'[' | b'(' => group += 1,
                    b']' | b')' => group -= 1,
                    b';' if group <= 0 => break,
                    _ => {}
                }
            }
            j += 1;
        }
        let value = code_text(&body[val_start..j], &kind[val_start..j]);
        tokens.extend(value.split_whitespace().map(|t| t.to_string()));
        let end = (j + 1).min(bytes.len()); // include the terminating ';'
        for c in consumed.iter_mut().take(end).skip(at) {
            *c = true;
        }
        from = end;
    }

    // Editable iff every code byte outside the @apply statements is insignificant
    // (whitespace or a stray semicolon). Any real declaration or nested `{` block
    // means we can't round-trip the rule safely.
    let editable = bytes.iter().enumerate().all(|(i, &b)| {
        consumed[i] || kind[i] != CssKind::Code || b.is_ascii_whitespace() || b == b';'
    });

    (tokens, editable)
}

/// Parse every simple `.class { … }` rule (at any nesting depth, e.g. inside
/// `@layer components`) that carries an `@apply`. First definition of a given
/// name wins; later redefinitions are ignored.
fn parse_custom_classes(css: &str) -> Vec<CustomClass> {
    let kind = css_scan(css);
    let bytes = css.as_bytes();
    let mut out: Vec<CustomClass> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut from = 0;
    while let Some(rel) = css[from..].find("@apply") {
        let at = from + rel;
        from = at + "@apply".len();
        if kind[at] != CssKind::Code {
            continue;
        }
        let Some(open) = enclosing_open_brace(bytes, &kind, at) else {
            continue;
        };
        let Some(name) = single_class_name(&selector_prelude(css, &kind, open)) else {
            continue;
        };
        let Some(close) = match_brace(bytes, &kind, open) else {
            continue;
        };
        let (tokens, editable) = parse_rule_body(&css[open + 1..close], &kind[open + 1..close]);
        if seen.insert(name.clone()) {
            out.push(CustomClass {
                name,
                tokens,
                editable,
            });
        }
        // Skip the rest of this rule so a second @apply inside it isn't reprocessed.
        from = close;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // ───────────── CSS class parsing ─────────────

    #[test]
    fn parses_a_pure_apply_rule_in_components_layer() {
        let css = r#"
@import "tailwindcss";
@layer components {
  .btn-primary { @apply px-4 py-2 bg-blue-500 text-white rounded; }
}
"#;
        let classes = parse_custom_classes(css);
        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].name, "btn-primary");
        assert_eq!(
            classes[0].tokens,
            vec!["px-4", "py-2", "bg-blue-500", "text-white", "rounded"]
        );
        assert!(classes[0].editable);
    }

    #[test]
    fn parses_top_level_rule_without_a_layer() {
        let css = ".card { @apply rounded-lg shadow p-6; }";
        let classes = parse_custom_classes(css);
        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].name, "card");
        assert_eq!(classes[0].tokens, vec!["rounded-lg", "shadow", "p-6"]);
        assert!(classes[0].editable);
    }

    #[test]
    fn parses_multiline_prettier_formatting() {
        let css = r#"
@layer components {
  .btn {
    @apply px-4
      py-2
      rounded;
  }
}
"#;
        let classes = parse_custom_classes(css);
        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].tokens, vec!["px-4", "py-2", "rounded"]);
        assert!(classes[0].editable);
    }

    #[test]
    fn keeps_arbitrary_value_tokens_intact() {
        // Arbitrary tokens carry colons/parens/brackets but no top-level `;`.
        let css = r#".hero { @apply bg-[#1a3c5e] [clip-path:circle(50%)] text-white; }"#;
        let classes = parse_custom_classes(css);
        assert_eq!(
            classes[0].tokens,
            vec!["bg-[#1a3c5e]", "[clip-path:circle(50%)]", "text-white"]
        );
        assert!(classes[0].editable);
    }

    #[test]
    fn flags_rule_with_raw_declarations_as_not_editable() {
        let css = r#".btn { @apply px-4 py-2; color: red; }"#;
        let classes = parse_custom_classes(css);
        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].name, "btn");
        // Tokens still surface for display, but it's not safe to round-trip.
        assert_eq!(classes[0].tokens, vec!["px-4", "py-2"]);
        assert!(!classes[0].editable);
    }

    #[test]
    fn ignores_multi_selector_and_qualified_rules() {
        let css = r#"
.a, .b { @apply p-2; }
div.card { @apply p-4; }
.parent .child { @apply p-1; }
.btn:hover { @apply underline; }
"#;
        // None of these is a standalone managed class.
        assert!(parse_custom_classes(css).is_empty());
    }

    #[test]
    fn ignores_apply_inside_comments() {
        let css = r#"
/* .old { @apply p-8; } */
.real { @apply p-2; }
"#;
        let classes = parse_custom_classes(css);
        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].name, "real");
    }

    #[test]
    fn first_definition_wins_on_duplicate_names() {
        let css = r#"
.btn { @apply p-2; }
.btn { @apply p-8 m-4; }
"#;
        let classes = parse_custom_classes(css);
        assert_eq!(classes.len(), 1);
        assert_eq!(classes[0].tokens, vec!["p-2"]);
    }

    #[test]
    fn handles_multiple_classes_and_a_nested_at_rule() {
        let css = r#"
@layer components {
  .btn { @apply px-4 py-2; }
  .card { @apply rounded shadow; }
}
@media (min-width: 768px) {
  .btn-lg { @apply px-8 py-4; }
}
"#;
        let classes = parse_custom_classes(css);
        let names: Vec<&str> = classes.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, vec!["btn", "card", "btn-lg"]);
    }

    #[test]
    fn empty_when_no_apply_rules() {
        let css = ".btn { color: red; padding: 1rem; }";
        assert!(parse_custom_classes(css).is_empty());
    }

    // ───────────── Entry-signal detection ─────────────

    #[test]
    fn detects_v4_import_and_v3_directive_signals() {
        assert!(css_imports_tailwind(r#"@import "tailwindcss";"#));
        assert!(css_imports_tailwind("@import 'tailwindcss';"));
        assert!(css_imports_tailwind(
            r#"@import "tailwindcss/preflight" layer(base);"#
        ));
        assert!(!css_imports_tailwind(r#"@import "./other.css";"#));
        assert!(!css_imports_tailwind(r#"/* @import "tailwindcss"; */"#));

        assert!(css_has_tailwind_directive(
            "@tailwind base;\n@tailwind utilities;"
        ));
        assert!(!css_has_tailwind_directive("/* @tailwind base; */"));
        assert!(!css_has_tailwind_directive(".btn { color: red; }"));
    }

    #[test]
    fn detects_components_layer_block_but_not_declaration() {
        assert!(has_components_layer(
            "@layer components { .a { @apply p-2; } }"
        ));
        assert!(has_components_layer(
            "@layer base, components, utilities { }"
        ));
        // A bare layer-order declaration is not a writable block.
        assert!(!has_components_layer(
            "@layer theme, base, components, utilities;"
        ));
        assert!(!has_components_layer(
            "@layer utilities { .x { @apply p-1; } }"
        ));
    }

    // ───────────── Setup detection (filesystem) ─────────────

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ss-cc-{}-{}-{}",
            name,
            std::process::id(),
            // Disambiguate parallel tests in the same process.
            name.len()
        ));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn setup_detects_v4_entry_and_layer() {
        let dir = tmp("v4");
        std::fs::create_dir_all(dir.join("src")).unwrap();
        std::fs::write(
            dir.join("src/index.css"),
            "@import \"tailwindcss\";\n@layer components { .btn { @apply p-2; } }",
        )
        .unwrap();
        let setup = detect_setup_at(&dir);
        assert_eq!(setup.version, TailwindVersion::V4);
        assert_eq!(setup.entry_css.as_deref(), Some("src/index.css"));
        assert!(setup.components_layer);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn setup_detects_v3_directive_entry() {
        let dir = tmp("v3");
        std::fs::write(dir.join("tailwind.config.js"), "module.exports = {}").unwrap();
        std::fs::write(
            dir.join("globals.css"),
            "@tailwind base;\n@tailwind components;\n@tailwind utilities;",
        )
        .unwrap();
        let setup = detect_setup_at(&dir);
        assert_eq!(setup.version, TailwindVersion::V3);
        assert_eq!(setup.entry_css.as_deref(), Some("globals.css"));
        assert!(!setup.components_layer);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn setup_prefers_shallowest_entry_candidate() {
        let dir = tmp("shallow");
        std::fs::create_dir_all(dir.join("src/styles/deep")).unwrap();
        std::fs::write(dir.join("app.css"), "@import \"tailwindcss\";").unwrap();
        std::fs::write(
            dir.join("src/styles/deep/extra.css"),
            "@import \"tailwindcss\";",
        )
        .unwrap();
        let setup = detect_setup_at(&dir);
        assert_eq!(setup.entry_css.as_deref(), Some("app.css"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn setup_reports_none_without_tailwind() {
        let dir = tmp("none");
        std::fs::write(dir.join("styles.css"), ".btn { color: red; }").unwrap();
        let setup = detect_setup_at(&dir);
        assert_eq!(setup.version, TailwindVersion::None);
        assert_eq!(setup.entry_css, None);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn setup_v3_config_without_locatable_entry() {
        let dir = tmp("v3-noentry");
        std::fs::write(dir.join("tailwind.config.ts"), "export default {}").unwrap();
        let setup = detect_setup_at(&dir);
        assert_eq!(setup.version, TailwindVersion::V3);
        assert_eq!(setup.entry_css, None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
