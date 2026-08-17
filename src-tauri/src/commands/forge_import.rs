//! # Importing an Existing Repository From a Forge
//!
//! Backs the import wizard for any forge with a CLI: read the signed-in
//! identity, list the namespaces the user can pick from, list that namespace's
//! repositories, and hand the frontend the exact clone command to run in a PTY.
//!
//! The GitHub paths delegate to the pre-existing `commands::github` functions
//! rather than re-issuing the same `gh` calls, so the username cache and the
//! error classification there keep applying. Only GitLab needed new plumbing —
//! the argument shapes and response parsing live in
//! [`crate::forge::listing`], which is unit-tested without a network.
//!
//! Cloning stays in the frontend's PTY (see `src/lib/ptyRun.ts`) because the
//! user watches git's progress there. Only the *decision* of what to run is
//! made here, so `gh` vs `glab` isn't hardcoded in the UI.

use crate::errors::CommandError;
use crate::external_command::{run_with_timeout, truncate_output};
use crate::forge::listing::{self, OwnerKind};
use crate::forge::ForgeConfig;
use crate::types::{ForgeCliStatus, ForgeCommandSpec, ForgeOwners, ForgeRepo, GitHubRepo};
use crate::utils::{create_command, find_executable, get_extended_path};
use std::process::Command;

/// Timeout for a forge CLI call in this module. Higher than the 15s the plain
/// `gh` helpers use: listing a group with `--include-subgroups` walks every
/// subgroup server-side and is the slowest call here.
const FORGE_CLI_TIMEOUT_SECS: u64 = 20;

/// Build a forge CLI command scoped to the *active* workspace.
///
/// The active workspace rather than a project's: an import has no project yet,
/// and the repositories offered must come from the account the user is currently
/// working as (see `accounts::get_env_vars_for_active_account`, which pins
/// `GH_CONFIG_DIR` / `GITLAB_CONFIG_DIR` for isolated workspaces).
fn forge_cli_command(forge: &'static ForgeConfig) -> Result<Command, CommandError> {
    let binary = listing::cli_binary(forge)?;
    let mut cmd = match find_executable(binary) {
        Some(path) => create_command(path),
        None => create_command(binary),
    };
    cmd.env("PATH", get_extended_path());
    cmd.envs(crate::commands::accounts::get_env_vars_for_active_account());
    // No caller feeds these commands stdin and a GUI-spawned CLI has no tty, so
    // a prompt could never be answered — fail fast instead of hanging until the
    // timeout (same reasoning as `github::get_gh_command`).
    cmd.stdin(std::process::Stdio::null());
    Ok(cmd)
}

