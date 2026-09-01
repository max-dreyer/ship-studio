//! # Which Forge Does This Project Use?
//!
//! Resolves a project directory to the forge its `origin` remote points at, so
//! the rest of the backend can pick the right CLI and the right terminology
//! without every call site re-deriving it.
//!
//! Resolution order:
//! 1. The host is one we know (`github.com`, `gitlab.com`, `codeberg.org`, …).
//! 2. The host's first label names a forge (`gitlab.acme.com` → GitLab). This is
//!    the near-universal self-hosting convention and is narrow enough not to
//!    catch unrelated domains, but it *is* a guess.
//! 3. Anything else falls back to GitHub, which is what every project resolved
//!    to before forges existed. A self-hosted instance on a domain that names
//!    neither (`git.acme.com`) lands here and needs an explicit choice, which
//!    the UI does not offer yet.
//!
//! Detection shells out to `git remote get-url origin`, so results are cached:
//! this runs on the hot path of every forge command, and a remote changes maybe
//! once in a project's life.

use super::{ForgeConfig, ALL_FORGES, DEFAULT_FORGE};
use crate::cache::TtlCache;
use std::path::Path;
use std::sync::LazyLock;
use std::time::Duration;

/// Project path → resolved forge. Ten minutes is long enough to keep the
/// subprocess off the hot path and short enough that adding a remote is picked
/// up without restarting the app. `invalidate_project_forge` handles the cases
/// we know about (remote added/changed); the TTL covers the ones we don't.
static PROJECT_FORGE_CACHE: LazyLock<TtlCache<String, &'static ForgeConfig>> =
    LazyLock::new(|| TtlCache::new(Duration::from_secs(600)));

/// Resolve a remote URL to a forge, applying the self-hosted naming heuristic.
///
/// Split out from [`forge_for_project`] so it can be tested without a git repo.
pub fn forge_for_remote_url(url: &str) -> &'static ForgeConfig {
    identify_remote_url(url).unwrap_or(DEFAULT_FORGE)
}

/// The forge a remote URL names, or `None` when the host identifies none.
///
/// The same resolution as [`forge_for_remote_url`] without its fallback. A
/// caller asking "which forges is this project already on?" must not have
/// `git.acme.com` answered with "GitHub" — that would hide the GitHub entry
/// from a menu on the strength of a guess.
pub fn identify_remote_url(url: &str) -> Option<&'static ForgeConfig> {
    let remote = super::remote::parse_remote(url)?;

    if let Some(forge) = super::host_to_forge(&remote.host) {
        return Some(forge);
    }

    // Self-hosted convention: the instance lives at <forge>.<company>.<tld>.
    // Match on the first label only — a substring search would map
    // "not-gitlab.example.com" and "mygithub-mirror.acme.com" to the wrong
    // forge, and those are exactly the hosts we cannot afford to guess on.
    let first_label = remote.host.split('.').next().unwrap_or_default();
    ALL_FORGES.iter().copied().find(|f| first_label == f.id)
}

/// The forge a project's `origin` remote points at.
///
/// Never fails: a project with no remote, no repo, or an unreadable one
/// resolves to [`DEFAULT_FORGE`], matching the behavior every project had
/// before forges were a concept.
pub fn forge_for_project(project_path: &Path) -> &'static ForgeConfig {
    let key = project_path.to_string_lossy().to_string();
    if let Some(cached) = PROJECT_FORGE_CACHE.get(&key) {
        return cached;
    }

    let forge = detect_uncached(project_path);
    PROJECT_FORGE_CACHE.insert(key, forge);
    forge
}

/// Read `origin` and resolve it, with no cache in the way.
fn detect_uncached(project_path: &Path) -> &'static ForgeConfig {
    let Ok(mut cmd) = crate::utils::git_command_in(project_path) else {
        return DEFAULT_FORGE;
    };

    // `git remote get-url` reads .git/config and touches no network, so the
    // async run_with_timeout helper the network-facing callers use would buy
    // nothing here and would force this whole path to be async. Same reasoning
    // as `ensure_git_identity`.
    let output = match cmd.args(["remote", "get-url", "origin"]).output() {
        Ok(output) if output.status.success() => output,
        // No remote, not a repo, or git missing. All three mean "we cannot
        // know", which is the fallback case, not an error worth surfacing:
        // callers ask this on every command and a local-only project is a
        // perfectly ordinary state.
        _ => return DEFAULT_FORGE,
    };

    let url = String::from_utf8_lossy(&output.stdout);
    forge_for_remote_url(url.trim())
}

