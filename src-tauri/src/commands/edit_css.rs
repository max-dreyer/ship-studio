//! # Visual editor — CSS Mode (class-based rule editing for HTML/CSS projects)
//!
//! A second style engine for the visual editor. Where the Tailwind path
//! (`edit.rs`) mutates the *class-attribute string* with utility tokens, CSS
//! Mode edits the **CSS rule** a class points at — `padding: 24px`, any
//! property, any value — and writes it surgically back into the stylesheet.
//!
//! ## Reliability via convention, not heroic parsing
//! We do not try to robustly handle arbitrary CSS. We narrow the input space to
//! a convention (external, class-based stylesheets; one rule per editable class;
//! a fixed `@media (min-width: …)` breakpoint set) and an out-of-band agent prep
//! prompt conforms off-spec projects into it. The engine here is therefore
//! **strict and fail-closed**: when the source doesn't match the convention it
//! returns a typed status (`Multiple`, `NotFound`, `Inline`, `NeedsClass`) and
//! refuses to guess — it never silently writes the wrong rule.
//!
//! ## Locator, not a parser
//! A heavyweight CSS parser reserializes whole files, which kills minimal-diff
//! edits and trashes formatting/comments. Instead we hand-roll a small,
//! comment/string/brace-aware locator that records, for each style rule, its
//! selector, the byte span of its declaration block, the source line, and the
//! enclosing `@media` prelude. Writes are then surgical span replacements,
//! preserving everything else byte-for-byte — the same philosophy as `i18n.rs`.
//!
//! See `docs/visual-editor-css-mode.md` for the full design and phasing.

use crate::commands::edit::Location;
use crate::errors::CommandError;
use crate::utils::validate_project_path;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

/// Skip stylesheets larger than this (bytes) — almost certainly generated /
/// minified bundles, not hand-authored convention-conforming CSS.
const MAX_CSS_BYTES: u64 = 2 * 1024 * 1024;

/// How long a parsed-stylesheets snapshot stays fresh. Resolving runs on every
/// element select / edit; without this each one re-walks, re-reads, and re-parses
/// the whole project. Matches the Tailwind index TTL (`edit::INDEX_TTL`) so the
/// CSS editor is as snappy. Writes invalidate the entry so edits are seen at once.
const SHEET_CACHE_TTL: Duration = Duration::from_secs(10);

/// A discovered stylesheet with its rules pre-indexed. Caching the parsed rules
/// (not just the raw text) means a click resolves against memory — no re-walk,
/// re-read, or re-parse — the same shape as the Tailwind editor's `Arc`-cached
/// occurrence index.
#[derive(Clone)]
struct SheetIndex {
    rel: String,
    content: String,
    rules: Vec<RuleSpan>,
}

impl SheetIndex {
    fn parse(rel: String, content: String) -> Self {
        let rules = index_rules(&content);
        Self {
            rel,
            content,
            rules,
        }
    }
}

#[allow(clippy::type_complexity)]
static SHEET_CACHE: LazyLock<Mutex<HashMap<PathBuf, (Instant, Arc<Vec<SheetIndex>>)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Parsed, cached stylesheets for `root`. Returns a cheap `Arc` clone on a hit;
/// only a cold miss walks + parses.
fn cached_sheets(root: &Path) -> Arc<Vec<SheetIndex>> {
    if let Ok(cache) = SHEET_CACHE.lock() {
        if let Some((at, sheets)) = cache.get(root) {
            if at.elapsed() < SHEET_CACHE_TTL {
                return sheets.clone();
            }
        }
    }
    let sheets = Arc::new(
        discover_stylesheets(root)
            .into_iter()
            .map(|(rel, content)| SheetIndex::parse(rel, content))
            .collect::<Vec<_>>(),
    );
    if let Ok(mut cache) = SHEET_CACHE.lock() {
        cache.insert(root.to_path_buf(), (Instant::now(), sheets.clone()));
    }
    sheets
}

/// Drop the cached snapshot for `root` after a write, so the next resolve reads
/// the just-saved CSS.
fn invalidate_sheet_cache(root: &Path) {
    if let Ok(mut cache) = SHEET_CACHE.lock() {
        cache.remove(root);
    }
}

// ───────────────────────────── Types ─────────────────────────────

/// A single CSS declaration (`property: value`), as reported to / from the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Declaration {
    pub property: String,
    pub value: String,
    #[serde(default)]
    pub important: bool,
}

/// Signature of the clicked element for CSS resolution. camelCase to match the
/// in-iframe selection script's `postMessage` payload.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CssSignature {
    /// The element's full `class` attribute (may hold several tokens).
    pub class_name: String,
    /// Lowercased DOM tag name (reserved for future disambiguation).
    #[serde(default)]
    pub tag_name: String,
    /// Which class token the user means to edit. When absent we pick the sole
    /// token, or the last one (the most specific by convention).
    #[serde(default)]
    pub target_class: Option<String>,
    /// Whether the element carries an inline `style="…"` attribute. Drives the
    /// `Inline` status (managed styling should live in a class, not inline).
    #[serde(default)]
    pub has_inline_style: bool,
    /// A pseudo-class / state to target, without the leading colon (e.g.
    /// "hover", "focus", "focus-visible"). Appended to the class selector so the
    /// editor resolves `.class:hover` — states ARE selectors in CSS.
    #[serde(default)]
    pub pseudo: Option<String>,
}

/// Whether a pseudo selector is safe to append (any state CSS allows — simple
/// `:hover`, functional `:nth-child(2n+1)`, `:not(.x)`, pseudo-elements
/// `::before`) while forbidding structural chars that could break out of the
/// selector (`{`, `}`, `;`). Must start with `:`, have balanced parens, and
/// contain a letter.
fn is_safe_pseudo(s: &str) -> bool {
    if !s.starts_with(':') {
        return false;
    }
    let mut depth = 0i32;
    let mut saw_alpha = false;
    for c in s.chars() {
        match c {
            ':' | '-' | '_' | '+' | '.' | '#' | '%' => {}
            // `,` and ` ` group/combine selectors — only legal inside a
            // functional pseudo (`:is(.a, .b)`, `:not(.x .y)`). At the top level
            // they'd break out of the appended selector.
            ',' | ' ' if depth > 0 => {}
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            c if c.is_ascii_alphanumeric() => {
                if c.is_ascii_alphabetic() {
                    saw_alpha = true;
                }
            }
            _ => return false,
        }
    }
    depth == 0 && saw_alpha
}

/// The sanitized pseudo suffix for a signature, or "" for the default state.
/// The pseudo may carry its own colon(s) (`::before`); a bare name gets one.
fn pseudo_suffix(sig: &CssSignature) -> String {
    match sig.pseudo.as_deref() {
        Some(p) => {
            let t = p.trim();
            if t.is_empty() {
                return String::new();
            }
            let with_colon = if t.starts_with(':') {
                t.to_string()
            } else {
                format!(":{t}")
            };
            if is_safe_pseudo(&with_colon) {
                with_colon
            } else {
                String::new()
            }
        }
        None => String::new(),
    }
}

/// Result of resolving an element to a CSS rule.
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CssResolution {
    /// Exactly one rule defines this class at the requested breakpoint.
    Resolved {
        /// Project-relative POSIX stylesheet path.
        file: String,
        /// The class selector we resolved (e.g. `.hero-title`).
        selector: String,
        /// 1-based line of the rule's selector.
        line: usize,
        /// The `min-width` of the enclosing `@media`, if any.
        media_min_px: Option<u32>,
        /// The rule's current declarations.
        declarations: Vec<Declaration>,
    },
    /// The class is defined by more than one rule — read-only, never guessed.
    Multiple {
        selector: String,
        locations: Vec<Location>,
    },
    /// The element is styled via an inline `style` attribute, not a class.
    Inline { reason: String },
    /// The element has no class to anchor a rule to (offer "create class").
    NeedsClass { reason: String },
    /// The class exists but no rule defines it yet (offer "create rule").
    NotFound { selector: String },
}

/// One matching rule reported by the in-iframe cascade walker, to be mapped back
/// to its source location. camelCase to match the `ss:cascade` postMessage shape.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchedRuleQuery {
    /// The (normalized) compound selector the browser matched, e.g. `.btn--primary`
    /// or `#hero .btn`.
    pub selector: String,
    /// The enclosing media condition text (`(max-width: 768px)`), or null for a base
    /// rule. Matched against the source `@media` prelude so a min-width OR max-width
    /// (or any) media variant resolves to its OWN rule, not the base one.
    #[serde(default)]
    pub media_text: Option<String>,
    /// The served stylesheet URL (`rule.parentStyleSheet.href`), used only as a
    /// basename tie-breaker when the same selector lives in several files.
    #[serde(default)]
    pub href: Option<String>,
}

/// Where a cascade rule lives in source — the editable seam for the code panel.
/// Index-aligned with the `matched` input of [`locate_css_rules`].
#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RuleLocation {
    /// Pinned to exactly one source rule. `inner_text` is the verbatim text inside
    /// the braces — what the editor seeds from and drift-guards against.
    Resolved {
        /// Project-relative POSIX stylesheet path.
        file: String,
        /// 1-based line of the rule's selector.
        line: usize,
        /// Verbatim source between the rule's braces.
        inner_text: String,
    },
    /// The selector resolves to more than one source rule — read-only (we never
    /// guess which one the browser painted).
    Multiple { files: Vec<String> },
    /// No authored `.css` rule backs this match (UA / framework-injected / inline /
    /// unmappable scoped style) — read-only.
    NotFound,
}

