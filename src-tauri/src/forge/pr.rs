//! # Pull/Merge Request Commands Per Forge
//!
//! Builds the CLI arguments for each PR operation and normalizes the JSON that
//! comes back, so `commands::pull_requests` stays a thin command layer and the
//! frontend keeps seeing one vocabulary regardless of forge.
//!
//! The normalization target is GitHub's vocabulary, because that is what the
//! frontend already compares against (`pr.state === 'OPEN'`). GitLab's values
//! are translated here rather than in the UI: one canonical shape in the
//! backend beats every component learning two dialects.
//!
//! Argument names and defaults below were verified against `glab` 1.113.0 and
//! the field names against a live GitLab API response, not from memory. Two
//! non-obvious ones are load-bearing:
//! - `mr create` and `mr merge` prompt for confirmation without `--yes`, and
//!   these commands run with stdin closed, so omitting it would hang until the
//!   timeout.
//! - `mr merge --auto-merge` defaults to *true*, which queues the merge behind
//!   the pipeline instead of merging now. `gh pr merge --merge` merges
//!   immediately, so we pass `--auto-merge=false` to match.

use super::{DraftSupport, ForgeConfig};
use crate::types::PullRequestInfo;

/// Arguments for listing open PRs, newest first, capped at `limit`.
pub fn list_args(forge: &ForgeConfig, limit: u32) -> Vec<String> {
    let limit = limit.to_string();
    match forge.id {
        "gitlab" => vec![
            "mr".into(),
            "list".into(),
            "--output".into(),
            "json".into(),
            "--per-page".into(),
            limit,
        ],
        // GitHub needs the field list spelled out; anything omitted is absent
        // from the response rather than defaulted.
        _ => vec![
            "pr".into(),
            "list".into(),
            "--json".into(),
            "number,title,headRefName,baseRefName,author,state,mergeable,isDraft,url,createdAt"
                .into(),
            "--limit".into(),
            limit,
        ],
    }
}

/// Arguments for creating a PR from the current branch.
pub fn create_args(forge: &ForgeConfig, title: &str, body: &str, base: &str) -> Vec<String> {
    match forge.id {
        "gitlab" => vec![
            "mr".into(),
            "create".into(),
            "--title".into(),
            title.into(),
            "--description".into(),
            body.into(),
            "--target-branch".into(),
            base.into(),
            // Without this glab prompts for confirmation on a closed stdin.
            "--yes".into(),
        ],
        _ => vec![
            "pr".into(),
            "create".into(),
            "--title".into(),
            title.into(),
            "--body".into(),
            body.into(),
            "--base".into(),
            base.into(),
        ],
    }
}

/// Arguments for merging a PR immediately with a merge commit.
pub fn merge_args(forge: &ForgeConfig, number: i32) -> Vec<String> {
    match forge.id {
        "gitlab" => vec![
            "mr".into(),
            "merge".into(),
            number.to_string(),
            // Merge now rather than when the pipeline passes; see module docs.
            "--auto-merge=false".into(),
            "--yes".into(),
        ],
        _ => vec![
            "pr".into(),
            "merge".into(),
            number.to_string(),
            "--merge".into(),
        ],
    }
}

/// Arguments for checking a PR's branch out locally.
pub fn checkout_args(forge: &ForgeConfig, number: i32) -> Vec<String> {
    let verb = if forge.id == "gitlab" { "mr" } else { "pr" };
    vec![verb.into(), "checkout".into(), number.to_string()]
}

/// Arguments for closing a PR without merging.
pub fn close_args(forge: &ForgeConfig, number: i32) -> Vec<String> {
    let verb = if forge.id == "gitlab" { "mr" } else { "pr" };
    vec![verb.into(), "close".into(), number.to_string()]
}

/// Pull the created PR's URL out of a create command's stdout.
///
/// `gh pr create` prints the URL and nothing else. `glab mr create` prints a
/// short summary around it, so returning the raw stdout would hand the UI a
/// banner instead of a link. Taking the first http(s) token covers both, and
/// falling back to the trimmed stdout keeps the old behavior for any forge
/// whose output we haven't seen.
pub fn parse_created_url(stdout: &str) -> String {
    stdout
        .split_whitespace()
        .find(|token| token.starts_with("https://") || token.starts_with("http://"))
        // glab wraps the URL in ANSI styling and can leave punctuation on it.
        .map(|token| {
            token
                .trim_end_matches(['.', ',', ')', '"', '\''])
                .to_string()
        })
        .unwrap_or_else(|| stdout.trim().to_string())
}

/// A human-readable label for a forge invocation, used for timeout messages and
/// their telemetry fingerprints. Mirrors the `"gh pr list"` strings the GitHub
/// path used, so one hung command stays distinguishable from another.
pub fn command_label(forge: &ForgeConfig, operation: &str) -> String {
    let binary = match forge.transport {
        super::ForgeTransport::Cli(name) => name,
        super::ForgeTransport::Rest => forge.id,
    };
    let noun = if forge.id == "gitlab" { "mr" } else { "pr" };
    format!("{binary} {noun} {operation}")
}