/// Run a forge CLI call and return its stdout, mapping a failure to the app's
/// error vocabulary so a missing login surfaces as "not signed in" rather than
/// raw CLI text.
async fn run_forge_cli(
    forge: &'static ForgeConfig,
    args: Vec<String>,
    what: &str,
) -> Result<String, CommandError> {
    let mut cmd = forge_cli_command(forge)?;
    cmd.args(&args);
    let label = listing::label(forge, what);

    let output = run_with_timeout(
        tokio::process::Command::from(cmd),
        label.clone(),
        FORGE_CLI_TIMEOUT_SECS,
    )
    .await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if let Some(err) = crate::forge::errors::classify(forge, &stderr) {
            return Err(err);
        }
        return Err(CommandError::Process {
            cmd: label,
            exit_code: output.status.code().unwrap_or(-1),
            stderr: truncate_output(&stderr),
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Convert a `gh`-shaped repo into the forge-neutral shape.
///
/// `owner` supplies the namespace `gh repo list` leaves out. The collaborator
/// listing already returns `owner/repo` in `name` (see
/// `github::list_collaborator_repos`), so a name that carries a slash is treated
/// as the full path and split — prefixing it again would produce
/// `me/owner/repo` and every clone would fail.
fn from_github_repo(repo: GitHubRepo, owner: &str) -> ForgeRepo {
    let (full_path, name) = match repo.name.split_once('/') {
        Some((_, slug)) => (repo.name.clone(), slug.to_string()),
        None => (format!("{}/{}", owner, repo.name), repo.name.clone()),
    };
    ForgeRepo {
        name,
        full_path,
        url: repo.url,
        ssh_url: repo.ssh_url,
        is_private: repo.is_private,
        // GitHub has exactly two visibility states for our purposes, so
        // `is_private` says everything and there is no extra word to show.
        visibility: None,
        description: repo.description,
        primary_language: repo.primary_language,
        updated_at: repo.updated_at,
    }
}

/// The namespaces the signed-in user can import from on `forge_id`.
///
/// Fails when the CLI isn't signed in — the wizard needs an identity before it
/// can show anything, and an empty list would read as "you have no repositories".
#[tauri::command]
#[tracing::instrument]
pub async fn list_forge_owners(forge_id: String) -> Result<ForgeOwners, CommandError> {
    let forge = crate::forge::get_forge_by_id(&forge_id);
    // Surface the REST-forge refusal before any process spawn.
    listing::cli_binary(forge)?;

    if forge.id == crate::forge::GITHUB.id {
        let username = crate::commands::github::get_github_username(None).await?;
        let groups = crate::commands::github::get_github_orgs(None).await?;
        return Ok(ForgeOwners {
            username,
            groups,
            host: None,
        });
    }

    let user_json = run_forge_cli(forge, listing::user_args(forge), "api user").await?;
    let username = listing::parse_user(&user_json).ok_or(CommandError::NotAuthenticated {
        service: forge.id.to_string(),
    })?;

    // A failed group lookup must not block the import: the user's own namespace
    // is still usable, and groups are an addition to it. Same posture as the
    // GitHub path, where `get_github_orgs` returns an empty list on failure.
    let groups = match run_forge_cli(forge, listing::groups_args(forge), "api groups").await {
        Ok(json) => listing::parse_groups(&json),
        Err(e) => {
            tracing::warn!(error = %e, forge = forge.id, "group lookup failed; offering the personal namespace only");
            Vec::new()
        }
    };

    let host = match listing::host_args(forge) {
        Some(args) => run_forge_cli(forge, args, "config get host")
            .await
            .ok()
            .map(|out| out.trim().to_string())
            .filter(|h| !h.is_empty()),
        None => None,
    };

    Ok(ForgeOwners {
        username,
        groups,
        host,
    })
}

/// Repositories in one namespace on `forge_id`.
///
/// `owner_kind` is `"user"`, `"group"` or `"shared"`; `owner` names the
/// namespace and is ignored for `"shared"`, which is defined by the signed-in
/// user rather than by a namespace.
#[tauri::command]
#[tracing::instrument]
pub async fn list_forge_repos(
    forge_id: String,
    owner_kind: String,
    owner: String,
) -> Result<Vec<ForgeRepo>, CommandError> {
    let forge = crate::forge::get_forge_by_id(&forge_id);
    listing::cli_binary(forge)?;
    let kind = OwnerKind::parse(&owner_kind)?;

    if kind != OwnerKind::Shared && owner.trim().is_empty() {
        return Err(CommandError::Validation {
            field: "owner".to_string(),
            reason: "An account or group is required.".to_string(),
        });
    }

    if forge.id == crate::forge::GITHUB.id {
        let repos = match kind {
            OwnerKind::Shared => crate::commands::github::list_collaborator_repos().await?,
            _ => crate::commands::github::list_github_repos(owner.clone()).await?,
        };
        return Ok(repos
            .into_iter()
            .map(|repo| from_github_repo(repo, &owner))
            .collect());
    }

    let json = run_forge_cli(
        forge,
        listing::repo_list_args(forge, kind, &owner),
        "repo list",
    )
    .await?;
    listing::parse_gitlab_repos(&json).map_err(|e| CommandError::Other {
        message: format!(
            "Failed to parse the {} project list: {e}",
            forge.display_name
        ),
    })
}

/// The command that clones `repo_path` into `target_dir`.
///
/// Returned rather than executed: the frontend runs it in a PTY so git's
/// progress is visible during a long clone.
#[tauri::command]
#[tracing::instrument]
pub async fn forge_clone_command(
    forge_id: String,
    repo_path: String,
    target_dir: String,
) -> Result<ForgeCommandSpec, CommandError> {
    let forge = crate::forge::get_forge_by_id(&forge_id);
    let binary = listing::cli_binary(forge)?;

    let repo_path = repo_path.trim();
    let target_dir = target_dir.trim();
    if repo_path.is_empty() || target_dir.is_empty() {
        return Err(CommandError::Validation {
            field: "repoPath".to_string(),
            reason: "A repository path and target directory are required.".to_string(),
        });
    }

    Ok(ForgeCommandSpec {
        command: binary.to_string(),
        args: listing::clone_args(forge, repo_path, target_dir),
    })
}

/// Whether a forge's CLI is installed and signed in for the active workspace.
///
/// The wizard calls this first so a missing `glab` or a missing login is stated
/// plainly, instead of the first listing call failing with CLI stderr.
#[tauri::command]
#[tracing::instrument]
pub async fn check_forge_cli_status(forge_id: String) -> Result<ForgeCliStatus, CommandError> {
    let forge = crate::forge::get_forge_by_id(&forge_id);
    let binary = listing::cli_binary(forge)?;

    if forge.id == crate::forge::GITHUB.id {
        let status = crate::commands::github::check_github_cli_status().await;
        return Ok(ForgeCliStatus {
            installed: status.installed,
            authenticated: status.authenticated,
            binary: binary.to_string(),
        });
    }

    if find_executable(binary).is_none() {
        return Ok(ForgeCliStatus {
            installed: false,
            authenticated: false,
            binary: binary.to_string(),
        });
    }

    let mut cmd = forge_cli_command(forge)?;
    cmd.args(["auth", "status"]);
    let authenticated = match run_with_timeout(
        tokio::process::Command::from(cmd),
        listing::label(forge, "auth status"),
        FORGE_CLI_TIMEOUT_SECS,
    )
    .await
    {
        // glab writes its whole report to stderr and exits non-zero when no
        // instance is usable, so the exit code decides — the same read
        // `accounts::get_account_credential_status` does.
        Ok(output) if output.status.success() => crate::commands::accounts::parse_glab_auth_status(
            &String::from_utf8_lossy(&output.stderr),
        )
        .is_some(),
        Ok(_) => false,
        Err(e) => {
            tracing::warn!(error = %e, forge = forge.id, "auth status failed/timed out");
            false
        }
    };

    Ok(ForgeCliStatus {
        installed: true,
        authenticated,
        binary: binary.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::GitHubLanguage;

    fn gh_repo(name: &str) -> GitHubRepo {
        GitHubRepo {
            name: name.to_string(),
            url: format!("https://github.com/{name}"),
            ssh_url: format!("git@github.com:{name}.git"),
            is_private: true,
            description: Some("A project".to_string()),
            primary_language: Some(GitHubLanguage {
                name: "TypeScript".to_string(),
            }),
            updated_at: "2026-08-17T10:32:59Z".to_string(),
        }
    }

    #[test]
    fn a_bare_github_name_gets_its_namespace_from_the_owner() {
        let repo = from_github_repo(gh_repo("web"), "acme");
        assert_eq!(repo.name, "web");
        assert_eq!(repo.full_path, "acme/web");
        assert!(repo.visibility.is_none());
        assert_eq!(
            repo.primary_language.map(|l| l.name).as_deref(),
            Some("TypeScript")
        );
    }

    #[test]
    fn a_collaborator_repo_keeps_its_own_namespace() {
        // `list_collaborator_repos` already returns "owner/repo" in `name`;
        // prefixing again would produce "me/owner/repo" and break every clone.
        let repo = from_github_repo(gh_repo("othercorp/tooling"), "me");
        assert_eq!(repo.full_path, "othercorp/tooling");
        assert_eq!(repo.name, "tooling");
    }
}