/// One located style rule and the byte span of its declaration block.
#[derive(Debug, Clone, PartialEq)]
struct RuleSpan {
    /// Full selector prelude, trimmed (may be a comma group).
    selector: String,
    /// `@media` prelude (e.g. `(min-width: 768px)`) if nested, else `None`.
    media: Option<String>,
    /// Byte range of the enclosing `@media` condition text (for editing the at-rule),
    /// if the rule is inside one.
    media_prelude: Option<(usize, usize)>,
    /// Byte offset of the first significant byte of the selector (for delete/wrap,
    /// which need the rule's start, not just its block).
    selector_start: usize,
    /// Byte offset just inside the opening `{`.
    block_inner_start: usize,
    /// Byte offset of the closing `}`.
    block_inner_end: usize,
    /// 1-based line of the selector.
    selector_line: usize,
}

/// A located declaration within a rule's block, with byte offsets into the
/// original stylesheet so edits can be surgical.
#[derive(Debug, Clone, PartialEq)]
struct DeclSpan {
    property: String,
    property_lc: String,
    /// First non-whitespace byte of the property name.
    decl_start: usize,
    /// First non-whitespace byte of the value.
    value_start: usize,
    /// Exclusive end of the value (trimmed; before any `;`).
    value_end: usize,
    /// Position just past the terminating `;`, or `value_end` if unterminated.
    decl_end: usize,
    /// Whether a `;` terminated this declaration.
    terminated: bool,
}

// ───────────────────────── Low-level helpers ─────────────────────────

/// 1-based line number of the given byte index.
fn line_of(src: &str, byte_idx: usize) -> usize {
    src.as_bytes()[..byte_idx.min(src.len())]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
        + 1
}

/// Leading whitespace of the line containing `pos`.
fn indent_of_line(src: &str, pos: usize) -> String {
    let bytes = src.as_bytes();
    let mut start = pos.min(bytes.len());
    while start > 0 && bytes[start - 1] != b'\n' {
        start -= 1;
    }
    let mut end = start;
    while end < bytes.len() && (bytes[end] == b' ' || bytes[end] == b'\t') {
        end += 1;
    }
    src[start..end].to_string()
}

/// Trim a byte range to its non-whitespace core, returning `(start, end)`.
fn trim_range(src: &str, mut start: usize, mut end: usize) -> (usize, usize) {
    let bytes = src.as_bytes();
    while start < end && bytes[start].is_ascii_whitespace() {
        start += 1;
    }
    while end > start && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    (start, end)
}

/// Remove `/* … */` comments from a string, preserving everything else
/// (including UTF-8 — cuts only on the ASCII comment delimiters).
fn strip_css_comments(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut seg = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'*' {
            out.push_str(&s[seg..i]);
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            seg = i;
            continue;
        }
        i += 1;
    }
    out.push_str(&s[seg..]);
    out
}

/// Byte offset of the first non-whitespace, non-comment character in
/// `[start, end)` (used for a rule's true selector line).
fn first_significant(css: &str, start: usize, end: usize) -> usize {
    let bytes = css.as_bytes();
    let mut i = start;
    while i < end {
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if bytes[i] == b'/' && i + 1 < end && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < end && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(end);
            continue;
        }
        return i;
    }
    end
}

/// Extract the `min-width` pixel value from an `@media` prelude.
fn media_min_px(prelude: &str) -> Option<u32> {
    let low = prelude.to_ascii_lowercase();
    let idx = low.find("min-width")?;
    let after = &low[idx + "min-width".len()..];
    let after = after.split(':').nth(1)?;
    let digits: String = after
        .trim_start()
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

/// Does a rule's media context match the requested breakpoint? Base edits
/// (`None`) match only un-mediated rules; a breakpoint edit matches only the
/// `@media` block with that exact `min-width`.
fn media_matches(media: &Option<String>, bp: Option<u32>) -> bool {
    match (media, bp) {
        (None, None) => true,
        (Some(m), Some(px)) => media_min_px(m) == Some(px),
        _ => false,
    }
}

/// Does a (possibly comma-grouped) selector contain `target` as one of its
/// parts exactly? Strictness is intentional — descendant/compound selectors
/// don't match, so we never edit a rule that also styles other elements
/// implicitly.
fn selector_has_part(selector: &str, target: &str) -> bool {
    selector.split(',').any(|p| p.trim() == target)
}

/// Normalize a selector for cross-source comparison: collapse runs of whitespace
/// to one space, then drop the spaces around descendant combinators so an authored
/// `.a>.b` matches the browser-serialized `.a > .b` (and vice-versa).
fn norm_selector(s: &str) -> String {
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .replace(" > ", ">")
        .replace(" + ", "+")
        .replace(" ~ ", "~")
}

/// Like [`selector_has_part`] but whitespace/combinator-insensitive — used to match
/// a browser-reported compound selector against an authored rule's selector group.
fn rule_selector_matches(rule_selector: &str, target: &str) -> bool {
    let t = norm_selector(target);
    rule_selector.split(',').any(|p| norm_selector(p) == t)
}

/// Whether a rule's `@media` prelude equals the browser-reported condition text
/// (whitespace/case-insensitive). Both empty → a base (un-mediated) rule. This
/// matches by the FULL condition so max-width / feature queries don't collide with
/// the base rule the way a min-width-only comparison did.
fn media_text_matches(rule_media: &Option<String>, query: &Option<String>) -> bool {
    fn norm(s: &str) -> String {
        s.chars()
            .filter(|c| !c.is_whitespace())
            .flat_map(|c| c.to_lowercase())
            .collect()
    }
    let r = rule_media.as_deref().map(norm).unwrap_or_default();
    let q = query.as_deref().map(norm).unwrap_or_default();
    r == q
}

/// Whether braces in an edited rule body are balanced (comment/string-aware) — the
/// guard that lets nested CSS through while still preventing a body from breaking
/// out of its own block.
fn braces_balanced(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0usize;
    let mut depth = 0i32;
    let mut quote = 0u8;
    while i < b.len() {
        let c = b[i];
        if quote != 0 {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == quote {
                quote = 0;
            }
            i += 1;
            continue;
        }
        if c == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(b.len());
            continue;
        }
        match c {
            b'"' | b'\'' => quote = c,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => {}
        }
        i += 1;
    }
    depth == 0 && quote == 0
}

/// The filename component of a served stylesheet URL (`…/styles.css?v=3` → `styles.css`).
fn href_basename(href: &str) -> Option<String> {
    let no_q = href.split(['?', '#']).next().unwrap_or(href);
    no_q.rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// The filename component of a project-relative POSIX path.
fn rel_basename(rel: &str) -> &str {
    rel.rsplit('/').next().unwrap_or(rel)
}

/// Map one cascade match to its source rule across the pre-indexed sheets.
fn locate_rule(sheets: &[SheetIndex], q: &MatchedRuleQuery) -> RuleLocation {
    let resolved = |rel: &str, content: &str, rule: &RuleSpan| RuleLocation::Resolved {
        file: rel.to_string(),
        line: rule.selector_line,
        inner_text: content[rule.block_inner_start..rule.block_inner_end].to_string(),
    };

    let mut hits: Vec<(&str, &str, &RuleSpan)> = Vec::new();
    for sheet in sheets {
        for rule in &sheet.rules {
            if rule_selector_matches(&rule.selector, &q.selector)
                && media_text_matches(&rule.media, &q.media_text)
            {
                hits.push((sheet.rel.as_str(), sheet.content.as_str(), rule));
            }
        }
    }

    match hits.len() {
        0 => RuleLocation::NotFound,
        1 => {
            let (rel, content, rule) = hits[0];
            resolved(rel, content, rule)
        }
        _ => {
            // Same selector in several files — let the served href's basename break
            // the tie when it pins exactly one. Otherwise it's read-only.
            if let Some(base) = q.href.as_deref().and_then(href_basename) {
                let narrowed: Vec<_> = hits
                    .iter()
                    .copied()
                    .filter(|(rel, _, _)| rel_basename(rel) == base)
                    .collect();
                if narrowed.len() == 1 {
                    let (rel, content, rule) = narrowed[0];
                    return resolved(rel, content, rule);
                }
            }
            RuleLocation::Multiple {
                files: hits.iter().map(|(rel, _, _)| rel.to_string()).collect(),
            }
        }
    }
}

/// Replace the verbatim body of the single rule matching `selector`+`bp` in `src`,
/// drift-guarded against `old_inner`. The testable core of [`apply_css_rule_text`].
fn apply_rule_text_to_source(
    src: &str,
    selector: &str,
    media_text: &Option<String>,
    old_inner: &str,
    new_inner: &str,
) -> Result<String, CommandError> {
    let matches: Vec<RuleSpan> = index_rules(src)
        .into_iter()
        .filter(|r| {
            rule_selector_matches(&r.selector, selector) && media_text_matches(&r.media, media_text)
        })
        .collect();
    let rule = match matches.len() {
        1 => &matches[0],
        0 => {
            return Err(CommandError::Validation {
                field: "selector".into(),
                reason: "rule no longer matches — reselect the element".into(),
            })
        }
        _ => {
            return Err(CommandError::Validation {
                field: "selector".into(),
                reason: "selector matches multiple rules — not editable".into(),
            })
        }
    };
    // Drift guard: the source must still read exactly what the editor was seeded
    // with, or another change has landed and we'd clobber it.
    let current = &src[rule.block_inner_start..rule.block_inner_end];
    if current != old_inner {
        return Err(CommandError::Validation {
            field: "css".into(),
            reason: "source changed since you selected it — reselect to edit".into(),
        });
    }
    let mut out = String::with_capacity(src.len() - current.len() + new_inner.len());
    out.push_str(&src[..rule.block_inner_start]);
    out.push_str(new_inner);
    out.push_str(&src[rule.block_inner_end..]);
    Ok(out)
}

/// Find the single rule matching `selector`+`media_text` and verify its body still
/// reads `old_inner` (drift guard). The shared front half of delete/wrap.
fn locate_one_editable<'a>(
    rules: &'a [RuleSpan],
    src: &str,
    selector: &str,
    media_text: &Option<String>,
    old_inner: &str,
) -> Result<&'a RuleSpan, CommandError> {
    let matches: Vec<&RuleSpan> = rules
        .iter()
        .filter(|r| {
            rule_selector_matches(&r.selector, selector) && media_text_matches(&r.media, media_text)
        })
        .collect();
    let rule = match matches.len() {
        1 => matches[0],
        0 => {
            return Err(CommandError::Validation {
                field: "selector".into(),
                reason: "rule no longer matches — reselect the element".into(),
            })
        }
        _ => {
            return Err(CommandError::Validation {
                field: "selector".into(),
                reason: "selector matches multiple rules — not editable".into(),
            })
        }
    };
    if &src[rule.block_inner_start..rule.block_inner_end] != old_inner {
        return Err(CommandError::Validation {
            field: "css".into(),
            reason: "source changed since you selected it — reselect to edit".into(),
        });
    }
    Ok(rule)
}