/// Every forge the project already has a remote for, `origin` included.
///
/// `git remote -v` rather than `get-url origin`, because a mirror lives on a
/// second remote: a UI that only knows about origin keeps offering to mirror a
/// project onto a forge it is already mirrored to.
///
/// Deliberately uncached — the caller is a menu that opens rarely, and a stale
/// answer here would re-offer a host that was just added.
pub fn forges_for_project(project_path: &Path) -> Vec<&'static ForgeConfig> {
    let Ok(mut cmd) = crate::utils::git_command_in(project_path) else {
        return Vec::new();
    };

    // Reads .git/config and touches no network — same reasoning as
    // `detect_uncached` above.
    let output = match cmd.args(["remote", "-v"]).output() {
        Ok(output) if output.status.success() => output,
        // No repo, no remotes, or no git. All three mean "none that we know of".
        _ => return Vec::new(),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut found: Vec<&'static ForgeConfig> = Vec::new();
    for line in stdout.lines() {
        // "origin\thttps://github.com/owner/repo.git (fetch)" — the URL is the
        // second field, and every remote is listed twice (fetch + push).
        let Some(url) = line.split_whitespace().nth(1) else {
            continue;
        };
        let Some(forge) = identify_remote_url(url) else {
            continue;
        };
        if !found.iter().any(|f| f.id == forge.id) {
            found.push(forge);
        }
    }
    found
}

/// Drop the cached forge for one project. Call after the remote changes.
pub fn invalidate_project_forge(project_path: &Path) {
    PROJECT_FORGE_CACHE.invalidate(project_path.to_string_lossy().as_ref());
}

/// Drop every cached forge. Call when projects are rescanned or reconfigured.
pub fn invalidate_all_project_forges() {
    PROJECT_FORGE_CACHE.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_hosts_resolve_to_their_forge() {
        assert_eq!(
            forge_for_remote_url("https://github.com/owner/repo.git").id,
            "github"
        );
        assert_eq!(
            forge_for_remote_url("git@gitlab.com:group/project.git").id,
            "gitlab"
        );
        assert_eq!(
            forge_for_remote_url("https://codeberg.org/owner/repo.git").id,
            "forgejo"
        );
    }

    #[test]
    fn an_unidentified_host_is_none_rather_than_the_default() {
        // `forge_for_remote_url` answers GitHub for anything it can't place, so
        // "which forges is this project already on?" has to ask the version
        // without the fallback — otherwise a git.acme.com remote would hide the
        // GitHub entry from the transfer menu on the strength of a guess.
        assert!(identify_remote_url("https://git.acme.com/team/site.git").is_none());
        assert!(identify_remote_url("not a url").is_none());
        assert_eq!(
            forge_for_remote_url("https://git.acme.com/team/site.git").id,
            "github"
        );
    }

    #[test]
    fn self_hosted_gitlab_resolves_by_first_label() {
        assert_eq!(
            forge_for_remote_url("https://gitlab.acme.com/group/project.git").id,
            "gitlab"
        );
        assert_eq!(
            forge_for_remote_url("git@gitlab.internal:team/tool.git").id,
            "gitlab"
        );
    }

    #[test]
    fn self_hosted_forgejo_resolves_by_first_label() {
        assert_eq!(
            forge_for_remote_url("https://forgejo.acme.com/owner/repo.git").id,
            "forgejo"
        );
    }

    #[test]
    fn lookalike_hosts_do_not_match_the_heuristic() {
        // A substring search would call both of these GitLab.
        assert_eq!(
            forge_for_remote_url("https://not-gitlab.example.com/a/b.git").id,
            "github"
        );
        assert_eq!(
            forge_for_remote_url("https://mirror.gitlab-clone.com/a/b.git").id,
            "github"
        );
    }

    #[test]
    fn unidentifiable_host_falls_back_to_default() {
        assert_eq!(
            forge_for_remote_url("https://git.acme.com/team/tool.git").id,
            DEFAULT_FORGE.id
        );
    }

    #[test]
    fn unparseable_remote_falls_back_to_default() {
        assert_eq!(forge_for_remote_url("").id, DEFAULT_FORGE.id);
        assert_eq!(
            forge_for_remote_url("/srv/git/repo.git").id,
            DEFAULT_FORGE.id
        );
        assert_eq!(
            forge_for_remote_url("file:///srv/git/repo.git").id,
            DEFAULT_FORGE.id
        );
    }

    #[test]
    fn ghe_host_resolves_to_github() {
        assert_eq!(
            forge_for_remote_url("https://acme.ghe.com/owner/repo.git").id,
            "github"
        );
    }
}
