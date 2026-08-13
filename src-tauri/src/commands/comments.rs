//! # Preview Comments
//!
//! Notes the user pins to elements in the live preview, to be handed to the
//! agent in bulk. Stored per project in `.shipstudio/comments.json`.
//!
//! Rebuilt from the specification in `docs/recovery/lost-features.md` after the
//! original was lost; the command surface, the storage filename and the error
//! strings are recovered verbatim so the frontend contract is unchanged.
//!
//! Two rules carry the design:
//!
//! - A note that has already gone to the agent is history. It can be deleted,
//!   but not re-anchored, because the agent was told about a specific element.
//! - Sending marks only the ids the caller confirms were received, so a
//!   terminal that swallowed the paste doesn't silently lose the notes.

use crate::errors::CommandError;
use crate::utils::validate_project_path;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Bump when the on-disk shape changes incompatibly.
pub const COMMENTS_SCHEMA_VERSION: u32 = 1;

/// One note, anchored to an element in the preview.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PreviewComment {
    pub id: String,
    /// Structural path to the element inside the previewed document, produced
    /// by the injected select script. Opaque here: the backend stores and
    /// returns it, only the iframe knows how to resolve it.
    pub dom_path: String,
    /// Page the note was left on, so the panel can group by page.
    #[serde(default)]
    pub url: String,
    /// Short human label for the element (`h1.hero`), for the list.
    #[serde(default)]
    pub label: String,
    /// A snippet of the element's own text, captured when the note was made.
    /// Empty for notes written before this was recorded — the agent message
    /// simply omits the quote rather than inventing one.
    #[serde(default)]
    pub element_text: String,
    pub text: String,
    /// Unix millis. Ordering in the panel is by this.
    pub added_at: i64,
    /// Set once the note actually reached the agent.
    #[serde(default)]
    pub sent: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CommentsFile {
    schema_version: u32,
    comments: Vec<PreviewComment>,
}

impl Default for CommentsFile {
    fn default() -> Self {
        Self {
            schema_version: COMMENTS_SCHEMA_VERSION,
            comments: Vec::new(),
        }
    }
}

/// The shape an earlier implementation of comment mode wrote.
///
/// Different names for the same things (`body`/`text`, `route`/`url`,
/// `created_at`/`added_at`), a timestamp where we keep a flag, and a richer
/// element description we no longer need in full. It also claims
/// `schema_version: 1`, so the version can't tell the two apart — reading is
/// try-new-then-this. Read-only: the next save writes the current shape.
#[derive(Debug, Deserialize)]
struct LegacyComment {
    id: String,
    dom_path: String,
    #[serde(default)]
    route: String,
    #[serde(default)]
    tag_name: String,
    #[serde(default)]
    class_name: String,
    body: String,
    created_at: i64,
    /// When it went to the agent, or null. We only keep whether it did.
    #[serde(default)]
    sent_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct LegacyFile {
    comments: Vec<LegacyComment>,
}

impl From<LegacyComment> for PreviewComment {
    fn from(old: LegacyComment) -> Self {
        // Rebuild the short label from the parts that used to be stored
        // separately: `p.hero`, or just `p` for an unclassed element.
        let first_class = old
            .class_name
            .split_whitespace()
            .next()
            .unwrap_or_default()
            .to_string();
        let label = match (old.tag_name.as_str(), first_class.as_str()) {
            ("", _) => String::new(),
            (tag, "") => tag.to_string(),
            (tag, cls) => format!("{tag}.{cls}"),
        };
        PreviewComment {
            id: old.id,
            dom_path: old.dom_path,
            url: if old.route.is_empty() {
                "/".to_string()
            } else {
                old.route
            },
            label,
            // The old format never stored this.
            element_text: String::new(),
            text: old.body,
            added_at: old.created_at,
            sent: old.sent_at.is_some(),
        }
    }
}

fn comments_path(project_path: &str) -> Result<PathBuf, CommandError> {
    let root = validate_project_path(project_path)?;
    Ok(root.join(".shipstudio").join("comments.json"))
}

/// Read the file, treating "missing" as "no comments yet".
///
/// A corrupt file is an error rather than a silent reset: these are the user's
/// own words, and quietly starting over would throw them away.
fn load(project_path: &str) -> Result<CommentsFile, CommandError> {
    let path = comments_path(project_path)?;
    if !path.exists() {
        return Ok(CommentsFile::default());
    }
    let contents = std::fs::read_to_string(&path).map_err(|e| CommandError::Io {
        message: format!("Failed to read preview comments: {e}"),
    })?;
    let current = match serde_json::from_str::<CommentsFile>(&contents) {
        Ok(file) => return Ok(file),
        Err(e) => e,
    };
    // Try the older shape before giving up. Only if that fails too is the file
    // genuinely unreadable, and the error names the current-format failure —
    // the legacy one would just be confusing.
    match serde_json::from_str::<LegacyFile>(&contents) {
        Ok(old) => Ok(CommentsFile {
            schema_version: COMMENTS_SCHEMA_VERSION,
            comments: old.comments.into_iter().map(Into::into).collect(),
        }),
        Err(_) => Err(CommandError::Io {
            message: format!(
                "\"{}\" is not readable as comment data ({current})",
                path.display()
            ),
        }),
    }
}

fn save(project_path: &str, file: &CommentsFile) -> Result<(), CommandError> {
    let path = comments_path(project_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| CommandError::Io {
            message: format!("Failed to create .shipstudio directory: {e}"),
        })?;
    }
    let json = serde_json::to_string_pretty(file).map_err(|e| CommandError::Io {
        message: format!("Failed to serialize preview comments: {e}"),
    })?;
    std::fs::write(&path, json).map_err(|e| CommandError::Io {
        message: format!("Failed to write preview comments: {e}"),
    })
}