/// Remove the whole rule (selector through closing `}`, plus its line's leading
/// indentation and one trailing newline) from `src`. The testable core of
/// [`delete_css_rule`].
fn remove_rule_from_source(
    src: &str,
    selector: &str,
    media_text: &Option<String>,
    old_inner: &str,
) -> Result<String, CommandError> {
    let rules = index_rules(src);
    let rule = locate_one_editable(&rules, src, selector, media_text, old_inner)?;
    let bytes = src.as_bytes();
    // Back up over the selector line's indentation so we don't leave a blank gutter.
    let mut start = rule.selector_start;
    while start > 0 && (bytes[start - 1] == b' ' || bytes[start - 1] == b'\t') {
        start -= 1;
    }
    let mut end = rule.block_inner_end + 1; // just past the closing `}`
    while end < bytes.len() && (bytes[end] == b' ' || bytes[end] == b'\t') {
        end += 1;
    }
    if end < bytes.len() && bytes[end] == b'\n' {
        end += 1;
    }
    let mut out = String::with_capacity(src.len() - (end - start));
    out.push_str(&src[..start]);
    out.push_str(&src[end..]);
    Ok(out)
}

/// Replace the matching rule's selector with `new_selector` (drift-guarded against
/// `old_inner`). Lets the user change a rule to any selector — combinators, pseudo
/// classes, attributes — the only constraint is no `{`/`}`. Testable core of
/// [`rename_css_selector`].
fn rename_selector_in_source(
    src: &str,
    selector: &str,
    media_text: &Option<String>,
    old_inner: &str,
    new_selector: &str,
) -> Result<String, CommandError> {
    validate_selector(new_selector)?;
    let rules = index_rules(src);
    let rule = locate_one_editable(&rules, src, selector, media_text, old_inner)?;
    let brace = rule.block_inner_start - 1; // the opening `{`
    let mut out = String::with_capacity(src.len() + new_selector.len());
    out.push_str(&src[..rule.selector_start]);
    out.push_str(new_selector.trim());
    out.push(' ');
    out.push_str(&src[brace..]); // `{ … }`
    Ok(out)
}

/// Replace the condition of the `@media` block enclosing the matching rule with
/// `new_media` (drift-guarded). Edits the shared wrapper, so every rule inside that
/// `@media` moves with it. Testable core of [`rename_css_at_rule`].
fn rename_at_rule_in_source(
    src: &str,
    selector: &str,
    media_text: &Option<String>,
    old_inner: &str,
    new_media: &str,
) -> Result<String, CommandError> {
    let nm = new_media.trim();
    if nm.is_empty() || nm.contains('{') || nm.contains('}') {
        return Err(CommandError::Validation {
            field: "media".into(),
            reason: "invalid at-rule condition".into(),
        });
    }
    let rules = index_rules(src);
    let rule = locate_one_editable(&rules, src, selector, media_text, old_inner)?;
    let (cs, ce) = rule.media_prelude.ok_or_else(|| CommandError::Validation {
        field: "media".into(),
        reason: "this rule isn't inside an at-rule".into(),
    })?;
    let mut out = String::with_capacity(src.len() + nm.len());
    out.push_str(&src[..cs]);
    out.push_str(nm);
    out.push_str(&src[ce..]);
    Ok(out)
}

/// Wrap the matching rule in an at-rule: `selector { body }` →
/// `at_prelude {\n  selector { body }\n}` (re-indented). The testable core of
/// [`wrap_css_rule`]. Only `@media` keeps the inner rule editable afterward (the
/// locator indexes rules inside `@media`, not `@supports`/`@layer` yet).
fn wrap_rule_in_source(
    src: &str,
    selector: &str,
    media_text: &Option<String>,
    at_prelude: &str,
    old_inner: &str,
) -> Result<String, CommandError> {
    let at = at_prelude.trim();
    if !at.starts_with('@') || at.contains('{') || at.contains('}') {
        return Err(CommandError::Validation {
            field: "atRule".into(),
            reason: "invalid at-rule prelude".into(),
        });
    }
    let rules = index_rules(src);
    let rule = locate_one_editable(&rules, src, selector, media_text, old_inner)?;
    let bytes = src.as_bytes();
    let mut region_start = rule.selector_start;
    while region_start > 0 && bytes[region_start - 1] != b'\n' {
        region_start -= 1;
    }
    let region_end = rule.block_inner_end + 1; // just past the closing `}`
    let rule_text = &src[rule.selector_start..region_end]; // selector through `}`
    let indented = format!("  {}", rule_text.replace('\n', "\n  "));
    let wrapped = format!("{at} {{\n{indented}\n}}");
    let mut out = String::with_capacity(src.len() + wrapped.len());
    out.push_str(&src[..region_start]);
    out.push_str(&wrapped);
    out.push_str(&src[region_end..]);
    Ok(out)
}

// ───────────────────────────── Locator ─────────────────────────────

/// Index every top-level (and single-level `@media`-nested) style rule in a
/// stylesheet. Comments, strings, `@keyframes`/`@font-face`/`@supports` bodies,
/// and nested blocks are skipped rather than mis-read as rules.
fn index_rules(css: &str) -> Vec<RuleSpan> {
    enum Frame {
        /// `@media` block — condition string + byte range of the condition text.
        Media(String, usize, usize),
        /// Any at-rule we don't index into (keyframes, font-face, supports) or a
        /// nested/malformed block.
        Other,
        /// A style rule; payload is its index in `rules`.
        Rule(usize),
    }

    let bytes = css.as_bytes();
    let n = bytes.len();
    let mut rules: Vec<RuleSpan> = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut prelude_start = 0usize;
    let mut i = 0usize;

    while i < n {
        let c = bytes[i];

        // Comment
        if c == b'/' && i + 1 < n && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < n && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(n);
            continue;
        }
        // String
        if c == b'"' || c == b'\'' {
            i += 1;
            while i < n && bytes[i] != c {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            i = (i + 1).min(n);
            continue;
        }

        if c == b'{' {
            let prelude_clean = strip_css_comments(&css[prelude_start..i]);
            let prelude = prelude_clean.trim();
            let inside_rule = matches!(stack.last(), Some(Frame::Rule(_)));
            let inside_other = stack.iter().any(|f| matches!(f, Frame::Other));

            if inside_rule || inside_other {
                stack.push(Frame::Other);
            } else if let Some(rest) = prelude.strip_prefix('@') {
                if rest.to_ascii_lowercase().starts_with("media") {
                    let media_prelude = rest["media".len()..].trim().to_string();
                    // Byte range of the condition text within the original source, so
                    // the at-rule can be edited in place.
                    let raw = &css[prelude_start..i];
                    let kw = raw
                        .to_ascii_lowercase()
                        .find("@media")
                        .map(|k| k + 6)
                        .unwrap_or(0);
                    let rb = raw.as_bytes();
                    let mut cs = kw;
                    while cs < raw.len() && rb[cs].is_ascii_whitespace() {
                        cs += 1;
                    }
                    let mut ce = raw.len();
                    while ce > cs && rb[ce - 1].is_ascii_whitespace() {
                        ce -= 1;
                    }
                    stack.push(Frame::Media(
                        media_prelude,
                        prelude_start + cs,
                        prelude_start + ce,
                    ));
                } else {
                    stack.push(Frame::Other);
                }
            } else if !prelude.is_empty() {
                let (media, media_prelude) = stack
                    .iter()
                    .rev()
                    .find_map(|f| match f {
                        Frame::Media(m, cs, ce) => Some((Some(m.clone()), Some((*cs, *ce)))),
                        _ => None,
                    })
                    .unwrap_or((None, None));
                let selector_start = first_significant(css, prelude_start, i);
                let selector_line = line_of(css, selector_start);
                let idx = rules.len();
                rules.push(RuleSpan {
                    selector: prelude.to_string(),
                    media,
                    media_prelude,
                    selector_start,
                    block_inner_start: i + 1,
                    block_inner_end: i + 1,
                    selector_line,
                });
                stack.push(Frame::Rule(idx));
            } else {
                stack.push(Frame::Other);
            }
            i += 1;
            prelude_start = i;
            continue;
        }

        if c == b'}' {
            if let Some(Frame::Rule(idx)) = stack.pop() {
                rules[idx].block_inner_end = i;
            }
            i += 1;
            prelude_start = i;
            continue;
        }

        i += 1;
    }

    rules
}

