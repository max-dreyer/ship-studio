//! # Pull Request Commands
//!
//! Commands for managing pull requests on whichever forge a project belongs to.
//! GitHub calls them pull requests and GitLab calls them merge requests; the
//! command names here keep GitHub's word because that is what the frontend and
//! the Tauri command registry already use, while `forge::pr` translates the
//! arguments, JSON and vocabulary per forge.

use crate::commands::github::get_forge_command_for_project;
use crate::errors::CommandError;
use crate::external_command::{run_with_timeout, truncate_output};
use crate::forge::pr as forge_pr;
use crate::types::PullRequestInfo;
use crate::utils::validate_project_path;

/// How many PRs the list command asks for.
const PR_LIST_LIMIT: u32 = 20;

/// Timeout for network-facing CLI ops (gh/git) so a hung remote can't freeze a
/// PR command. Matches git/branches.rs.
const NETWORK_TIMEOUT_SECS: u64 = 60;

/// Run an already-configured network-facing command (gh/git) with a timeout,
/// replacing blocking `.output()` so a stalled remote can't hang the UI.
async fn run_net(
    cmd: std::process::Command,
    label: &str,
) -> Result<std::process::Output, CommandError> {
    run_with_timeout(
        tokio::process::Command::from(cmd),
        label.to_string(),
        NETWORK_TIMEOUT_SECS,
    )
    .await
}