/// Strip a forge's draft marker from a title, returning the clean title and
/// whether the marker was there.
///
/// GitLab encodes draft state in the title (`Draft: Fix the thing`). Showing
/// that prefix *and* a draft badge would say the same thing twice, and the
/// titles would not match GitHub's for the same workflow.
fn split_draft_prefix(forge: &ForgeConfig, title: &str) -> (String, bool) {
    let DraftSupport::TitlePrefix(prefix) = forge.capabilities.draft_pull_requests else {
        return (title.to_string(), false);
    };

    let trimmed = title.trim_start();
    // GitLab accepts "Draft:" and the older "WIP:", in any case.
    for candidate in [prefix, "Draft:", "WIP:"] {
        if trimmed.len() >= candidate.len()
            && trimmed[..candidate.len()].eq_ignore_ascii_case(candidate)
        {
            return (trimmed[candidate.len()..].trim_start().to_string(), true);
        }
    }
    (title.to_string(), false)
}

/// Translate a forge's PR state to GitHub's vocabulary, which is what the
/// frontend filters on.
fn normalize_state(raw: &str) -> String {
    match raw.to_ascii_lowercase().as_str() {
        // GitLab says "opened" where GitHub says "OPEN".
        "opened" | "open" => "OPEN".to_string(),
        "merged" => "MERGED".to_string(),
        "closed" => "CLOSED".to_string(),
        other => other.to_ascii_uppercase(),
    }
}

/// Parse the JSON a list command produced into the shared PR shape.
///
/// Entries missing a field we require are skipped rather than failing the whole
/// list: one malformed PR should not blank the panel.
pub fn parse_list(forge: &ForgeConfig, stdout: &str) -> Result<Vec<PullRequestInfo>, String> {
    let json: Vec<serde_json::Value> =
        serde_json::from_str(stdout).map_err(|e| format!("Failed to parse PR list: {e}"))?;

    let parsed = json
        .iter()
        .filter_map(|pr| {
            if forge.id == "gitlab" {
                parse_gitlab_mr(forge, pr)
            } else {
                parse_github_pr(pr)
            }
        })
        .collect();
    Ok(parsed)
}

fn parse_github_pr(pr: &serde_json::Value) -> Option<PullRequestInfo> {
    Some(PullRequestInfo {
        number: pr.get("number")?.as_i64()? as i32,
        title: pr.get("title")?.as_str()?.to_string(),
        head_ref: pr.get("headRefName")?.as_str()?.to_string(),
        base_ref: pr.get("baseRefName")?.as_str()?.to_string(),
        author: pr.get("author")?.get("login")?.as_str()?.to_string(),
        state: normalize_state(pr.get("state")?.as_str()?),
        mergeable: pr
            .get("mergeable")
            .and_then(|v| v.as_str())
            .map(|s| s == "MERGEABLE"),
        // Draft PRs can't be merged — the UI needs to know so it can
        // offer "mark ready" instead of a Merge that's doomed to fail
        // with a raw GraphQL error (issue #482).
        is_draft: pr.get("isDraft").and_then(|v| v.as_bool()).unwrap_or(false),
        url: pr.get("url")?.as_str()?.to_string(),
        created_at: pr.get("createdAt")?.as_str()?.to_string(),
    })
}

/// Whether a GitLab MR can be merged, in GitHub's true/false/unknown terms.
///
/// `glab mr list --output json` sends `detailed_merge_status` and *not* the
/// older `merge_status` (verified against glab 1.113.0), so reading only the
/// latter reports every GitLab MR as unknown. Both are handled: direct API
/// responses and older glab builds still carry `merge_status`.
///
/// Only an actual conflict maps to `false`. GitLab also blocks merging for
/// reasons that are not conflicts (unresolved discussions, missing approvals, a
/// pipeline still running), and reporting those as `false` would light up the
/// UI's conflict warning for a branch that merges cleanly.
fn parse_gitlab_mergeable(mr: &serde_json::Value) -> Option<bool> {
    if let Some(status) = mr.get("merge_status").and_then(|v| v.as_str()) {
        return match status {
            "can_be_merged" => Some(true),
            "cannot_be_merged" => Some(false),
            _ => None,
        };
    }

    match mr.get("detailed_merge_status").and_then(|v| v.as_str())? {
        "mergeable" => Some(true),
        "conflict" | "broken_status" => Some(false),
        // "checking", "unchecked", "preparing" are in-progress; the rest are
        // policy blocks, not merge problems. Neither is a conflict.
        _ => None,
    }
}

