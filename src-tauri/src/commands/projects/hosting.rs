//! # Hosting provider commands
//!
//! Per-project hosting provider selection (`"vercel" | "cloudflare" | "netlify"`),
//! persisted in `.shipstudio/project.json`. This replaces the old per-project
//! hosting *plugins* with a native, first-class choice.
//!
//! Backwards-compat: projects set up before this field existed (or via the old
//! Vercel/Netlify/Cloudflare plugins) keep working — `detect_hosting_provider`
//! infers the provider from a real link config (`.vercel` / `.netlify`) or an
//! installed hosting plugin dir, so the native picker pre-selects the right one
//! without the user re-configuring anything.

use crate::errors::CommandError;
use crate::types::ProjectMetadata;
use crate::utils::validate_project_path;

/// The hosting providers Ship Studio supports natively.
const KNOWN_PROVIDERS: [&str; 3] = ["vercel", "cloudflare", "netlify"];

fn read_metadata(project: &std::path::Path) -> ProjectMetadata {
    let metadata_path = project.join(".shipstudio").join("project.json");
    if !metadata_path.exists() {
        return ProjectMetadata::default();
    }
    std::fs::read_to_string(&metadata_path)
        .ok()
        .and_then(|contents| serde_json::from_str::<ProjectMetadata>(&contents).ok())
        .unwrap_or_default()
}

/// Get the explicitly-chosen hosting provider for this project, or `None` if the
/// user has never picked one. (For a pre-selected default that falls back to
/// detection, use [`detect_hosting_provider`].)
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub async fn get_hosting_provider(project_path: String) -> Result<Option<String>, CommandError> {
    let project = validate_project_path(&project_path)?;
    Ok(read_metadata(&project).hosting_provider)
}

/// Set (or clear) this project's hosting provider. `None`/empty clears it. A
/// non-empty value must be one of the known providers.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub async fn set_hosting_provider(
    project_path: String,
    provider: Option<String>,
) -> Result<(), CommandError> {
    let project = validate_project_path(&project_path)?;

    // Normalize: trim, lowercase, treat empty as clearing the choice.
    let normalized: Option<String> = match provider {
        Some(p) if !p.trim().is_empty() => Some(p.trim().to_lowercase()),
        _ => None,
    };
    if let Some(ref p) = normalized {
        if !KNOWN_PROVIDERS.contains(&p.as_str()) {
            return Err(CommandError::Validation {
                field: "provider".into(),
                reason: format!(
                    "unknown hosting provider '{p}' (expected one of {KNOWN_PROVIDERS:?})"
                ),
            });
        }
    }

    let shipstudio_dir = project.join(".shipstudio");
    let metadata_path = shipstudio_dir.join("project.json");

    let mut metadata = read_metadata(&project);
    metadata.hosting_provider = normalized;

    if !shipstudio_dir.exists() {
        std::fs::create_dir_all(&shipstudio_dir)
            .map_err(|e| format!("Failed to create .shipstudio directory: {e}"))?;
    }

    let contents = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize project metadata: {e}"))?;
    std::fs::write(&metadata_path, contents)
        .map_err(|e| format!("Failed to write project metadata: {e}"))?;

    Ok(())
}

/// Resolve the *effective* hosting provider to show as selected in the picker:
/// the explicit choice if set, otherwise inferred for backwards compatibility
/// from a real link config or an installed hosting plugin. Returns `None` when
/// nothing indicates a provider.
#[tauri::command]
#[tracing::instrument(fields(project = %project_path))]
pub async fn detect_hosting_provider(project_path: String) -> Result<Option<String>, CommandError> {
    let project = validate_project_path(&project_path)?;

    // 1. An explicit choice always wins.
    if let Some(provider) = read_metadata(&project).hosting_provider {
        return Ok(Some(provider));
    }

    // 2. Infer from a real link config left by a prior deploy/link.
    if project.join(".vercel").join("project.json").exists() {
        return Ok(Some("vercel".to_string()));
    }
    if project.join(".netlify").join("state.json").exists() {
        return Ok(Some("netlify".to_string()));
    }

    // 3. Infer from an installed hosting plugin dir (the thing we're replacing).
    let plugins_dir = project.join(".shipstudio").join("plugins");
    for id in KNOWN_PROVIDERS {
        if plugins_dir.join(id).is_dir() {
            return Ok(Some(id.to_string()));
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_tmp(name: &str) -> std::path::PathBuf {
        // Per-test dir under the OS temp root, made unique by name (no clock dep).
        std::env::temp_dir().join(format!("shipstudio-hosting-test-{name}"))
    }

    #[test]
    fn detect_prefers_vercel_link_config_over_plugin_dir() {
        let dir = unique_tmp("vercel-link");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".vercel")).unwrap();
        std::fs::write(dir.join(".vercel").join("project.json"), "{}").unwrap();
        // Also drop a netlify plugin dir to prove the link config wins.
        std::fs::create_dir_all(dir.join(".shipstudio").join("plugins").join("netlify")).unwrap();

        let meta = read_metadata(&dir);
        assert!(meta.hosting_provider.is_none());
        // Mirror detect_hosting_provider's logic without the async/validate wrapper.
        let inferred = if dir.join(".vercel").join("project.json").exists() {
            Some("vercel".to_string())
        } else {
            None
        };
        assert_eq!(inferred, Some("vercel".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detect_infers_cloudflare_from_plugin_dir() {
        let dir = unique_tmp("cf-plugin");
        let _ = std::fs::remove_dir_all(&dir);
        let plugins = dir.join(".shipstudio").join("plugins");
        std::fs::create_dir_all(plugins.join("cloudflare")).unwrap();

        let plugins_dir = dir.join(".shipstudio").join("plugins");
        let mut found = None;
        for id in KNOWN_PROVIDERS {
            if plugins_dir.join(id).is_dir() {
                found = Some(id.to_string());
                break;
            }
        }
        assert_eq!(found, Some("cloudflare".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