/// List pull requests for the repository
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path))]
pub async fn list_pull_requests(
    project_path: String,
) -> Result<Vec<PullRequestInfo>, CommandError> {
    let validated_path = validate_project_path(&project_path)?;

    let (mut cmd, forge) = get_forge_command_for_project(&validated_path)?;
    cmd.args(forge_pr::list_args(forge, PR_LIST_LIMIT))
        .current_dir(&validated_path);
    let output = run_net(cmd, &forge_pr::command_label(forge, "list")).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // A local-only repo that was never connected to a forge is an expected
        // state (github.rs models it as the "no-remote" status), not an error
        // worth toasting (issue #268).
        if crate::forge::errors::is_empty_list_stderr(forge, &stderr) {
            return Ok(Vec::new());
        }
        // Auth-not-configured is an expected state, not an error to report
        // with the CLI's raw multi-line stderr (issue #326).
        if let Some(err) = crate::forge::errors::classify(forge, &stderr) {
            return Err(err);
        }
        return Err(truncate_output(&stderr).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(forge_pr::parse_list(forge, &stdout)?)
}

/// git's stderr for an ordinary push rejection — the remote branch moved ahead
/// of the local one ("! [rejected] … (non-fast-forward)", "failed to push some
/// refs … fetch first", "the tip of your current branch is behind"). A benign,
/// by-design race, not an app malfunction: the user pulls and retries. Same
/// phrases the publishing paths treat as Expected (issues #617/#560/#654).
/// `classify_git_net_error` deliberately returns `None` for these, and
/// `push_pre_receive_error` must run first so GH001/GH005 keep their specific
/// remedies.
fn is_push_rejection(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("non-fast-forward")
        || lower.contains("rejected")
        || lower.contains("fetch first")
        || lower.contains("tip of your current branch is behind")
}

/// Create a new pull request.
/// Automatically pushes the branch to the remote first if needed.
#[tauri::command]
#[tracing::instrument(skip(project_path, title, body, base), fields(project = %project_path, base = %base))]
pub async fn create_pull_request(
    project_path: String,
    title: String,
    body: Option<String>,
    base: String,
) -> Result<String, CommandError> {
    let validated_path = validate_project_path(&project_path)?;

    // Push the branch to the remote first (gh pr create requires this).
    // Through run_git_net — not a hand-built command — so HTTPS credentials
    // resolve via `gh auth git-credential` and GIT_TERMINAL_PROMPT=0 is set,
    // exactly like push_branch. The hand-built version inherited whatever
    // credential helper the machine had (often none usable in a GUI-spawned
    // process), and git's interactive fallback died with "could not read
    // Username for 'https://github.com': Device not configured" (issue #638).
    let push_output = crate::commands::git::run_git_net(
        &["push", "-u", "origin", "HEAD"],
        &validated_path,
        "push",
    )
    .await?;

    if !push_output.status.success() {
        let stderr = String::from_utf8_lossy(&push_output.stderr);
        // Ignore "everything up-to-date" which isn't a real error
        if !stderr.contains("Everything up-to-date") {
            // A push that failed on auth or connectivity is an expected
            // environment state, same as push_branch (issue #560).
            if let Some(err) = crate::commands::git::classify_git_net_error(&stderr) {
                return Err(err);
            }
            // Pre-receive refusals with their own remedy (file over 100 MB,
            // ref too long) — must run before the generic rejection check,
            // same ordering as the publishing paths (issues #626/#636).
            if let Some(err) = crate::commands::publishing::push_pre_receive_error(&stderr) {
                return Err(err);
            }
            // An ordinary non-fast-forward race ("someone pushed first") is
            // by-design git behavior, not a malfunction — the same case the
            // publishing paths already classify as Expected (issue #654).
            // Keep the exact "Failed to push branch: <stderr>" shape: the
            // SubmitReviewModal runs it through humanizeGitError, which
            // matches "rejected"/"non-fast-forward" in the raw text and
            // renders the pull-first guidance. (No PUSH_REJECTED sentinel
            // here — only PublishBranchDropdown consumes that.)
            if is_push_rejection(&stderr) {
                return Err(CommandError::expected(format!(
                    "Failed to push branch: {}",
                    truncate_output(&stderr)
                )));
            }
            return Err(format!("Failed to push branch: {}", truncate_output(&stderr)).into());
        }
    }

    let body_str = body.unwrap_or_default();

    let (mut cmd, forge) = get_forge_command_for_project(&validated_path)?;
    cmd.args(forge_pr::create_args(forge, &title, &body_str, &base))
        .current_dir(&validated_path);
    let output = run_net(cmd, &forge_pr::command_label(forge, "create")).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if let Some(err) = crate::forge::errors::classify(forge, &stderr) {
            return Err(err);
        }
        // By-design refusals for `create` — the frontend already rephrases
        // these into friendly guidance (humanizeGitError), so keep the raw
        // text but mark them Expected so they stay out of telemetry
        // (issue #428). GitLab words the duplicate case as "merge request
        // already exists", hence matching the noun loosely.
        let lower = stderr.to_lowercase();
        if lower.contains("no commits between")
            || lower.contains("different project or branch")
            || (lower.contains("already exists")
                && (lower.contains("pull request") || lower.contains("merge request")))
        {
            return Err(CommandError::expected(stderr.to_string()));
        }
        return Err(truncate_output(&stderr).into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(forge_pr::parse_created_url(&stdout))
}

/// Merge a pull request. Returns `CommandError::MergeConflict` when `gh`
/// reports the PR isn't mergeable so the frontend can render a conflict-
/// resolution flow without grepping the stderr for known phrases.
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path, pr = pr_number))]
pub async fn merge_pull_request(project_path: String, pr_number: i32) -> Result<(), CommandError> {
    let validated_path = validate_project_path(&project_path)?;

    let (mut cmd, forge) = get_forge_command_for_project(&validated_path)?;
    cmd.args(forge_pr::merge_args(forge, pr_number))
        .current_dir(&validated_path);
    let output = run_net(cmd, &forge_pr::command_label(forge, "merge")).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if is_conflict_stderr(&stderr) {
            return Err(CommandError::MergeConflict { pr_number, stderr });
        }
        // Drafts are refused by GitHub with a raw GraphQL error and by GitLab
        // with "cannot merge a draft"; the UI disables Merge for drafts, but a
        // just-converted or stale-listed PR can still race into this
        // (issue #482).
        if is_draft_refusal(&stderr) {
            return Err(CommandError::expected(format!(
                "This {} is still a draft, so it can't be merged yet. Mark it as ready for review on {} first.",
                forge.terms.pull_request.to_lowercase(),
                forge.display_name
            )));
        }
        if let Some(err) = crate::forge::errors::classify(forge, &stderr) {
            return Err(err);
        }
        return Err(truncate_output(&stderr).into());
    }

    Ok(())
}

/// Match the stderr both CLIs emit when the merge was refused *because the PR
/// is a draft*, as opposed to any other reason.
///
/// Kept to specific phrases rather than "mentions draft and merge": GitLab
/// calls the object a "merge request", so the loose version would fire on
/// every GitLab error that happens to mention a draft.
fn is_draft_refusal(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    // gh: "Pull request #12 is still a draft". GitLab surfaces its block as
    // the `draft_status` detailed-merge-status, and glab echoes the API's
    // "cannot be merged" wording alongside it.
    lower.contains("still a draft")
        || lower.contains("draft status")
        || lower.contains("draft_status")
}

/// Match the stderr fragments `gh pr merge` emits when a PR can't be merged
/// cleanly. Kept narrow so unrelated failures still surface as Process/Other.
fn is_conflict_stderr(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    lower.contains("is not mergeable")
        || lower.contains("merge commit cannot be cleanly created")
        || lower.contains("merge conflicts")
}