fn parse_gitlab_mr(forge: &ForgeConfig, mr: &serde_json::Value) -> Option<PullRequestInfo> {
    // `iid` is the per-project number users see and every `glab mr <n>` command
    // takes. `id` is a global database key that would address a different MR
    // entirely, so reading the wrong one silently acts on someone else's work.
    let number = mr.get("iid")?.as_i64()? as i32;
    let raw_title = mr.get("title")?.as_str()?;
    let (title, title_says_draft) = split_draft_prefix(forge, raw_title);

    // Prefer the explicit flag; `work_in_progress` is its older name and the
    // title prefix is the fallback for instances that send neither.
    let is_draft = mr
        .get("draft")
        .and_then(|v| v.as_bool())
        .or_else(|| mr.get("work_in_progress").and_then(|v| v.as_bool()))
        .unwrap_or(title_says_draft);

    Some(PullRequestInfo {
        number,
        title,
        head_ref: mr.get("source_branch")?.as_str()?.to_string(),
        base_ref: mr.get("target_branch")?.as_str()?.to_string(),
        author: mr.get("author")?.get("username")?.as_str()?.to_string(),
        state: normalize_state(mr.get("state")?.as_str()?),
        mergeable: parse_gitlab_mergeable(mr),
        is_draft,
        url: mr.get("web_url")?.as_str()?.to_string(),
        created_at: mr.get("created_at")?.as_str()?.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forge::{GITHUB, GITLAB};

    #[test]
    fn gitlab_uses_mr_subcommands() {
        assert_eq!(list_args(&GITLAB, 20)[0], "mr");
        assert_eq!(create_args(&GITLAB, "t", "b", "main")[0], "mr");
        assert_eq!(merge_args(&GITLAB, 7)[0], "mr");
        assert_eq!(checkout_args(&GITLAB, 7), vec!["mr", "checkout", "7"]);
        assert_eq!(close_args(&GITLAB, 7), vec!["mr", "close", "7"]);
    }

    #[test]
    fn github_keeps_its_original_arguments() {
        assert_eq!(merge_args(&GITHUB, 7), vec!["pr", "merge", "7", "--merge"]);
        assert_eq!(checkout_args(&GITHUB, 7), vec!["pr", "checkout", "7"]);
        let create = create_args(&GITHUB, "t", "b", "main");
        assert!(create.contains(&"--body".to_string()));
        assert!(create.contains(&"--base".to_string()));
    }

    #[test]
    fn gitlab_create_and_merge_skip_the_confirmation_prompt() {
        // Both run with stdin closed; without --yes they block until timeout.
        assert!(create_args(&GITLAB, "t", "b", "main").contains(&"--yes".to_string()));
        assert!(merge_args(&GITLAB, 1).contains(&"--yes".to_string()));
    }

    #[test]
    fn gitlab_merge_does_not_wait_for_the_pipeline() {
        // glab defaults --auto-merge to true, which would queue instead of merge.
        assert!(merge_args(&GITLAB, 1).contains(&"--auto-merge=false".to_string()));
    }

    #[test]
    fn gitlab_states_map_to_github_vocabulary() {
        assert_eq!(normalize_state("opened"), "OPEN");
        assert_eq!(normalize_state("merged"), "MERGED");
        assert_eq!(normalize_state("closed"), "CLOSED");
        // GitHub's own values pass through unchanged.
        assert_eq!(normalize_state("OPEN"), "OPEN");
    }

    #[test]
    fn draft_prefix_is_stripped_from_gitlab_titles() {
        assert_eq!(
            split_draft_prefix(&GITLAB, "Draft: Fix the thing"),
            ("Fix the thing".to_string(), true)
        );
        assert_eq!(
            split_draft_prefix(&GITLAB, "WIP: Fix the thing"),
            ("Fix the thing".to_string(), true)
        );
        assert_eq!(
            split_draft_prefix(&GITLAB, "draft: lowercase too"),
            ("lowercase too".to_string(), true)
        );
        assert_eq!(
            split_draft_prefix(&GITLAB, "Drafting a proposal"),
            ("Drafting a proposal".to_string(), false)
        );
    }

    #[test]
    fn github_titles_are_never_stripped() {
        // GitHub has a real draft flag, so a literal "Draft:" is just a title.
        assert_eq!(
            split_draft_prefix(&GITHUB, "Draft: a real title"),
            ("Draft: a real title".to_string(), false)
        );
    }

    #[test]
    fn parses_a_gitlab_merge_request() {
        // Shape taken from a live gitlab.com API response.
        let json = r#"[{
            "iid": 250189,
            "id": 519439620,
            "title": "Draft: Persist channel membership",
            "source_branch": "feature-branch",
            "target_branch": "master",
            "author": {"username": "jdoe", "name": "J Doe"},
            "state": "opened",
            "merge_status": "can_be_merged",
            "draft": true,
            "web_url": "https://gitlab.com/g/p/-/merge_requests/250189",
            "created_at": "2026-08-14T09:51:30.014Z"
        }]"#;
        let prs = parse_list(&GITLAB, json).expect("should parse");
        assert_eq!(prs.len(), 1);
        let pr = &prs[0];
        // iid, not the global id.
        assert_eq!(pr.number, 250189);
        assert_eq!(pr.title, "Persist channel membership");
        assert!(pr.is_draft);
        assert_eq!(pr.state, "OPEN");
        assert_eq!(pr.head_ref, "feature-branch");
        assert_eq!(pr.base_ref, "master");
        assert_eq!(pr.author, "jdoe");
        assert_eq!(pr.mergeable, Some(true));
    }

    #[test]
    fn gitlab_unresolved_merge_status_is_unknown_not_false() {
        let json = r#"[{
            "iid": 1, "title": "t", "source_branch": "a", "target_branch": "b",
            "author": {"username": "u"}, "state": "opened",
            "merge_status": "checking",
            "web_url": "https://example.com", "created_at": "2026-01-01T00:00:00Z"
        }]"#;
        let prs = parse_list(&GITLAB, json).expect("should parse");
        assert_eq!(prs[0].mergeable, None);
    }

    /// Build one MR with the given merge-status field, for the cases below.
    fn mr_with(field: &str, value: &str) -> String {
        format!(
            r#"[{{"iid": 1, "title": "t", "source_branch": "a", "target_branch": "b",
                 "author": {{"username": "u"}}, "state": "opened", "{field}": "{value}",
                 "web_url": "https://example.com", "created_at": "2026-01-01T00:00:00Z"}}]"#
        )
    }

    #[test]
    fn gitlab_reads_detailed_merge_status_when_merge_status_is_absent() {
        // What `glab mr list --output json` actually sends (glab 1.113.0).
        let mergeable = parse_list(&GITLAB, &mr_with("detailed_merge_status", "mergeable"))
            .expect("should parse");
        assert_eq!(mergeable[0].mergeable, Some(true));

        let conflict =
            parse_list(&GITLAB, &mr_with("detailed_merge_status", "conflict")).expect("parses");
        assert_eq!(conflict[0].mergeable, Some(false));
    }

    #[test]
    fn gitlab_policy_blocks_are_not_reported_as_conflicts() {
        // These block the merge button but the branch still merges cleanly, so
        // claiming `false` would show a conflict warning that isn't true.
        for status in ["discussions_not_resolved", "not_approved", "ci_must_pass"] {
            let prs = parse_list(&GITLAB, &mr_with("detailed_merge_status", status))
                .expect("should parse");
            assert_eq!(
                prs[0].mergeable, None,
                "{status} should read as unknown, not conflicting"
            );
        }
    }

    #[test]
    fn gitlab_draft_falls_back_to_the_title_when_no_flag_is_sent() {
        let json = r#"[{
            "iid": 1, "title": "WIP: older instance", "source_branch": "a",
            "target_branch": "b", "author": {"username": "u"}, "state": "opened",
            "web_url": "https://example.com", "created_at": "2026-01-01T00:00:00Z"
        }]"#;
        let prs = parse_list(&GITLAB, json).expect("should parse");
        assert!(prs[0].is_draft);
        assert_eq!(prs[0].title, "older instance");
    }

    #[test]
    fn parses_a_github_pull_request() {
        let json = r#"[{
            "number": 42, "title": "Fix it", "headRefName": "fix",
            "baseRefName": "main", "author": {"login": "octocat"},
            "state": "OPEN", "mergeable": "MERGEABLE", "isDraft": false,
            "url": "https://github.com/o/r/pull/42",
            "createdAt": "2026-01-01T00:00:00Z"
        }]"#;
        let prs = parse_list(&GITHUB, json).expect("should parse");
        assert_eq!(prs[0].number, 42);
        assert_eq!(prs[0].title, "Fix it");
        assert_eq!(prs[0].state, "OPEN");
        assert_eq!(prs[0].mergeable, Some(true));
    }

    #[test]
    fn malformed_entries_are_skipped_not_fatal() {
        let json = r#"[
            {"iid": 1, "title": "good", "source_branch": "a", "target_branch": "b",
             "author": {"username": "u"}, "state": "opened",
             "web_url": "https://example.com", "created_at": "2026-01-01T00:00:00Z"},
            {"iid": 2, "title": "missing everything else"}
        ]"#;
        let prs = parse_list(&GITLAB, json).expect("should parse");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].title, "good");
    }

    #[test]
    fn command_labels_name_the_binary_and_noun() {
        assert_eq!(command_label(&GITHUB, "list"), "gh pr list");
        assert_eq!(command_label(&GITLAB, "merge"), "glab mr merge");
    }
}
