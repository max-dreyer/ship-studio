//! # Profile Management Commands
//!
//! Profiles isolate credentials per client/context (Personal, Work, Company A…).
//! Profile metadata (name, color) is stored in AppState. Credentials are stored
//! in the macOS Keychain via the `security` CLI — values never leave the Rust layer.
//!
//! ## Credential injection
//!
//! Call `get_env_vars_for_project(project_path)` to get a `HashMap<String, String>`
//! of environment variables that should be injected when spawning CLI tools for a
//! given project. This is the integration point used by github.rs, publishing.rs,
//! pull_requests.rs, and mcp.rs.

use crate::commands::setup::{read_app_state, write_app_state};
use crate::errors::CommandError;
use crate::types::{Profile, ProfileCredentialStatus};
use std::collections::HashMap;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

/// The ID of the built-in default profile. Always exists; cannot be deleted.
pub const DEFAULT_PROFILE_ID: &str = "default";

const KEYCHAIN_PREFIX: &str = "ship-studio-profile-";

/// Credential key → injected environment variable name.
const CRED_ENV_VARS: &[(&str, &str)] = &[
    ("anthropic_api_key", "ANTHROPIC_API_KEY"),
    ("anthropic_base_url", "ANTHROPIC_BASE_URL"),
    ("github_token", "GITHUB_TOKEN"),
    ("vercel_token", "VERCEL_TOKEN"),
    ("figma_token", "FIGMA_PERSONAL_ACCESS_TOKEN"),
    ("openai_api_key", "OPENAI_API_KEY"),
];

/// All credential keys (including git identity which isn't an env var).
const ALL_CRED_KEYS: &[&str] = &[
    "anthropic_api_key",
    "anthropic_base_url",
    "github_token",
    "vercel_token",
    "figma_token",
    "openai_api_key",
    "git_name",
    "git_email",
];

// ============ Keychain helpers (macOS `security` CLI) ============

fn keychain_service(profile_id: &str) -> String {
    format!("{KEYCHAIN_PREFIX}{profile_id}")
}

fn write_to_keychain(profile_id: &str, key: &str, value: &str) -> Result<(), CommandError> {
    let service = keychain_service(profile_id);
    let status = Command::new("security")
        .args([
            "add-generic-password",
            "-U",
            "-a",
            key,
            "-s",
            &service,
            "-w",
            value,
        ])
        .status()
        .map_err(|e| format!("Keychain write failed: {e}"))?;

    if !status.success() {
        return Err(format!("Failed to store credential '{key}' in keychain").into());
    }
    Ok(())
}