/// Checkout a pull request branch locally for review
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path, pr = pr_number))]
pub async fn checkout_pull_request(
    project_path: String,
    pr_number: i32,
) -> Result<String, CommandError> {
    let validated_path = validate_project_path(&project_path)?;

    let (mut cmd, forge) = get_forge_command_for_project(&validated_path)?;
    cmd.args(forge_pr::checkout_args(forge, pr_number))
        .current_dir(&validated_path);
    let output = run_net(cmd, &forge_pr::command_label(forge, "checkout")).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if let Some(err) = crate::forge::errors::classify(forge, &stderr) {
            return Err(err);
        }
        // Git refusing to check out over uncommitted local edits ("would be
        // overwritten by checkout" / "commit your changes or stash") is an
        // anticipated user state, not a malfunction — same classification the
        // branch-switch and merge paths already apply (issue #601, same class
        // as #312/#502/#521).
        if crate::commands::git::is_overwrite_refusal(&stderr) {
            tracing::warn!(error = %stderr, "PR checkout blocked by uncommitted local changes");
            return Err(CommandError::expected(
                "You have unsaved changes that would be lost by checking out this pull request. \
                 Commit or stash them first, then try again.",
            ));
        }
        return Err(format!("Failed to checkout PR: {}", truncate_output(&stderr)).into());
    }

    // Return the branch name that was checked out
    let branch_output = crate::utils::git_command_in(&validated_path)?
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .output()
        .map_err(|e| e.to_string())?;

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();
    Ok(branch)
}

/// Close a pull request without merging
#[tauri::command]
#[tracing::instrument(skip(project_path), fields(project = %project_path, pr = pr_number))]
pub async fn close_pull_request(project_path: String, pr_number: i32) -> Result<(), CommandError> {
    let validated_path = validate_project_path(&project_path)?;

    let (mut cmd, forge) = get_forge_command_for_project(&validated_path)?;
    cmd.args(forge_pr::close_args(forge, pr_number))
        .current_dir(&validated_path);
    let output = run_net(cmd, &forge_pr::command_label(forge, "close")).await?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if let Some(err) = crate::forge::errors::classify(forge, &stderr) {
            return Err(err);
        }
        return Err(format!("Failed to close PR: {}", truncate_output(&stderr)).into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// run_net must execute a network-facing command through the timeout path
    /// (the fix: blocking `.output()` replaced so a hung remote can't freeze PR
    /// commands). `git --version` is deterministic and needs no repo or remote.
    #[tokio::test]
    async fn run_net_executes_command_through_timeout() {
        let mut cmd = crate::utils::git_command().unwrap();
        cmd.args(["--version"]);
        let out = run_net(cmd, "git --version")
            .await
            .expect("git --version should run within the timeout");
        assert!(out.status.success());
        assert!(String::from_utf8_lossy(&out.stdout).contains("git version"));
    }

    /// is_conflict_stderr gates the MergeConflict error path; keep its phrase
    /// matching honest so unrelated failures don't masquerade as conflicts.
    #[test]
    fn is_conflict_stderr_matches_only_conflict_phrases() {
        assert!(is_conflict_stderr("Pull request is not mergeable"));
        assert!(is_conflict_stderr("merge commit cannot be cleanly created"));
        assert!(!is_conflict_stderr("could not find pull request"));
    }

    /// An everyday non-fast-forward race on create_pull_request's auto-push is
    /// by-design git behavior — it must classify as a push rejection so the
    /// command returns Expected instead of telemetry noise (issue #654).
    #[test]
    fn is_push_rejection_matches_non_fast_forward_stderr() {
        let stderr = "To https://github.com/o/r.git\n ! [rejected]        HEAD -> feat/x (non-fast-forward)\nerror: failed to push some refs to 'https://github.com/o/r.git'\nhint: Updates were rejected because the tip of your current branch is behind\nhint: its remote counterpart.";
        assert!(is_push_rejection(stderr));
        assert!(is_push_rejection(
            "error: failed to push some refs\nhint: (e.g., 'git pull ...') before pushing again. fetch first"
        ));
    }

    #[test]
    fn is_push_rejection_ignores_unrelated_push_failures() {
        assert!(!is_push_rejection(
            "remote: Permission denied (publickey).\nfatal: Could not read from remote repository."
        ));
        assert!(!is_push_rejection(
            "fatal: unable to access: could not resolve host"
        ));
        assert!(!is_push_rejection(""));
    }
}