/// Locate every declaration inside a rule's block `[inner_start, inner_end)`,
/// with byte offsets into the original stylesheet.
fn locate_declarations(css: &str, inner_start: usize, inner_end: usize) -> Vec<DeclSpan> {
    let bytes = css.as_bytes();
    let mut out = Vec::new();
    let mut seg_start = inner_start;
    let mut i = inner_start;
    let mut depth = 0i32;

    let flush = |seg_start: usize, seg_end: usize, terminated: bool, out: &mut Vec<DeclSpan>| {
        let (ds, de) = trim_range(css, seg_start, seg_end);
        if ds >= de {
            return;
        }
        // Find the property/value colon, ignoring strings/parens.
        let seg = &css.as_bytes()[ds..de];
        let mut colon: Option<usize> = None;
        let mut d = 0i32;
        let mut j = 0usize;
        while j < seg.len() {
            let ch = seg[j];
            if ch == b'"' || ch == b'\'' {
                j += 1;
                while j < seg.len() && seg[j] != ch {
                    if seg[j] == b'\\' {
                        j += 1;
                    }
                    j += 1;
                }
                j += 1;
                continue;
            }
            match ch {
                b'(' => d += 1,
                b')' => d -= 1,
                b':' if d == 0 => {
                    colon = Some(ds + j);
                    break;
                }
                _ => {}
            }
            j += 1;
        }
        let Some(colon) = colon else { return };
        let (vs, ve) = trim_range(css, colon + 1, de);
        if vs >= ve {
            return;
        }
        let property = css[ds..colon].trim().to_string();
        let decl_end = if terminated {
            (seg_end + 1).min(inner_end)
        } else {
            ve
        };
        out.push(DeclSpan {
            property_lc: property.to_ascii_lowercase(),
            property,
            decl_start: ds,
            value_start: vs,
            value_end: ve,
            decl_end,
            terminated,
        });
    };

    while i < inner_end {
        let c = bytes[i];
        if c == b'/' && i + 1 < inner_end && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < inner_end && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(inner_end);
            continue;
        }
        if c == b'"' || c == b'\'' {
            i += 1;
            while i < inner_end && bytes[i] != c {
                if bytes[i] == b'\\' {
                    i += 1;
                }
                i += 1;
            }
            i = (i + 1).min(inner_end);
            continue;
        }
        match c {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b';' if depth == 0 => {
                flush(seg_start, i, true, &mut out);
                seg_start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    flush(seg_start, inner_end, false, &mut out);
    out
}

/// Parse a rule block into `Declaration`s (with `!important` split out of value).
fn declarations_in(css: &str, rule: &RuleSpan) -> Vec<Declaration> {
    locate_declarations(css, rule.block_inner_start, rule.block_inner_end)
        .into_iter()
        .map(|d| {
            let raw = css[d.value_start..d.value_end].trim();
            let (value, important) = match raw.to_ascii_lowercase().rfind("!important") {
                Some(idx) => (raw[..idx].trim().to_string(), true),
                None => (raw.to_string(), false),
            };
            Declaration {
                property: d.property,
                value,
                important,
            }
        })
        .collect()
}

// ─────────────────────── Surgical declaration write ───────────────────────

/// Set, add, or remove (`value: None`) a single declaration inside the rule
/// block `[inner_start, inner_end)`, preserving all surrounding formatting.
fn set_declaration_in_block(
    css: &str,
    inner_start: usize,
    inner_end: usize,
    property: &str,
    value: Option<&str>,
) -> String {
    let decls = locate_declarations(css, inner_start, inner_end);
    let prop_lc = property.to_ascii_lowercase();
    let existing = decls.iter().find(|d| d.property_lc == prop_lc);

    match (existing, value) {
        // Update an existing declaration's value in place. Preserve a trailing
        // `!important` the UI doesn't round-trip (it tracks the flag separately
        // and sends only the value), so editing a property never silently drops
        // its importance.
        (Some(d), Some(v)) => {
            let existing = css[d.value_start..d.value_end].trim_end();
            let keep_important = existing.to_ascii_lowercase().ends_with("!important")
                && !v.to_ascii_lowercase().contains("!important");
            let mut out = String::with_capacity(css.len());
            out.push_str(&css[..d.value_start]);
            out.push_str(v);
            if keep_important {
                out.push_str(" !important");
            }
            out.push_str(&css[d.value_end..]);
            out
        }
        // Remove a declaration, taking its whole line with it.
        (Some(d), None) => {
            let bytes = css.as_bytes();
            // Back up over the indentation to the line start.
            let mut rs = d.decl_start;
            while rs > inner_start && (bytes[rs - 1] == b' ' || bytes[rs - 1] == b'\t') {
                rs -= 1;
            }
            // Swallow one trailing newline so we don't leave a blank line.
            let mut re = d.decl_end;
            while re < inner_end && (bytes[re] == b' ' || bytes[re] == b'\t') {
                re += 1;
            }
            if re < inner_end && bytes[re] == b'\n' {
                re += 1;
            } else if rs > inner_start && bytes[rs - 1] == b'\n' {
                // No trailing newline (last decl) — drop the leading one instead.
                rs -= 1;
            }
            let mut out = String::with_capacity(css.len());
            out.push_str(&css[..rs]);
            out.push_str(&css[re..]);
            out
        }
        // Append a new declaration after the last one.
        (None, Some(v)) => {
            if let Some(last) = decls.last() {
                let insert_at = last.decl_end;
                let indent = indent_of_line(css, last.decl_start);
                let mut ins = String::new();
                if !last.terminated {
                    ins.push(';');
                }
                ins.push('\n');
                ins.push_str(&indent);
                ins.push_str(property);
                ins.push_str(": ");
                ins.push_str(v);
                ins.push(';');
                let mut out = String::with_capacity(css.len() + ins.len());
                out.push_str(&css[..insert_at]);
                out.push_str(&ins);
                out.push_str(&css[insert_at..]);
                out
            } else {
                // Empty block — lay out a fresh multi-line body.
                let rule_indent = indent_of_line(css, inner_start);
                let decl_indent = format!("{rule_indent}  ");
                let body = format!("\n{decl_indent}{property}: {v};\n{rule_indent}");
                let mut out = String::with_capacity(css.len() + body.len());
                out.push_str(&css[..inner_start]);
                out.push_str(&body);
                out.push_str(&css[inner_end..]);
                out
            }
        }
        // Nothing to remove.
        (None, None) => css.to_string(),
    }
}

/// Render a new rule (optionally wrapped in an `@media` block) ready to append.
fn build_rule_text(selector: &str, declarations: &[Declaration], min_px: Option<u32>) -> String {
    let (base, decl_indent) = match min_px {
        Some(_) => ("  ", "    "),
        None => ("", "  "),
    };
    let mut body = String::new();
    body.push_str(base);
    body.push_str(selector);
    body.push_str(" {\n");
    for d in declarations {
        body.push_str(decl_indent);
        body.push_str(&d.property);
        body.push_str(": ");
        body.push_str(&d.value);
        if d.important {
            body.push_str(" !important");
        }
        body.push_str(";\n");
    }
    body.push_str(base);
    body.push('}');

    match min_px {
        Some(px) => format!("@media (min-width: {px}px) {{\n{body}\n}}"),
        None => body,
    }
}

// ───────────────────────── Resolution core (pure) ─────────────────────────

/// Pick the class token the user means to edit.
fn pick_class(sig: &CssSignature) -> Option<String> {
    if let Some(t) = sig.target_class.as_ref().map(|s| s.trim()) {
        if !t.is_empty() {
            return Some(t.trim_start_matches('.').to_string());
        }
    }
    let toks: Vec<&str> = sig.class_name.split_whitespace().collect();
    toks.last().map(|s| s.to_string())
}

/// Resolve against already-indexed stylesheets — the testable core of
/// [`resolve_css_rule`], free of filesystem and path validation. Filters the
/// pre-parsed rules (no re-parse), so a click is an in-memory scan.
fn resolve_in_sheets(sheets: &[SheetIndex], sig: &CssSignature, bp: Option<u32>) -> CssResolution {
    let class = match pick_class(sig) {
        Some(c) => c,
        None => {
            return if sig.has_inline_style {
                CssResolution::Inline {
                    reason: "styled inline; add a class to edit it as a rule".into(),
                }
            } else {
                CssResolution::NeedsClass {
                    reason: "no class to anchor a rule to".into(),
                }
            };
        }
    };
    let selector = format!(".{class}{}", pseudo_suffix(sig));

    let mut hits: Vec<(&str, &str, &RuleSpan)> = Vec::new();
    for sheet in sheets {
        for rule in &sheet.rules {
            if selector_has_part(&rule.selector, &selector) && media_matches(&rule.media, bp) {
                hits.push((sheet.rel.as_str(), sheet.content.as_str(), rule));
            }
        }
    }

    match hits.len() {
        0 => CssResolution::NotFound { selector },
        1 => {
            let (rel, content, rule) = &hits[0];
            CssResolution::Resolved {
                file: (*rel).to_string(),
                selector,
                line: rule.selector_line,
                media_min_px: rule.media.as_deref().and_then(media_min_px),
                declarations: declarations_in(content, rule),
            }
        }
        _ => CssResolution::Multiple {
            selector,
            locations: hits
                .iter()
                .map(|(rel, _, rule)| Location {
                    file: (*rel).to_string(),
                    line: rule.selector_line,
                    column: 1,
                })
                .collect(),
        },
    }
}

/// Apply a declaration edit to one stylesheet's source — the testable core of
/// [`set_css_declaration`]. Errors (fail-closed) when the rule can't be pinned
/// to a single block.
fn apply_declaration_to_source(
    src: &str,
    selector: &str,
    bp: Option<u32>,
    property: &str,
    value: Option<&str>,
) -> Result<String, CommandError> {
    let matches: Vec<RuleSpan> = index_rules(src)
        .into_iter()
        .filter(|r| selector_has_part(&r.selector, selector) && media_matches(&r.media, bp))
        .collect();

    match matches.len() {
        0 => Err(CommandError::Validation {
            field: "selector".into(),
            reason: "rule no longer matches — reselect the element".into(),
        }),
        1 => Ok(set_declaration_in_block(
            src,
            matches[0].block_inner_start,
            matches[0].block_inner_end,
            property,
            value,
        )),
        _ => Err(CommandError::Validation {
            field: "selector".into(),
            reason: "class is defined by multiple rules — not editable".into(),
        }),
    }
}

// ───────────────────────── Stylesheet discovery ─────────────────────────

/// Walk the project for hand-authored `.css` files (skipping build output and
/// oversized/minified bundles), returning `(project-relative POSIX path,
/// contents)` for each.
fn discover_stylesheets(root: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    // Use the `ignore` walker — it honors .gitignore and skips hidden/VCS dirs,
    // the same walker the source indexer uses (`edit::index_occurrences`). A
    // hand-rolled denylist can't know about `.vercel`, `.turbo`, `.svelte-kit`,
    // asset dumps, etc., so it descended into huge generated trees and made every
    // cache-miss resolve crawl on large projects.
    let walker = ignore::WalkBuilder::new(root)
        .standard_filters(true)
        .build();
    for entry in walker.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("css") {
            continue;
        }
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        if entry.metadata().map(|m| m.len()).unwrap_or(0) > MAX_CSS_BYTES {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(path) else {
            continue;
        };
        let rel = path
            .strip_prefix(root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        out.push((rel, content));
    }
    out
}

/// Resolve `file` to an absolute path proven to live inside `root`.
fn safe_join(root: &Path, file: &str) -> Result<std::path::PathBuf, CommandError> {
    let abs = root.join(file);
    let canon_root = root.canonicalize().map_err(CommandError::from)?;
    let canon_file = abs.canonicalize().map_err(CommandError::from)?;
    if !canon_file.starts_with(&canon_root) {
        return Err(CommandError::Validation {
            field: "file".into(),
            reason: "edit target is outside the project".into(),
        });
    }
    Ok(abs)
}

// ───────────────────────── Write validation ─────────────────────────
//
// Edits are written verbatim and surgically, so a value/property/selector that
// contains block-structure characters (a typo, or a paste) would break out of
// the rule and corrupt the stylesheet. The engine is fail-closed: refuse them
// rather than write something that silently destroys the file.

/// A CSS property name is a plain identifier (`padding`, `--brand-color`).
fn property_is_safe(property: &str) -> bool {
    let p = property.trim();
    !p.is_empty()
        && p.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// A value is safe when it can't terminate the declaration or close the block:
/// `{`/`}` never appear outside a quoted string, and `;` only inside quotes or
/// parentheses (e.g. a `url(data:…;…)` or `content: ";"`). Unbalanced quotes or
/// parens are rejected too — they'd swallow following source.
fn value_is_safe(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut i = 0usize;
    let mut quote = 0u8;
    let mut depth = 0i32;
    while i < bytes.len() {
        let c = bytes[i];
        if quote != 0 {
            if c == b'\\' {
                i += 2;
                continue;
            }
            if c == quote {
                quote = 0;
            }
            i += 1;
            continue;
        }
        match c {
            b'"' | b'\'' => quote = c,
            b'(' => depth += 1,
            b')' => depth -= 1,
            b'{' | b'}' => return false,
            b';' if depth == 0 => return false,
            _ => {}
        }
        i += 1;
    }
    quote == 0 && depth == 0
}

/// Reject a property/value pair that would corrupt the stylesheet. `None` value
/// is a removal — only the property is checked.
fn validate_declaration(property: &str, value: Option<&str>) -> Result<(), CommandError> {
    if !property_is_safe(property) {
        return Err(CommandError::Validation {
            field: "property".into(),
            reason: format!("\"{property}\" isn't a valid CSS property name"),
        });
    }
    if let Some(v) = value {
        if !value_is_safe(v) {
            return Err(CommandError::Validation {
                field: "value".into(),
                reason: "value contains characters that would break the stylesheet".into(),
            });
        }
    }
    Ok(())
}

/// A selector written into a new rule must not carry block braces.
fn validate_selector(selector: &str) -> Result<(), CommandError> {
    if selector.trim().is_empty() || selector.contains('{') || selector.contains('}') {
        return Err(CommandError::Validation {
            field: "selector".into(),
            reason: "invalid selector".into(),
        });
    }
    Ok(())
}

// ───────────────────────────── Commands ─────────────────────────────

/// Resolve a clicked element to the CSS rule that styles its class, at the
/// given breakpoint (`None` = base). Returns a typed status the UI branches on.
#[tauri::command]
#[tracing::instrument(skip(signature), fields(project = %project_path))]
pub fn resolve_css_rule(
    project_path: String,
    signature: CssSignature,
    breakpoint_min_px: Option<u32>,
) -> Result<CssResolution, CommandError> {
    let root = validate_project_path(&project_path)?;
    let sheets = cached_sheets(&root);
    Ok(resolve_in_sheets(&sheets, &signature, breakpoint_min_px))
}

/// Surgically set (or remove, when `value` is `None`) one declaration on the
/// rule for `selector` at the given breakpoint. Fail-closed if the rule can't
/// be pinned to a single block.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path, file = %file, selector = %selector, property = %property))]
pub fn set_css_declaration(
    project_path: String,
    file: String,
    selector: String,
    breakpoint_min_px: Option<u32>,
    property: String,
    value: Option<String>,
) -> Result<(), CommandError> {
    validate_declaration(&property, value.as_deref())?;
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;
    let updated = apply_declaration_to_source(
        &src,
        &selector,
        breakpoint_min_px,
        &property,
        value.as_deref(),
    )?;
    if updated != src {
        std::fs::write(&abs, updated).map_err(CommandError::from)?;
        invalidate_sheet_cache(&root);
    }
    Ok(())
}

/// Append a new rule for `selector` (optionally inside an `@media` block) to the
/// authored stylesheet. The class-attribute attach on the element itself is
/// handled separately (Phase 2). Fail-closed if the rule already exists.
#[tauri::command]
#[tracing::instrument(skip(declarations), fields(project = %project_path, file = %file, selector = %selector))]
pub fn create_css_class(
    project_path: String,
    file: String,
    selector: String,
    declarations: Vec<Declaration>,
    breakpoint_min_px: Option<u32>,
) -> Result<(), CommandError> {
    validate_selector(&selector)?;
    for d in &declarations {
        validate_declaration(&d.property, Some(&d.value))?;
    }
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;

    let already = index_rules(&src).into_iter().any(|r| {
        selector_has_part(&r.selector, &selector) && media_matches(&r.media, breakpoint_min_px)
    });
    if already {
        return Err(CommandError::Validation {
            field: "selector".into(),
            reason: "a rule for this selector already exists".into(),
        });
    }

    let rule = build_rule_text(&selector, &declarations, breakpoint_min_px);
    let mut out = src.clone();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&rule);
    out.push('\n');
    std::fs::write(&abs, out).map_err(CommandError::from)?;
    invalidate_sheet_cache(&root);
    Ok(())
}

/// List hand-authored stylesheets in the project (project-relative POSIX
/// paths), so the UI can offer an authored-sheet target for new rules.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub fn list_stylesheets(project_path: String) -> Result<Vec<String>, CommandError> {
    let root = validate_project_path(&project_path)?;
    Ok(cached_sheets(&root).iter().map(|s| s.rel.clone()).collect())
}

/// Every class name referenced in any rule selector (`.foo .bar:hover` → foo,
/// bar). Powers the class bar's search-and-create combobox.
fn class_names_in(selector: &str) -> Vec<String> {
    let bytes = selector.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'.' {
            let start = i + 1;
            let mut j = start;
            while j < bytes.len()
                && (bytes[j].is_ascii_alphanumeric() || bytes[j] == b'-' || bytes[j] == b'_')
            {
                j += 1;
            }
            if j > start {
                out.push(selector[start..j].to_string());
            }
            i = j;
        } else {
            i += 1;
        }
    }
    out
}

/// All class names defined across the project's stylesheets, sorted & unique.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub fn list_css_classes(project_path: String) -> Result<Vec<String>, CommandError> {
    let root = validate_project_path(&project_path)?;
    let mut set = std::collections::BTreeSet::new();
    for sheet in cached_sheets(&root).iter() {
        for rule in &sheet.rules {
            for c in class_names_in(&rule.selector) {
                set.insert(c);
            }
        }
    }
    Ok(set.into_iter().collect())
}

