//! # Moving and Mirroring a Project Between Forges
//!
//! Two operations for a project that already has a remote:
//!
//! - **Move**: create the project on the target forge, repoint `origin` at it,
//!   push everything. The old repository is left alone — never deleted — so a
//!   move that turns out to be wrong is undone by pointing `origin` back.
//! - **Mirror**: same, but added under a second remote name with `origin`
//!   untouched, for keeping a copy on another forge.
//!
//! Both create the repository *bare* (see [`crate::forge::repo::create_bare_args`]):
//! the project already has a remote, so the create-and-push shortcut the
//! new-project flow uses would fail on GitHub and re-init the repo on GitLab.
//! The remote is wired here instead, which also means the URL we record is the
//! one git actually got.

use crate::errors::CommandError;
use crate::external_command::truncate_output;
use crate::forge::{ForgeConfig, ForgeTransport};
use crate::utils::{create_command, find_executable, get_extended_path, validate_project_path};
use serde::Deserialize;

/// How long to allow for creating the repository on the forge.
const CREATE_TIMEOUT_SECS: u64 = 60;

/// Request to put a project on a different forge.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ForgeTransferOptions {
    pub project_path: String,
    /// Target forge id ("github" | "gitlab").
    pub forge_id: String,
    /// Repository name. On GitHub this may be `owner/name`; on GitLab it is a
    /// bare name and the project lands in the signed-in user's namespace.
    pub repo_name: String,
    pub is_private: bool,
    /// Remote to write. `origin` moves the project; any other name mirrors it
    /// alongside the existing remote.
    pub remote_name: String,
}

/// Result of a move or mirror.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeTransferResult {
    /// Web URL of the newly created repository.
    pub url: String,
    /// The remote that now points at it.
    pub remote_name: String,
    /// The URL the previous `origin` had, when this call replaced it. Returned
    /// so the UI can tell the user exactly what to restore if they want to
    /// undo — nothing else records it.
    pub previous_origin_url: Option<String>,
}

/// Build a command for a forge's CLI, scoped to the project's workspace.
fn forge_command(
    forge: &'static ForgeConfig,
    project_path: &std::path::Path,
) -> Result<std::process::Command, CommandError> {
    let ForgeTransport::Cli(binary) = forge.transport else {
        return Err(format!(
            "Ship Studio can't create repositories on {} yet.",
            forge.display_name
        )
        .into());
    };
    let mut cmd = if let Some(path) = find_executable(binary) {
        create_command(path)
    } else {
        create_command(binary)
    };
    cmd.env("PATH", get_extended_path());
    cmd.envs(crate::commands::accounts::get_env_vars_for_project(
        project_path,
    ));
    cmd.stdin(std::process::Stdio::null());
    Ok(cmd)
}

/// Read a remote's URL, or `None` when it isn't configured.
fn remote_url(project_path: &std::path::Path, remote: &str) -> Option<String> {
    let mut cmd = crate::utils::git_command_in(project_path).ok()?;
    let output = cmd.args(["remote", "get-url", remote]).output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|url| !url.is_empty())
}

/// Point `remote` at `url`, adding it when it doesn't exist yet.
async fn set_remote(
    project_path: &std::path::Path,
    remote: &str,
    url: &str,
) -> Result<(), CommandError> {
    let exists = remote_url(project_path, remote).is_some();
    let args: Vec<&str> = if exists {
        vec!["remote", "set-url", remote, url]
    } else {
        vec!["remote", "add", remote, url]
    };

    let output = crate::commands::git::run_git_net(&args, project_path, "remote").await?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "Created the repository, but wiring up the '{remote}' remote failed: {}",
            truncate_output(&stderr)
        )
        .into());
    }
    Ok(())
}