fn missing_comment() -> CommandError {
    CommandError::Validation {
        field: "id".into(),
        reason: "That comment no longer exists.".into(),
    }
}

fn require_text(text: &str) -> Result<String, CommandError> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err(CommandError::Validation {
            field: "text".into(),
            reason: "A comment needs some text".into(),
        });
    }
    Ok(trimmed.to_string())
}

/// Every note for the project, oldest first.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub async fn list_preview_comments(
    project_path: String,
) -> Result<Vec<PreviewComment>, CommandError> {
    let mut file = load(&project_path)?;
    file.comments.sort_by_key(|c| c.added_at);
    Ok(file.comments)
}

/// Add a note. The caller supplies the id so the pin can be drawn immediately,
/// before the write completes.
#[tauri::command]
#[tracing::instrument(skip(comment), fields(project = %project_path))]
pub async fn add_preview_comment(
    project_path: String,
    comment: PreviewComment,
) -> Result<PreviewComment, CommandError> {
    let stored = PreviewComment {
        text: require_text(&comment.text)?,
        // A new note has never been sent, whatever the caller claims.
        sent: false,
        ..comment
    };
    let mut file = load(&project_path)?;
    file.comments.push(stored.clone());
    save(&project_path, &file)?;
    Ok(stored)
}

/// Edit a note's text in place.
#[tauri::command]
#[tracing::instrument(skip(text), fields(project = %project_path, comment = %id))]
pub async fn update_preview_comment(
    project_path: String,
    id: String,
    text: String,
) -> Result<PreviewComment, CommandError> {
    let next = require_text(&text)?;
    let mut file = load(&project_path)?;
    let comment = file
        .comments
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(missing_comment)?;
    comment.text = next;
    let updated = comment.clone();
    save(&project_path, &file)?;
    Ok(updated)
}

#[tauri::command]
#[tracing::instrument(fields(project = %project_path, comment = %id))]
pub async fn delete_preview_comment(project_path: String, id: String) -> Result<(), CommandError> {
    let mut file = load(&project_path)?;
    let before = file.comments.len();
    file.comments.retain(|c| c.id != id);
    if file.comments.len() == before {
        return Err(missing_comment());
    }
    save(&project_path, &file)
}

/// Point a note at a different element.
///
/// Refused once the note has been sent: the agent was told about a specific
/// element, so silently moving it would make the conversation a lie.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path, comment = %id))]
pub async fn reanchor_preview_comment(
    project_path: String,
    id: String,
    dom_path: String,
    label: String,
) -> Result<PreviewComment, CommandError> {
    let mut file = load(&project_path)?;
    let comment = file
        .comments
        .iter_mut()
        .find(|c| c.id == id)
        .ok_or_else(missing_comment)?;
    if comment.sent {
        return Err(CommandError::Validation {
            field: "id".into(),
            reason:
                "That note has already gone to the agent, so it can't be moved. Delete it and leave a new one."
                    .into(),
        });
    }
    comment.dom_path = dom_path;
    comment.label = label;
    let updated = comment.clone();
    save(&project_path, &file)?;
    Ok(updated)
}

/// Mark exactly the notes the caller confirms reached the agent.
///
/// Plural on purpose, and only these ids: if the terminal accepted three of
/// five, the other two must stay unsent rather than vanish from the user's
/// list as if handled.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path, count = ids.len()))]
pub async fn mark_preview_comments_sent(
    project_path: String,
    ids: Vec<String>,
) -> Result<Vec<PreviewComment>, CommandError> {
    if ids.is_empty() {
        return list_preview_comments(project_path).await;
    }
    let mut file = load(&project_path)?;
    for comment in file.comments.iter_mut() {
        if ids.contains(&comment.id) {
            comment.sent = true;
        }
    }
    save(&project_path, &file)?;
    let mut out = file.comments;
    out.sort_by_key(|c| c.added_at);
    Ok(out)
}