/// Map a batch of cascade matches (from the in-iframe walker) back to their source
/// rules, in the same order. Each entry is `resolved` (editable), `multiple`, or
/// `not_found` (read-only) — the code panel renders accordingly.
#[tauri::command]
#[tracing::instrument(skip(matched), fields(project = %project_path, rules = matched.len()))]
pub fn locate_css_rules(
    project_path: String,
    matched: Vec<MatchedRuleQuery>,
) -> Result<Vec<RuleLocation>, CommandError> {
    let root = validate_project_path(&project_path)?;
    let sheets = cached_sheets(&root);
    Ok(matched.iter().map(|q| locate_rule(&sheets, q)).collect())
}

/// Replace one rule's body with the user's edited source CSS, written verbatim and
/// surgically (formatting/comments outside the rule untouched). Drift-guarded
/// against `old_inner`; fail-closed if the rule isn't pinned to one block or the
/// new body would break out of it (`{`/`}` are rejected — a code panel edits the
/// declarations of a single rule, never its structure).
#[tauri::command]
#[tracing::instrument(
    skip(old_inner, new_inner),
    fields(project = %project_path, file = %file, selector = %selector)
)]
pub fn apply_css_rule_text(
    project_path: String,
    file: String,
    selector: String,
    media_text: Option<String>,
    old_inner: String,
    new_inner: String,
) -> Result<(), CommandError> {
    // Braces are allowed (nested CSS) as long as they're balanced — an unbalanced
    // body could break out of the rule and corrupt the file.
    if !braces_balanced(&new_inner) {
        return Err(CommandError::Validation {
            field: "css".into(),
            reason: "unbalanced { } in the rule body".into(),
        });
    }
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;
    let updated = apply_rule_text_to_source(&src, &selector, &media_text, &old_inner, &new_inner)?;
    if updated != src {
        std::fs::write(&abs, updated).map_err(CommandError::from)?;
        invalidate_sheet_cache(&root);
    }
    Ok(())
}

