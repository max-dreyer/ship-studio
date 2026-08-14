//! # Forge CLI Error Classification
//!
//! Turns a forge CLI's stderr into the app's error vocabulary, so a missing
//! login shows the reconnect UI instead of raw CLI text, and an expected
//! refusal stays out of telemetry.
//!
//! The GitHub matchers live in `commands::github` and predate this module. The
//! transport-level ones there (network, TLS, 5xx) match Go's `net/http` and
//! curl wording rather than anything GitHub-specific, so they are reused for
//! `glab` as-is: both CLIs are Go programs and fail the same way when the
//! network does. Only the auth and not-a-repo cases needed GitLab versions,
//! because those phrasings are the CLI's own.
//!
//! Every string matched below was taken from `glab` 1.113.0 output, not from
//! documentation.

use super::ForgeConfig;
use crate::errors::CommandError;

/// `glab`'s stderr when it has no usable credential for the instance.
///
/// Observed forms:
/// - "No token found (checked config file, keyring, and environment variables)."
/// - "could not authenticate to one or more of the configured GitLab instances."
/// - "API call failed: GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}"
pub fn glab_auth_error(stderr: &str) -> Option<CommandError> {
    let lower = stderr.to_lowercase();
    if lower.contains("no token found")
        || lower.contains("could not authenticate")
        || lower.contains("glab auth login")
        || stderr.contains("GITLAB_TOKEN")
        || lower.contains("401 unauthorized")
        // git falling back to an interactive credential prompt, same as the
        // GitHub path: no tty in a GUI-spawned process, so it can never be
        // answered and the reconnect flow is the fix.
        || lower.contains("could not read username")
        || lower.contains("could not read password")
    {
        return Some(CommandError::NotAuthenticated {
            service: "gitlab".to_string(),
        });
    }
    None
}

/// `glab`'s stderr when the working directory isn't a git repository:
/// "Fatal: not a git repository (or any of the parent directories): .git" plus
/// "git: exit status 128.".
///
/// git's own wording is locale-dependent, so the untranslated Go literal
/// `glab` appends is the stable marker — the same reasoning `gh_git_repo_error`
/// applies to gh's "failed to run git:" prefix (issue #403).
///
/// The exit code is part of the match on purpose. A bare "git: exit status"
/// also appears when `mr checkout` is blocked by uncommitted local changes
/// (status 1), and classifying that as "not a git repository" would replace an
/// accurate, actionable message with a wrong one. 128 is git's code for a fatal
/// usage error, which is what a missing repository produces.
pub fn glab_git_repo_error(stderr: &str) -> Option<CommandError> {
    (stderr.contains("git: exit status 128") || stderr.contains("not a git repository")).then(|| {
        CommandError::expected(
            "This project isn't set up with git yet, so GitLab merge request actions aren't available.",
        )
    })
}

/// Classify a forge CLI failure, picking the matchers that fit the forge.
///
/// Returns `None` when nothing matched, leaving the caller to fall back to the
/// raw stderr.
pub fn classify(forge: &ForgeConfig, stderr: &str) -> Option<CommandError> {
    match forge.id {
        "gitlab" => glab_auth_error(stderr)
            .or_else(|| crate::commands::github::gh_common_error(stderr))
            .or_else(|| glab_git_repo_error(stderr)),
        _ => crate::commands::github::gh_auth_error(stderr)
            .or_else(|| crate::commands::github::gh_common_error(stderr))
            .or_else(|| crate::commands::github::gh_git_repo_error(stderr)),
    }
}

/// Whether the stderr is a forge's way of saying "this repo has no PRs / no
/// remote / I can't see it", which the list command treats as an empty list
/// rather than an error (issue #268).
pub fn is_empty_list_stderr(forge: &ForgeConfig, stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    let shared = lower.contains("no pull requests")
        || lower.contains("could not")
        || lower.contains("no git remotes found");
    if forge.id != "gitlab" {
        return shared;
    }
    shared
        || lower.contains("no merge requests")
        // GitLab answers "project you don't have access to" with 404 rather
        // than 403, so an unauthenticated read of a private project lands here
        // too. Both mean "nothing to show", not "the app broke".
        || lower.contains("404 not found")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forge::{GITHUB, GITLAB};

    #[test]
    fn glab_missing_token_is_an_auth_error() {
        // Verbatim from `glab auth status` with an empty config dir.
        let stderr = "! No token found (checked config file, keyring, and environment variables).";
        assert!(matches!(
            glab_auth_error(stderr),
            Some(CommandError::NotAuthenticated { .. })
        ));
    }

    #[test]
    fn glab_401_is_an_auth_error() {
        let stderr =
            "x gitlab.com: API call failed: GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}";
        assert!(matches!(
            glab_auth_error(stderr),
            Some(CommandError::NotAuthenticated { service }) if service == "gitlab"
        ));
    }

    #[test]
    fn glab_could_not_authenticate_is_an_auth_error() {
        let stderr = "X could not authenticate to one or more of the configured GitLab instances.";
        assert!(glab_auth_error(stderr).is_some());
    }

    #[test]
    fn glab_non_repo_is_an_expected_refusal() {
        // Verbatim from `glab mr list` outside a repository.
        let stderr = "Fatal: not a git repository (or any of the parent directories): .git\ngit: exit status 128.";
        assert!(matches!(
            glab_git_repo_error(stderr),
            Some(CommandError::Expected { .. })
        ));
    }

    #[test]
    fn a_blocked_checkout_is_not_mistaken_for_a_missing_repo() {
        // `glab mr checkout` over dirty files exits 1, not 128. Classifying it
        // as "not a git repository" would hide the real, fixable cause.
        let stderr = "error: Your local changes to the following files would be overwritten by checkout\ngit: exit status 1.";
        assert!(glab_git_repo_error(stderr).is_none());
    }

    #[test]
    fn unrelated_glab_stderr_is_not_classified() {
        assert!(glab_auth_error("something else entirely").is_none());
        assert!(glab_git_repo_error("something else entirely").is_none());
    }

    #[test]
    fn classify_routes_by_forge() {
        let glab_stderr =
            "No token found (checked config file, keyring, and environment variables).";
        assert!(classify(&GITLAB, glab_stderr).is_some());
        // The GitHub matchers don't know that phrasing, so routing matters.
        assert!(classify(&GITHUB, glab_stderr).is_none());
    }

    #[test]
    fn transport_errors_are_shared_across_forges() {
        // Go's dial error, identical from gh and glab.
        let stderr = "dial tcp: lookup gitlab.com: no such host";
        assert!(classify(&GITLAB, stderr).is_some());
        assert!(classify(&GITHUB, stderr).is_some());
    }

    #[test]
    fn gitlab_404_reads_as_an_empty_list() {
        assert!(is_empty_list_stderr(&GITLAB, "404 Not Found."));
        // GitHub 404s mean something else, so it stays an error there.
        assert!(!is_empty_list_stderr(&GITHUB, "404 Not Found."));
    }

    #[test]
    fn shared_empty_list_phrases_apply_to_both() {
        for forge in [&GITHUB, &GITLAB] {
            assert!(is_empty_list_stderr(forge, "no git remotes found"));
        }
    }
}