/// Drop every note that has been sent, keeping the rest.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub async fn clear_sent_preview_comments(
    project_path: String,
) -> Result<Vec<PreviewComment>, CommandError> {
    let mut file = load(&project_path)?;
    file.comments.retain(|c| !c.sent);
    save(&project_path, &file)?;
    let mut out = file.comments;
    out.sort_by_key(|c| c.added_at);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A file written by the earlier implementation, field for field as found
    /// on disk. Anything less faithful wouldn't prove the migration works.
    const LEGACY_FILE: &str = r#"{
      "schema_version": 1,
      "comments": [
        {
          "id": "29fb8612-72fa-4aaa-b7f8-571b9add3143",
          "route": "/kontakt",
          "dom_path": "body:1>div:4>main:4>p:1",
          "tag_name": "p",
          "class_name": "seiten-inhalt gross",
          "text_snippet": "Ich bin Max.",
          "attr_src": null,
          "ancestor_classes": ["seiten-inhalt"],
          "body": "Test 123",
          "created_at": 1786604696000,
          "sent_at": null,
          "source_file": null,
          "source_line": null,
          "confidence": null,
          "ambiguous_count": null,
          "rect": { "top": 386.0, "left": 361.1, "width": 658.6, "height": 84.0 }
        }
      ]
    }"#;

    #[test]
    fn reads_the_previous_on_disk_format() {
        let file: LegacyFile = serde_json::from_str(LEGACY_FILE).expect("legacy file parses");
        let migrated: Vec<PreviewComment> = file
            .comments
            .into_iter()
            .map(Into::into)
            .collect::<Vec<_>>();

        assert_eq!(migrated.len(), 1);
        let c = &migrated[0];
        // The note itself is what matters — losing it would be the real bug.
        assert_eq!(c.text, "Test 123");
        assert_eq!(c.id, "29fb8612-72fa-4aaa-b7f8-571b9add3143");
        assert_eq!(c.url, "/kontakt");
        assert_eq!(c.added_at, 1786604696000);
        // Label is rebuilt from the separately stored tag and first class.
        assert_eq!(c.label, "p.seiten-inhalt");
        // A null sent_at means it never reached the agent.
        assert!(!c.sent);
    }

    #[test]
    fn a_legacy_note_already_sent_stays_sent() {
        let json = LEGACY_FILE.replace("\"sent_at\": null", "\"sent_at\": 1786604700000");
        let file: LegacyFile = serde_json::from_str(&json).expect("parses");
        let migrated: PreviewComment = file.comments.into_iter().next().unwrap().into();
        assert!(migrated.sent);
    }

    #[test]
    fn an_unclassed_legacy_element_keeps_a_bare_tag_label() {
        let json = LEGACY_FILE.replace("\"seiten-inhalt gross\"", "\"\"");
        let file: LegacyFile = serde_json::from_str(&json).expect("parses");
        let migrated: PreviewComment = file.comments.into_iter().next().unwrap().into();
        assert_eq!(migrated.label, "p");
    }

    fn comment(id: &str, at: i64) -> PreviewComment {
        PreviewComment {
            id: id.into(),
            dom_path: "body>main>h1".into(),
            url: "/".into(),
            label: "h1".into(),
            element_text: String::new(),
            text: "make this bigger".into(),
            added_at: at,
            sent: false,
        }
    }

    #[test]
    fn rejects_blank_text_with_the_recovered_message() {
        let err = require_text("   ").unwrap_err();
        assert!(err.to_string().contains("A comment needs some text"));
    }

    #[test]
    fn trims_text_before_storing() {
        assert_eq!(require_text("  hello  ").unwrap(), "hello");
    }

    #[test]
    fn round_trips_through_json() {
        let file = CommentsFile {
            schema_version: COMMENTS_SCHEMA_VERSION,
            comments: vec![comment("a", 1)],
        };
        let json = serde_json::to_string(&file).unwrap();
        let back: CommentsFile = serde_json::from_str(&json).unwrap();
        assert_eq!(back.comments, file.comments);
    }

    #[test]
    fn reads_a_record_written_without_the_optional_fields() {
        // Older files (and hand-edits) may omit url/label/sent.
        let json = r#"{"schema_version":1,"comments":[
            {"id":"a","dom_path":"body>h1","text":"hi","added_at":5}
        ]}"#;
        let file: CommentsFile = serde_json::from_str(json).unwrap();
        assert!(!file.comments[0].sent);
        assert_eq!(file.comments[0].label, "");
    }
}