/// Delete the whole rule for `selector`+`media_text` from its stylesheet,
/// drift-guarded against `old_inner`. Fail-closed if it isn't pinned to one rule.
#[tauri::command]
#[tracing::instrument(skip(old_inner), fields(project = %project_path, file = %file, selector = %selector))]
pub fn delete_css_rule(
    project_path: String,
    file: String,
    selector: String,
    media_text: Option<String>,
    old_inner: String,
) -> Result<(), CommandError> {
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;
    let updated = remove_rule_from_source(&src, &selector, &media_text, &old_inner)?;
    if updated != src {
        std::fs::write(&abs, updated).map_err(CommandError::from)?;
        invalidate_sheet_cache(&root);
    }
    Ok(())
}

/// Wrap the rule for `selector`+`media_text` in `at_prelude` (e.g. a `@media`
/// query), drift-guarded against `old_inner`.
#[tauri::command]
#[tracing::instrument(skip(old_inner), fields(project = %project_path, file = %file, selector = %selector, at = %at_prelude))]
pub fn wrap_css_rule(
    project_path: String,
    file: String,
    selector: String,
    media_text: Option<String>,
    at_prelude: String,
    old_inner: String,
) -> Result<(), CommandError> {
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;
    let updated = wrap_rule_in_source(&src, &selector, &media_text, &at_prelude, &old_inner)?;
    if updated != src {
        std::fs::write(&abs, updated).map_err(CommandError::from)?;
        invalidate_sheet_cache(&root);
    }
    Ok(())
}

/// Change the selector of the rule for `selector`+`media_text` to `new_selector`,
/// drift-guarded against `old_inner`.
#[tauri::command]
#[tracing::instrument(skip(old_inner), fields(project = %project_path, file = %file, selector = %selector, new = %new_selector))]
pub fn rename_css_selector(
    project_path: String,
    file: String,
    selector: String,
    media_text: Option<String>,
    old_inner: String,
    new_selector: String,
) -> Result<(), CommandError> {
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;
    let updated =
        rename_selector_in_source(&src, &selector, &media_text, &old_inner, &new_selector)?;
    if updated != src {
        std::fs::write(&abs, updated).map_err(CommandError::from)?;
        invalidate_sheet_cache(&root);
    }
    Ok(())
}