fn read_from_keychain(profile_id: &str, key: &str) -> Option<String> {
    let service = keychain_service(profile_id);
    let output = Command::new("security")
        .args(["find-generic-password", "-a", key, "-s", &service, "-w"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }
    let value = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

fn delete_from_keychain(profile_id: &str, key: &str) {
    let service = keychain_service(profile_id);
    let _ = Command::new("security")
        .args(["delete-generic-password", "-a", key, "-s", &service])
        .status();
}

fn delete_all_profile_credentials(profile_id: &str) {
    for key in ALL_CRED_KEYS {
        delete_from_keychain(profile_id, key);
    }
}

// ============ Internal helpers ============

/// Returns env vars to inject for the project's assigned profile.
/// Falls back to the default profile when no profile is assigned.
pub fn get_env_vars_for_project(project_path: &str) -> HashMap<String, String> {
    let state = read_app_state();
    let profile_id = state
        .project_profiles
        .get(project_path)
        .cloned()
        .unwrap_or_else(|| DEFAULT_PROFILE_ID.to_string());
    get_env_vars_for_profile(&profile_id)
}

/// Returns env vars for a specific profile.
pub fn get_env_vars_for_profile(profile_id: &str) -> HashMap<String, String> {
    let mut vars = HashMap::new();
    for (key, env_name) in CRED_ENV_VARS {
        if let Some(value) = read_from_keychain(profile_id, key) {
            vars.insert(env_name.to_string(), value);
        }
    }
    vars
}

/// Returns the git identity (name, email) for the given project's profile.
/// Returns `(None, None)` if no git identity is stored in the profile.
pub fn get_git_identity_for_project(project_path: &str) -> (Option<String>, Option<String>) {
    let state = read_app_state();
    let profile_id = state
        .project_profiles
        .get(project_path)
        .cloned()
        .unwrap_or_else(|| DEFAULT_PROFILE_ID.to_string());
    let name = read_from_keychain(&profile_id, "git_name");
    let email = read_from_keychain(&profile_id, "git_email");
    (name, email)
}

fn ensure_default_profile(state: &mut crate::types::AppState) {
    if !state.profiles.iter().any(|p| p.id == DEFAULT_PROFILE_ID) {
        state.profiles.insert(
            0,
            Profile {
                id: DEFAULT_PROFILE_ID.to_string(),
                name: "Default".to_string(),
                color: "#6b7280".to_string(),
                is_default: true,
                created_at: now_ms(),
            },
        );
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn stamp_git_identity(
    project_path: &str,
    name: Option<&str>,
    email: Option<&str>,
) -> Result<(), CommandError> {
    if let Some(n) = name {
        Command::new("git")
            .args(["config", "--local", "user.name", n])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to set git user.name: {e}"))?;
    }
    if let Some(e) = email {
        Command::new("git")
            .args(["config", "--local", "user.email", e])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to set git user.email: {e}"))?;
    }
    Ok(())
}

// ============ Tauri commands ============

/// List all profiles. Creates the Default profile on first call.
#[tauri::command]
#[tracing::instrument]
pub fn list_profiles() -> Result<Vec<Profile>, CommandError> {
    let mut state = read_app_state();
    ensure_default_profile(&mut state);
    write_app_state(&state)?;
    Ok(state.profiles)
}

/// Create a new profile.
#[tauri::command]
#[tracing::instrument]
pub fn create_profile(name: String, color: String) -> Result<Profile, CommandError> {
    if name.trim().is_empty() {
        return Err(CommandError::Validation {
            field: "name".into(),
            reason: "Profile name cannot be empty".into(),
        });
    }
    let mut state = read_app_state();
    ensure_default_profile(&mut state);

    let profile = Profile {
        id: uuid::Uuid::new_v4().to_string(),
        name: name.trim().to_string(),
        color,
        is_default: false,
        created_at: now_ms(),
    };
    state.profiles.push(profile.clone());
    write_app_state(&state)?;
    tracing::info!(name = %profile.name, "Profile created");
    Ok(profile)
}

/// Update a profile's name and color.
#[tauri::command]
#[tracing::instrument]
pub fn update_profile(id: String, name: String, color: String) -> Result<Profile, CommandError> {
    if name.trim().is_empty() {
        return Err(CommandError::Validation {
            field: "name".into(),
            reason: "Profile name cannot be empty".into(),
        });
    }
    let mut state = read_app_state();
    let profile = state
        .profiles
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or_else(|| CommandError::Other {
            message: format!("Profile '{id}' not found"),
        })?;

    profile.name = name.trim().to_string();
    profile.color = color;
    let updated = profile.clone();
    write_app_state(&state)?;
    Ok(updated)
}

/// Delete a profile. The Default profile cannot be deleted.
/// Projects using the deleted profile are reassigned to Default.
#[tauri::command]
#[tracing::instrument]
pub fn delete_profile(id: String) -> Result<(), CommandError> {
    if id == DEFAULT_PROFILE_ID {
        return Err(CommandError::Validation {
            field: "id".into(),
            reason: "Cannot delete the Default profile".into(),
        });
    }
    let mut state = read_app_state();
    let before = state.profiles.len();
    state.profiles.retain(|p| p.id != id);
    if state.profiles.len() == before {
        return Err(CommandError::Other {
            message: format!("Profile '{id}' not found"),
        });
    }

    // Reassign projects on this profile → Default
    for val in state.project_profiles.values_mut() {
        if *val == id {
            *val = DEFAULT_PROFILE_ID.to_string();
        }
    }

    delete_all_profile_credentials(&id);
    write_app_state(&state)?;
    tracing::info!(id = %id, "Profile deleted");
    Ok(())
}

/// Get the profile ID assigned to a project. Returns "default" if none assigned.
#[tauri::command]
#[tracing::instrument]
pub fn get_project_profile_id(project_path: String) -> Result<String, CommandError> {
    let state = read_app_state();
    let id = state
        .project_profiles
        .get(&project_path)
        .cloned()
        .unwrap_or_else(|| DEFAULT_PROFILE_ID.to_string());
    Ok(id)
}

/// Assign a profile to a project. Also stamps the profile's git identity onto
/// the repo's local config (best-effort; silently skipped if git identity is unset).
#[tauri::command]
#[tracing::instrument]
pub async fn set_project_profile_id(
    project_path: String,
    profile_id: String,
) -> Result<(), CommandError> {
    let mut state = read_app_state();
    ensure_default_profile(&mut state);

    if !state.profiles.iter().any(|p| p.id == profile_id) {
        return Err(CommandError::Validation {
            field: "profile_id".into(),
            reason: format!("Profile '{profile_id}' does not exist"),
        });
    }

    state
        .project_profiles
        .insert(project_path.clone(), profile_id.clone());
    write_app_state(&state)?;

    let git_name = read_from_keychain(&profile_id, "git_name");
    let git_email = read_from_keychain(&profile_id, "git_email");
    if git_name.is_some() || git_email.is_some() {
        let _ = stamp_git_identity(&project_path, git_name.as_deref(), git_email.as_deref());
    }

    tracing::info!(project = %project_path, profile = %profile_id, "Project profile assigned");
    Ok(())
}

/// Return which credential keys are set for a profile.
/// Values never leave the Rust layer — callers only learn presence/absence.
#[tauri::command]
#[tracing::instrument]
pub fn get_profile_credential_status(
    profile_id: String,
) -> Result<ProfileCredentialStatus, CommandError> {
    Ok(ProfileCredentialStatus {
        has_anthropic_api_key: read_from_keychain(&profile_id, "anthropic_api_key").is_some(),
        has_anthropic_base_url: read_from_keychain(&profile_id, "anthropic_base_url").is_some(),
        has_github_token: read_from_keychain(&profile_id, "github_token").is_some(),
        has_vercel_token: read_from_keychain(&profile_id, "vercel_token").is_some(),
        has_figma_token: read_from_keychain(&profile_id, "figma_token").is_some(),
        has_openai_api_key: read_from_keychain(&profile_id, "openai_api_key").is_some(),
        has_git_name: read_from_keychain(&profile_id, "git_name").is_some(),
        has_git_email: read_from_keychain(&profile_id, "git_email").is_some(),
    })
}

/// Store a credential in the keychain for a profile.
///
/// Allowed keys: `anthropic_api_key`, `anthropic_base_url`, `github_token`,
/// `vercel_token`, `figma_token`, `openai_api_key`, `git_name`, `git_email`
#[tauri::command]
#[tracing::instrument(skip(value))]
pub fn set_profile_credential(
    profile_id: String,
    key: String,
    value: String,
) -> Result<(), CommandError> {
    if !ALL_CRED_KEYS.contains(&key.as_str()) {
        return Err(CommandError::Validation {
            field: "key".into(),
            reason: format!("Unknown credential key '{key}'"),
        });
    }
    if value.trim().is_empty() {
        return Err(CommandError::Validation {
            field: "value".into(),
            reason: "Credential value cannot be empty".into(),
        });
    }
    write_to_keychain(&profile_id, &key, value.trim())
}

/// Remove a credential from the keychain for a profile.
#[tauri::command]
#[tracing::instrument]
pub fn clear_profile_credential(profile_id: String, key: String) -> Result<(), CommandError> {
    delete_from_keychain(&profile_id, &key);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_service_uses_prefix() {
        assert_eq!(keychain_service("default"), "ship-studio-profile-default");
        assert_eq!(keychain_service("abc-123"), "ship-studio-profile-abc-123");
    }

    #[test]
    fn get_env_vars_skips_unset_keys() {
        // For a profile that has no credentials, the map should be empty.
        // (Keychain reads return None for non-existent entries.)
        let vars = get_env_vars_for_profile("nonexistent-profile-xyz-test");
        assert!(vars.is_empty());
    }
}