/// Create the repository on the target forge and wire a remote to it.
///
/// Shared by both commands; they differ only in which remote name they pass and
/// whether they record what `origin` used to be.
async fn transfer(options: ForgeTransferOptions) -> Result<ForgeTransferResult, CommandError> {
    let project = validate_project_path(&options.project_path)?;
    let forge = crate::forge::get_forge_by_id(&options.forge_id);

    let repo_name = options.repo_name.trim();
    if repo_name.is_empty() {
        return Err(CommandError::Validation {
            field: "repoName".to_string(),
            reason: "A repository name is required.".to_string(),
        });
    }

    // Capture this before anything changes, so the caller can undo a move.
    let previous_origin_url = remote_url(&project, "origin");

    let mut cmd = forge_command(forge, &project)?;
    cmd.args(crate::forge::repo::create_bare_args(
        forge,
        repo_name,
        options.is_private,
    ))
    .current_dir(&project);

    let label = crate::forge::repo::create_label(forge);
    let output = crate::external_command::run_with_timeout(
        tokio::process::Command::from(cmd),
        label.clone(),
        CREATE_TIMEOUT_SECS,
    )
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if crate::forge::repo::is_name_taken(&stderr) {
            return Err(CommandError::expected(format!(
                "A repository named \"{repo_name}\" already exists on this account. Choose a different name."
            )));
        }
        if let Some(err) = crate::forge::errors::classify(forge, &stderr) {
            return Err(err);
        }
        return Err(CommandError::Process {
            cmd: label,
            exit_code: output.status.code().unwrap_or(-1),
            stderr: truncate_output(&stderr),
        });
    }

    // Both CLIs print the new repository's URL. Fall back to building it from
    // the forge's default host only if they didn't — a self-hosted instance
    // would be wrong that way, but so would having no URL at all.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let url = crate::forge::pr::parse_created_url(&stdout);
    let url = if url.starts_with("http") {
        url
    } else {
        format!("https://{}/{}", forge.default_host, repo_name)
    };

    set_remote(&project, &options.remote_name, &url).await?;

    // Push every branch and tag, so the new remote is a complete copy rather
    // than just the branch that happened to be checked out.
    for (args, what) in [
        (
            ["push", "--set-upstream", &options.remote_name, "--all"],
            "branches",
        ),
        (["push", &options.remote_name, "--tags", ""], "tags"),
    ] {
        let args: Vec<&str> = args.iter().copied().filter(|a| !a.is_empty()).collect();
        let push = crate::commands::git::run_git_net(&args, &project, "push").await?;
        if !push.status.success() {
            let stderr = String::from_utf8_lossy(&push.stderr);
            if let Some(err) = crate::commands::git::classify_git_net_error(&stderr) {
                return Err(err);
            }
            return Err(format!(
                "The repository was created and '{}' points at it, but pushing {what} failed: {}",
                options.remote_name,
                truncate_output(&stderr)
            )
            .into());
        }
    }

    // The project's forge just changed; a cached answer would keep the UI on
    // the old one for up to the cache TTL.
    crate::forge::detect::invalidate_project_forge(&project);

    Ok(ForgeTransferResult {
        url,
        remote_name: options.remote_name,
        previous_origin_url,
    })
}

/// The remote name a mirror should write.
///
/// A mirror must never land on `origin` — that would silently be a move, with
/// the project's real remote replaced. An empty or `origin` request falls back
/// to the forge's id ("gitlab"), which reads better in `git remote -v` than a
/// generic "mirror".
fn mirror_remote_name(requested: &str, forge_id: &str) -> String {
    let trimmed = requested.trim();
    if trimmed.is_empty() || trimmed == "origin" {
        return forge_id.to_string();
    }
    trimmed.to_string()
}

/// Move a project to another forge: create the repository there, repoint
/// `origin`, and push everything.
///
/// The repository on the old forge is left in place. Deleting it is a separate,
/// irreversible act that belongs to the user, not to a "move" button.
#[tauri::command]
#[tracing::instrument(skip(options), fields(project = %options.project_path, forge = %options.forge_id))]
pub async fn move_project_to_forge(
    mut options: ForgeTransferOptions,
) -> Result<ForgeTransferResult, CommandError> {
    // A move is defined by replacing origin; ignore whatever the caller sent so
    // a mistyped remote name can't quietly turn a move into a mirror.
    options.remote_name = "origin".to_string();
    transfer(options).await
}

/// Add a second forge as an extra remote, leaving `origin` untouched.
#[tauri::command]
#[tracing::instrument(skip(options), fields(project = %options.project_path, forge = %options.forge_id))]
pub async fn mirror_project_to_forge(
    mut options: ForgeTransferOptions,
) -> Result<ForgeTransferResult, CommandError> {
    options.remote_name = mirror_remote_name(&options.remote_name, &options.forge_id);
    transfer(options).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mirror_never_lands_on_origin() {
        // Writing origin would replace the project's real remote — a move
        // wearing a mirror's label.
        for requested in ["", "origin", "   ", "  origin  "] {
            assert_eq!(mirror_remote_name(requested, "gitlab"), "gitlab");
        }
    }

    #[test]
    fn a_mirror_keeps_an_explicit_remote_name() {
        assert_eq!(mirror_remote_name("backup", "gitlab"), "backup");
        assert_eq!(mirror_remote_name("  backup  ", "gitlab"), "backup");
    }

    #[test]
    fn a_mirror_names_itself_after_the_target_forge_by_default() {
        assert_eq!(mirror_remote_name("", "github"), "github");
    }
}