/// Change the `@media` condition enclosing the rule for `selector`+`media_text` to
/// `new_media`, drift-guarded against `old_inner`.
#[tauri::command]
#[tracing::instrument(skip(old_inner), fields(project = %project_path, file = %file, selector = %selector, new = %new_media))]
pub fn rename_css_at_rule(
    project_path: String,
    file: String,
    selector: String,
    media_text: Option<String>,
    old_inner: String,
    new_media: String,
) -> Result<(), CommandError> {
    let root = validate_project_path(&project_path)?;
    let abs = safe_join(&root, &file)?;
    let src = std::fs::read_to_string(&abs).map_err(CommandError::from)?;
    let updated = rename_at_rule_in_source(&src, &selector, &media_text, &old_inner, &new_media)?;
    if updated != src {
        std::fs::write(&abs, updated).map_err(CommandError::from)?;
        invalidate_sheet_cache(&root);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(class: &str) -> CssSignature {
        CssSignature {
            class_name: class.to_string(),
            tag_name: "div".into(),
            target_class: None,
            has_inline_style: false,
            pseudo: None,
        }
    }

    /// Build the parsed sheet index `resolve_in_sheets` now takes.
    fn idx(list: Vec<(String, String)>) -> Vec<SheetIndex> {
        list.into_iter()
            .map(|(r, c)| SheetIndex::parse(r, c))
            .collect()
    }

    #[test]
    fn extracts_class_names_from_selectors() {
        assert_eq!(
            class_names_in(".hero .hero-title:hover"),
            vec!["hero", "hero-title"]
        );
        assert_eq!(class_names_in("section.cta > .btn"), vec!["cta", "btn"]);
        assert!(class_names_in("div > a:hover").is_empty());
    }

    #[test]
    fn pseudo_allows_functional_and_pseudo_elements() {
        let mut s = sig("x");
        s.pseudo = Some("nth-child(even)".into());
        assert_eq!(pseudo_suffix(&s), ":nth-child(even)");
        s.pseudo = Some("::before".into());
        assert_eq!(pseudo_suffix(&s), "::before");
        s.pseudo = Some(":not(.foo)".into());
        assert_eq!(pseudo_suffix(&s), ":not(.foo)");
        // Reject injection.
        s.pseudo = Some("hover{}body".into());
        assert_eq!(pseudo_suffix(&s), "");
    }

    #[test]
    fn pseudo_rejects_top_level_comma_and_space_but_allows_them_in_parens() {
        let mut s = sig("x");
        // Top-level comma/space would break out into a selector list.
        s.pseudo = Some("hover, .evil".into());
        assert_eq!(pseudo_suffix(&s), "");
        s.pseudo = Some("hover .evil".into());
        assert_eq!(pseudo_suffix(&s), "");
        // Inside a functional pseudo they're legal.
        s.pseudo = Some(":is(.a, .b)".into());
        assert_eq!(pseudo_suffix(&s), ":is(.a, .b)");
        s.pseudo = Some(":not(.x .y)".into());
        assert_eq!(pseudo_suffix(&s), ":not(.x .y)");
    }

    #[test]
    fn validates_property_and_value_against_block_break_out() {
        assert!(property_is_safe("padding"));
        assert!(property_is_safe("--brand-color"));
        assert!(!property_is_safe("color; }"));
        assert!(!property_is_safe(""));
        assert!(!property_is_safe("a:b"));

        assert!(value_is_safe("24px"));
        assert!(value_is_safe("rgba(0, 0, 0, 0.5)"));
        assert!(value_is_safe("url(data:image/svg+xml;base64,abc)")); // ; inside parens
        assert!(value_is_safe("\"a;b{c}\"")); // structural chars inside a string
        assert!(!value_is_safe("red }")); // closes the block
        assert!(!value_is_safe("red; .evil { color: blue")); // injects a rule
        assert!(!value_is_safe("\"unterminated")); // dangling quote
        assert!(!value_is_safe("rgb(0,0,0")); // unbalanced parens

        assert!(validate_declaration("color", Some("red }")).is_err());
        assert!(validate_declaration("color", Some("red")).is_ok());
        assert!(validate_declaration("color", None).is_ok());
        assert!(validate_selector(".hero:hover").is_ok());
        assert!(validate_selector(".hero { } .evil").is_err());
    }

    #[test]
    fn editing_a_value_preserves_existing_important() {
        let css = ".x {\n  color: red !important;\n}";
        let out = set_declaration_in_block(
            css,
            css.find('{').unwrap() + 1,
            css.rfind('}').unwrap(),
            "color",
            Some("blue"),
        );
        assert!(out.contains("color: blue !important;"), "got: {out}");
    }

    #[test]
    fn resolves_pseudo_class_rule() {
        let css = ".btn { color: red; }\n.btn:hover { color: blue; }";
        let sheets = idx(vec![("s.css".to_string(), css.to_string())]);
        let mut s = sig("btn");
        s.pseudo = Some("hover".into());
        match resolve_in_sheets(&sheets, &s, None) {
            CssResolution::Resolved {
                selector,
                declarations,
                ..
            } => {
                assert_eq!(selector, ".btn:hover");
                assert_eq!(declarations[0].value, "blue");
            }
            other => panic!("expected hover rule, got {other:?}"),
        }
        // Default state still resolves the base rule.
        match resolve_in_sheets(&sheets, &sig("btn"), None) {
            CssResolution::Resolved { selector, .. } => assert_eq!(selector, ".btn"),
            other => panic!("expected base rule, got {other:?}"),
        }
    }

    // ── Locator ──

    #[test]
    fn indexes_basic_rules() {
        let css = ".a { color: red; }\n.b { color: blue; }";
        let rules = index_rules(css);
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0].selector, ".a");
        assert_eq!(rules[0].selector_line, 1);
        assert_eq!(rules[1].selector, ".b");
        assert_eq!(rules[1].selector_line, 2);
        assert!(rules[0].media.is_none());
    }

    #[test]
    fn indexes_media_nested_rules() {
        let css = ".a { color: red; }\n@media (min-width: 768px) {\n  .a { color: green; }\n}";
        let rules = index_rules(css);
        assert_eq!(rules.len(), 2);
        assert!(rules[0].media.is_none());
        assert_eq!(rules[1].media.as_deref(), Some("(min-width: 768px)"));
        assert_eq!(media_min_px(rules[1].media.as_deref().unwrap()), Some(768));
    }

    #[test]
    fn skips_keyframes_inner_blocks() {
        let css = "@keyframes spin { 0% { transform: rotate(0); } 100% { transform: rotate(360deg); } }\n.real { color: red; }";
        let rules = index_rules(css);
        // Only `.real` is a style rule; the keyframe stops are not.
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].selector, ".real");
    }

    #[test]
    fn ignores_braces_in_comments_and_strings() {
        let css = "/* .fake { } */\n.real { content: \"}{\"; color: red; }";
        let rules = index_rules(css);
        assert_eq!(rules.len(), 1);
        assert_eq!(rules[0].selector, ".real");
        let decls = declarations_in(css, &rules[0]);
        assert_eq!(decls.len(), 2);
        assert_eq!(decls[0].property, "content");
        assert_eq!(decls[0].value, "\"}{\"");
    }

    #[test]
    fn grouped_selector_matches_each_part() {
        let css = ".a, .b { color: red; }";
        let rules = index_rules(css);
        assert!(selector_has_part(&rules[0].selector, ".a"));
        assert!(selector_has_part(&rules[0].selector, ".b"));
        assert!(!selector_has_part(&rules[0].selector, ".c"));
    }

    // ── Declarations ──

    #[test]
    fn parses_declarations_with_important_and_no_trailing_semicolon() {
        let css = ".a { color: red !important;\n  margin: 0 auto }";
        let rules = index_rules(css);
        let decls = declarations_in(css, &rules[0]);
        assert_eq!(decls.len(), 2);
        assert_eq!(decls[0].property, "color");
        assert_eq!(decls[0].value, "red");
        assert!(decls[0].important);
        assert_eq!(decls[1].property, "margin");
        assert_eq!(decls[1].value, "0 auto");
        assert!(!decls[1].important);
    }

    #[test]
    fn does_not_split_on_semicolons_inside_functions_or_strings() {
        let css = ".a { background: url(\"a;b.png\"); color: red; }";
        let rules = index_rules(css);
        let decls = declarations_in(css, &rules[0]);
        assert_eq!(decls.len(), 2);
        assert_eq!(decls[0].property, "background");
        assert_eq!(decls[0].value, "url(\"a;b.png\")");
    }

    // ── Surgical writes ──

    #[test]
    fn updates_existing_declaration_in_place() {
        let css = ".hero {\n  padding: 8px;\n  color: red;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "padding",
            Some("24px"),
        );
        assert_eq!(out, ".hero {\n  padding: 24px;\n  color: red;\n}");
    }

    #[test]
    fn property_match_is_case_insensitive() {
        let css = ".hero {\n  Padding: 8px;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "padding",
            Some("24px"),
        );
        assert_eq!(out, ".hero {\n  Padding: 24px;\n}");
    }

    #[test]
    fn appends_new_declaration_matching_indentation() {
        let css = ".hero {\n  padding: 8px;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "margin",
            Some("0 auto"),
        );
        assert_eq!(out, ".hero {\n  padding: 8px;\n  margin: 0 auto;\n}");
    }

    #[test]
    fn appends_into_empty_block() {
        let css = ".hero {}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "color",
            Some("red"),
        );
        assert_eq!(out, ".hero {\n  color: red;\n}");
    }

    #[test]
    fn appends_after_unterminated_last_declaration() {
        let css = ".hero {\n  padding: 8px\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "color",
            Some("red"),
        );
        assert_eq!(out, ".hero {\n  padding: 8px;\n  color: red;\n}");
    }

    #[test]
    fn removes_a_middle_declaration_cleanly() {
        let css = ".hero {\n  padding: 8px;\n  color: red;\n  margin: 0;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "color",
            None,
        );
        assert_eq!(out, ".hero {\n  padding: 8px;\n  margin: 0;\n}");
    }

    #[test]
    fn removing_absent_declaration_is_noop() {
        let css = ".hero {\n  padding: 8px;\n}";
        let rules = index_rules(css);
        let out = set_declaration_in_block(
            css,
            rules[0].block_inner_start,
            rules[0].block_inner_end,
            "color",
            None,
        );
        assert_eq!(out, css);
    }

    // ── Resolution ──

    #[test]
    fn resolves_single_rule() {
        let sheets = idx(vec![(
            "styles.css".to_string(),
            ".hero { color: red; }".to_string(),
        )]);
        let res = resolve_in_sheets(&sheets, &sig("hero"), None);
        match res {
            CssResolution::Resolved {
                file,
                selector,
                declarations,
                ..
            } => {
                assert_eq!(file, "styles.css");
                assert_eq!(selector, ".hero");
                assert_eq!(declarations.len(), 1);
                assert_eq!(declarations[0].property, "color");
            }
            other => panic!("expected resolved, got {other:?}"),
        }
    }

    #[test]
    fn resolves_last_class_token_by_default() {
        let sheets = idx(vec![(
            "s.css".to_string(),
            ".card { color: red; }\n.card-title { font-weight: 700; }".to_string(),
        )]);
        let res = resolve_in_sheets(&sheets, &sig("card card-title"), None);
        match res {
            CssResolution::Resolved { selector, .. } => assert_eq!(selector, ".card-title"),
            other => panic!("expected resolved, got {other:?}"),
        }
    }

    #[test]
    fn duplicate_rules_resolve_to_multiple() {
        let sheets = idx(vec![
            ("a.css".to_string(), ".hero { color: red; }".to_string()),
            ("b.css".to_string(), ".hero { color: blue; }".to_string()),
        ]);
        let res = resolve_in_sheets(&sheets, &sig("hero"), None);
        match res {
            CssResolution::Multiple { locations, .. } => assert_eq!(locations.len(), 2),
            other => panic!("expected multiple, got {other:?}"),
        }
    }

    #[test]
    fn missing_rule_resolves_to_not_found() {
        let sheets = idx(vec![(
            "s.css".to_string(),
            ".other { color: red; }".to_string(),
        )]);
        let res = resolve_in_sheets(&sheets, &sig("hero"), None);
        assert_eq!(
            res,
            CssResolution::NotFound {
                selector: ".hero".into()
            }
        );
    }

    #[test]
    fn no_class_resolves_to_needs_class_or_inline() {
        let sheets: Vec<SheetIndex> = vec![];
        assert!(matches!(
            resolve_in_sheets(&sheets, &sig(""), None),
            CssResolution::NeedsClass { .. }
        ));
        let mut s = sig("");
        s.has_inline_style = true;
        assert!(matches!(
            resolve_in_sheets(&sheets, &s, None),
            CssResolution::Inline { .. }
        ));
    }

    #[test]
    fn breakpoint_resolves_into_matching_media_block() {
        let css =
            ".hero { color: red; }\n@media (min-width: 768px) {\n  .hero { color: green; }\n}";
        let sheets = idx(vec![("s.css".to_string(), css.to_string())]);

        let base = resolve_in_sheets(&sheets, &sig("hero"), None);
        match base {
            CssResolution::Resolved { declarations, .. } => {
                assert_eq!(declarations[0].value, "red")
            }
            other => panic!("expected base resolved, got {other:?}"),
        }
        let md = resolve_in_sheets(&sheets, &sig("hero"), Some(768));
        match md {
            CssResolution::Resolved {
                declarations,
                media_min_px,
                ..
            } => {
                assert_eq!(declarations[0].value, "green");
                assert_eq!(media_min_px, Some(768));
            }
            other => panic!("expected media resolved, got {other:?}"),
        }
    }

    // ── apply_declaration_to_source ──

    #[test]
    fn apply_to_source_updates_correct_media_layer() {
        let css =
            ".hero {\n  color: red;\n}\n@media (min-width: 768px) {\n  .hero {\n    color: green;\n  }\n}";
        let out = apply_declaration_to_source(css, ".hero", Some(768), "color", Some("blue"))
            .expect("edit applies");
        assert!(out.contains("color: red;")); // base untouched
        assert!(out.contains("color: blue;")); // media updated
        assert!(!out.contains("color: green;"));
    }

    #[test]
    fn apply_to_source_fails_closed_on_missing_rule() {
        let css = ".other { color: red; }";
        let err = apply_declaration_to_source(css, ".hero", None, "color", Some("blue"));
        assert!(matches!(err, Err(CommandError::Validation { .. })));
    }

    #[test]
    fn apply_to_source_fails_closed_on_ambiguous_rule() {
        let css = ".hero { color: red; }\n.hero { color: blue; }";
        let err = apply_declaration_to_source(css, ".hero", None, "color", Some("green"));
        assert!(matches!(err, Err(CommandError::Validation { .. })));
    }

    // ── build_rule_text ──

    #[test]
    fn builds_base_rule_text() {
        let decls = vec![
            Declaration {
                property: "color".into(),
                value: "red".into(),
                important: false,
            },
            Declaration {
                property: "padding".into(),
                value: "24px".into(),
                important: true,
            },
        ];
        let out = build_rule_text(".hero", &decls, None);
        assert_eq!(
            out,
            ".hero {\n  color: red;\n  padding: 24px !important;\n}"
        );
    }

    #[test]
    fn builds_media_wrapped_rule_text() {
        let decls = vec![Declaration {
            property: "color".into(),
            value: "red".into(),
            important: false,
        }];
        let out = build_rule_text(".hero", &decls, Some(768));
        assert_eq!(
            out,
            "@media (min-width: 768px) {\n  .hero {\n    color: red;\n  }\n}"
        );
    }

    // ───────────── Code-first cascade editor: locate + rule-text write ─────────────

    fn query(selector: &str, media_text: Option<&str>, href: Option<&str>) -> MatchedRuleQuery {
        MatchedRuleQuery {
            selector: selector.into(),
            media_text: media_text.map(|s| s.into()),
            href: href.map(|s| s.into()),
        }
    }

    #[test]
    fn locates_a_single_rule_with_verbatim_body() {
        let sheets = idx(vec![(
            "styles.css".into(),
            ".btn {\n  padding: 10px;\n  color: red;\n}\n".into(),
        )]);
        match locate_rule(&sheets, &query(".btn", None, None)) {
            RuleLocation::Resolved {
                file,
                line,
                inner_text,
            } => {
                assert_eq!(file, "styles.css");
                assert_eq!(line, 1);
                assert_eq!(inner_text, "\n  padding: 10px;\n  color: red;\n");
            }
            other => panic!("expected resolved, got {other:?}"),
        }
    }

    #[test]
    fn matches_selector_ignoring_combinator_whitespace() {
        // Authored `.a>.b`; browser reports `.a > .b` — they must resolve to each other.
        let sheets = idx(vec![("s.css".into(), ".a>.b {\n  gap: 1rem;\n}\n".into())]);
        assert!(matches!(
            locate_rule(&sheets, &query(".a > .b", None, None)),
            RuleLocation::Resolved { .. }
        ));
    }

    #[test]
    fn locates_media_scoped_rule_by_full_condition_not_just_min_width() {
        // Base + a MAX-width variant (the case that collided under min-width matching).
        let sheets = idx(vec![(
            "s.css".into(),
            ".x {\n  color: red;\n}\n@media (max-width: 768px) {\n  .x {\n    color: blue;\n  }\n}\n"
                .into(),
        )]);
        // Base query (no media) resolves to the base rule, NOT the media one.
        assert!(matches!(
            locate_rule(&sheets, &query(".x", None, None)),
            RuleLocation::Resolved { line, .. } if line == 1
        ));
        // The max-width variant resolves to its OWN rule (line 5), whitespace-insensitive.
        assert!(matches!(
            locate_rule(&sheets, &query(".x", Some("(max-width:768px)"), None)),
            RuleLocation::Resolved { line, .. } if line == 5
        ));
    }

    #[test]
    fn reports_not_found_for_unmapped_match() {
        let sheets = idx(vec![("s.css".into(), ".a { color: red; }".into())]);
        assert_eq!(
            locate_rule(&sheets, &query(".ghost", None, None)),
            RuleLocation::NotFound
        );
    }

    #[test]
    fn duplicate_selector_is_multiple_unless_href_disambiguates() {
        let sheets = idx(vec![
            ("a.css".into(), ".dup { color: red; }".into()),
            ("nested/b.css".into(), ".dup { color: blue; }".into()),
        ]);
        // Ambiguous without a hint.
        assert!(matches!(
            locate_rule(&sheets, &query(".dup", None, None)),
            RuleLocation::Multiple { .. }
        ));
        // The served href's basename pins exactly one file.
        match locate_rule(
            &sheets,
            &query(".dup", None, Some("http://localhost:5173/nested/b.css?v=9")),
        ) {
            RuleLocation::Resolved { file, .. } => assert_eq!(file, "nested/b.css"),
            other => panic!("expected resolved via href, got {other:?}"),
        }
    }

    #[test]
    fn writes_edited_rule_body_verbatim_when_drift_guard_holds() {
        let src = ".btn {\n  padding: 10px;\n}\n.other { color: red; }\n";
        let old_inner = "\n  padding: 10px;\n";
        let new_inner = "\n  padding: 2rem;\n  gap: 1rem;\n";
        let out = apply_rule_text_to_source(src, ".btn", &None, old_inner, new_inner).unwrap();
        assert_eq!(
            out,
            ".btn {\n  padding: 2rem;\n  gap: 1rem;\n}\n.other { color: red; }\n"
        );
    }

    #[test]
    fn writes_nested_css_into_a_rule_body() {
        // A rule with nested children: index_rules still finds the OUTER rule's full
        // span (its nested blocks are balanced), so a nested edit round-trips.
        let src = ".card {\n  color: red;\n}\n";
        let nested = "\n  color: red;\n  &:hover { color: blue; }\n";
        let out =
            apply_rule_text_to_source(src, ".card", &None, "\n  color: red;\n", nested).unwrap();
        assert_eq!(
            out,
            ".card {\n  color: red;\n  &:hover { color: blue; }\n}\n"
        );
        // The outer rule is still locatable after the nested write.
        assert!(matches!(
            locate_rule(
                &idx(vec![("s.css".into(), out)]),
                &query(".card", None, None)
            ),
            RuleLocation::Resolved { .. }
        ));
    }

    #[test]
    fn balanced_braces_are_allowed_unbalanced_are_not() {
        assert!(braces_balanced(
            "\n  color: red;\n  &:hover { color: blue; }\n"
        ));
        assert!(braces_balanced("\n  content: '{';\n")); // brace in a string is fine
        assert!(braces_balanced("\n  /* } */ color: red;\n")); // brace in a comment is fine
        assert!(!braces_balanced("\n  color: red;\n}\n.evil { x: y;\n")); // breaks out
        assert!(!braces_balanced("\n  & { color: red;\n")); // unclosed
    }

    #[test]
    fn rule_text_write_is_fail_closed_on_drift() {
        let src = ".btn {\n  padding: 10px;\n}\n";
        // `old_inner` no longer matches the file → reject rather than clobber.
        let err =
            apply_rule_text_to_source(src, ".btn", &None, "\n  padding: 99px;\n", "\n  x: y;\n")
                .unwrap_err();
        assert!(matches!(err, CommandError::Validation { field, .. } if field == "css"));
    }

    #[test]
    fn deletes_a_whole_rule_with_its_line_and_trailing_newline() {
        let src = ".a { color: red; }\n.btn {\n  padding: 10px;\n}\n.c { x: y; }\n";
        let out = remove_rule_from_source(src, ".btn", &None, "\n  padding: 10px;\n").unwrap();
        assert_eq!(out, ".a { color: red; }\n.c { x: y; }\n");
    }

    #[test]
    fn deletes_a_media_scoped_rule_not_the_base() {
        let src = ".x { color: red; }\n@media (max-width: 768px) {\n  .x { color: blue; }\n}\n";
        // Delete only the media variant; the base rule stays.
        let out = remove_rule_from_source(
            src,
            ".x",
            &Some("(max-width: 768px)".into()),
            " color: blue; ",
        )
        .unwrap();
        assert!(out.contains(".x { color: red; }"));
        assert!(!out.contains("color: blue"));
    }

    #[test]
    fn wraps_a_rule_in_a_media_query_and_stays_locatable() {
        let src = ".btn {\n  padding: 10px;\n}\n";
        let out = wrap_rule_in_source(
            src,
            ".btn",
            &None,
            "@media (max-width: 768px)",
            "\n  padding: 10px;\n",
        )
        .unwrap();
        assert_eq!(
            out,
            "@media (max-width: 768px) {\n  .btn {\n    padding: 10px;\n  }\n}\n"
        );
        // The wrapped rule is still resolvable under its new media condition.
        assert!(matches!(
            locate_rule(
                &idx(vec![("s.css".into(), out)]),
                &query(".btn", Some("(max-width: 768px)"), None)
            ),
            RuleLocation::Resolved { .. }
        ));
    }

    #[test]
    fn renames_a_rule_selector_to_a_complex_one() {
        let src = ".btn {\n  padding: 10px;\n}\n";
        let out = rename_selector_in_source(
            src,
            ".btn",
            &None,
            "\n  padding: 10px;\n",
            ".card > .btn:hover",
        )
        .unwrap();
        assert_eq!(out, ".card > .btn:hover {\n  padding: 10px;\n}\n");
    }

    #[test]
    fn rename_rejects_a_selector_with_braces() {
        let src = ".btn { x: y; }";
        assert!(rename_selector_in_source(src, ".btn", &None, " x: y; ", ".a { }").is_err());
    }

    #[test]
    fn renames_an_at_rule_condition_in_place() {
        let src = "@media (max-width: 768px) {\n  .x { color: red; }\n}\n";
        let out = rename_at_rule_in_source(
            src,
            ".x",
            &Some("(max-width: 768px)".into()),
            " color: red; ",
            "(min-width: 1024px)",
        )
        .unwrap();
        assert_eq!(
            out,
            "@media (min-width: 1024px) {\n  .x { color: red; }\n}\n"
        );
    }

    #[test]
    fn rename_at_rule_fails_for_a_base_rule() {
        let src = ".x { color: red; }";
        assert!(
            rename_at_rule_in_source(src, ".x", &None, " color: red; ", "(max-width: 768px)")
                .is_err()
        );
    }

    #[test]
    fn wrap_rejects_a_non_at_prelude() {
        let src = ".btn {\n  padding: 10px;\n}\n";
        assert!(
            wrap_rule_in_source(src, ".btn", &None, ".not-an-at", "\n  padding: 10px;\n").is_err()
        );
    }

    #[test]
    fn delete_is_fail_closed_on_drift_or_ambiguity() {
        let src = ".btn {\n  padding: 10px;\n}\n";
        assert!(remove_rule_from_source(src, ".btn", &None, "\n  WRONG;\n").is_err());
        let dup = ".a { color: red; }\n.a { color: blue; }";
        assert!(remove_rule_from_source(dup, ".a", &None, " color: red; ").is_err());
    }

    #[test]
    fn rule_text_write_rejects_a_missing_or_ambiguous_rule() {
        let one = ".a { color: red; }";
        assert!(apply_rule_text_to_source(one, ".missing", &None, "", " color: blue; ").is_err());
        let dup = ".a { color: red; }\n.a { color: blue; }";
        assert!(
            apply_rule_text_to_source(dup, ".a", &None, " color: red; ", " color: green; ")
                .is_err()
        );
    }
}
