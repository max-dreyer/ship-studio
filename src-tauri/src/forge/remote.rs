//! # Git Remote Parsing
//!
//! Turns a git remote URL into a host plus a project path, for every URL shape
//! git itself accepts.
//!
//! This replaces the old substring search for `"github.com/"`, which had two
//! problems beyond being GitHub-only: it matched the host anywhere in the
//! string (so `https://evil.example/github.com/a/b` parsed as a GitHub repo),
//! and it assumed the path was exactly two segments. GitLab nests groups
//! arbitrarily deep (`group/subgroup/project`), so the second assumption breaks
//! outright there.

use super::ForgeConfig;

/// A parsed git remote: which host it points at, and the project path on it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteRef {
    /// Lowercased hostname, without userinfo or port (e.g. "github.com").
    pub host: String,
    /// Project path without leading/trailing slashes or a `.git` suffix
    /// (e.g. "owner/repo", or "group/subgroup/project" on GitLab).
    pub path: String,
}

impl RemoteRef {
    /// Everything before the last path segment ("group/subgroup" of
    /// "group/subgroup/project"). This is the namespace a repo lives in, which
    /// on GitLab is not necessarily a single user or group name.
    pub fn owner(&self) -> &str {
        match self.path.rfind('/') {
            Some(idx) => &self.path[..idx],
            None => "",
        }
    }

    /// The last path segment: the repository name itself.
    pub fn repo(&self) -> &str {
        match self.path.rfind('/') {
            Some(idx) => &self.path[idx + 1..],
            None => &self.path,
        }
    }

    /// The canonical https web URL for this remote.
    pub fn web_url(&self) -> String {
        format!("https://{}/{}", self.host, self.path)
    }
}

/// Strip a `user@` prefix and a `:port` suffix from a URL authority, leaving
/// the bare hostname.
fn host_from_authority(authority: &str) -> &str {
    // Userinfo may itself contain '@' (rare but legal), so split at the last one.
    let after_userinfo = match authority.rfind('@') {
        Some(idx) => &authority[idx + 1..],
        None => authority,
    };

    // An IPv6 literal is bracketed and its colons are not a port separator.
    if after_userinfo.starts_with('[') {
        return match after_userinfo.find(']') {
            Some(end) => &after_userinfo[..=end],
            None => after_userinfo,
        };
    }

    match after_userinfo.rfind(':') {
        // Only treat it as a port if what follows actually is one — otherwise
        // we would truncate a hostname that merely contains a colon.
        Some(idx)
            if after_userinfo[idx + 1..]
                .chars()
                .all(|c| c.is_ascii_digit()) =>
        {
            &after_userinfo[..idx]
        }
        _ => after_userinfo,
    }
}

/// Normalize a project path: drop surrounding slashes, a leading `~` (used by
/// some SSH setups), and the `.git` suffix.
fn normalize_path(path: &str) -> String {
    let trimmed = path.trim().trim_matches('/').trim_start_matches('~');
    let trimmed = trimmed.trim_matches('/');
    let without_git = trimmed.strip_suffix(".git").unwrap_or(trimmed);
    without_git.trim_matches('/').to_string()
}

/// Parse a git remote URL into its host and project path.
///
/// Handles the shapes git accepts:
/// - `https://host/owner/repo.git` (and `http://`, with optional userinfo/port)
/// - `git@host:owner/repo.git` (scp-like shorthand)
/// - `ssh://git@host:2222/owner/repo.git`
/// - `git://host/owner/repo.git`
///
/// Returns `None` for anything without a host and at least two path segments.
/// Local paths (`/srv/git/repo.git`, `file://…`) have no forge, so they are
/// `None` too.
pub fn parse_remote(url: &str) -> Option<RemoteRef> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }

    let (authority, path) = match url.find("://") {
        Some(idx) => {
            let scheme = &url[..idx];
            // A local remote has no host to speak of.
            if scheme.eq_ignore_ascii_case("file") {
                return None;
            }
            let rest = &url[idx + 3..];
            let split = rest.find('/')?;
            (&rest[..split], &rest[split + 1..])
        }
        None => {
            // scp-like: [user@]host:path. The colon must come before any slash,
            // otherwise this is a plain filesystem path.
            let colon = url.find(':')?;
            if let Some(slash) = url.find('/') {
                if slash < colon {
                    return None;
                }
            }
            (&url[..colon], &url[colon + 1..])
        }
    };

    let host = host_from_authority(authority).trim_end_matches('.');
    if host.is_empty() {
        return None;
    }

    let path = normalize_path(path);
    // A forge project is always at least "owner/repo"; anything shorter is not
    // something we can act on.
    if path.split('/').filter(|s| !s.is_empty()).count() < 2 {
        return None;
    }
    // Reject paths whose segments are empty after normalization (e.g. "a//b").
    if path.split('/').any(|s| s.is_empty()) {
        return None;
    }

    Some(RemoteRef {
        host: host.to_ascii_lowercase(),
        path,
    })
}

/// Parse a remote and resolve which forge it belongs to, when that is knowable
/// from the hostname alone. A self-hosted host yields the `RemoteRef` but no
/// forge, leaving the caller to probe or ask.
pub fn parse_remote_with_forge(url: &str) -> Option<(RemoteRef, Option<&'static ForgeConfig>)> {
    let remote = parse_remote(url)?;
    let forge = super::host_to_forge(&remote.host);
    Some((remote, forge))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(url: &str) -> (String, String) {
        let r = parse_remote(url).unwrap_or_else(|| panic!("failed to parse {url}"));
        (r.host, r.path)
    }

    #[test]
    fn parses_https_with_git_suffix() {
        assert_eq!(
            parsed("https://github.com/owner/repo.git"),
            ("github.com".into(), "owner/repo".into())
        );
    }

    #[test]
    fn parses_https_without_git_suffix() {
        assert_eq!(
            parsed("https://github.com/owner/repo"),
            ("github.com".into(), "owner/repo".into())
        );
    }

    #[test]
    fn parses_https_with_trailing_slash() {
        assert_eq!(
            parsed("https://github.com/owner/repo/"),
            ("github.com".into(), "owner/repo".into())
        );
    }

    #[test]
    fn parses_scp_style_ssh() {
        assert_eq!(
            parsed("git@github.com:owner/repo.git"),
            ("github.com".into(), "owner/repo".into())
        );
    }

    #[test]
    fn parses_scp_style_without_git_suffix() {
        assert_eq!(
            parsed("git@github.com:owner/repo"),
            ("github.com".into(), "owner/repo".into())
        );
    }

    #[test]
    fn parses_ssh_url_with_port() {
        assert_eq!(
            parsed("ssh://git@git.example.com:2222/owner/repo.git"),
            ("git.example.com".into(), "owner/repo".into())
        );
    }

    #[test]
    fn parses_git_protocol() {
        assert_eq!(
            parsed("git://codeberg.org/owner/repo.git"),
            ("codeberg.org".into(), "owner/repo".into())
        );
    }

    #[test]
    fn parses_https_with_userinfo() {
        assert_eq!(
            parsed("https://someone@gitlab.com/owner/repo.git"),
            ("gitlab.com".into(), "owner/repo".into())
        );
    }

    #[test]
    fn parses_https_with_token_userinfo() {
        // Token-in-URL remotes exist in the wild; the token must not leak into
        // the host and must not stop us from identifying the project.
        assert_eq!(
            parsed("https://oauth2:glpat-xxx@gitlab.com/owner/repo.git"),
            ("gitlab.com".into(), "owner/repo".into())
        );
    }

    #[test]
    fn lowercases_the_host_but_not_the_path() {
        assert_eq!(
            parsed("https://GitHub.COM/Owner/Repo.git"),
            ("github.com".into(), "Owner/Repo".into()),
            "repo paths are case-sensitive on some forges"
        );
    }

    #[test]
    fn keeps_nested_gitlab_namespaces_intact() {
        let r = parse_remote("https://gitlab.com/group/subgroup/project.git")
            .expect("nested namespace should parse");
        assert_eq!(r.path, "group/subgroup/project");
        assert_eq!(r.owner(), "group/subgroup");
        assert_eq!(r.repo(), "project");
    }

    #[test]
    fn owner_and_repo_split_a_flat_path() {
        let r = parse_remote("https://github.com/owner/repo").expect("should parse");
        assert_eq!(r.owner(), "owner");
        assert_eq!(r.repo(), "repo");
    }

    #[test]
    fn handles_dashes_and_dots_in_names() {
        let r = parse_remote("https://github.com/my-org/my.repo-name.git").expect("should parse");
        assert_eq!(r.path, "my-org/my.repo-name");
        assert_eq!(r.repo(), "my.repo-name");
    }

    #[test]
    fn web_url_round_trips() {
        let r = parse_remote("git@codeberg.org:owner/repo.git").expect("should parse");
        assert_eq!(r.web_url(), "https://codeberg.org/owner/repo");
    }

    #[test]
    fn rejects_local_and_malformed_remotes() {
        assert!(parse_remote("").is_none());
        assert!(parse_remote("   ").is_none());
        assert!(parse_remote("not a url").is_none());
        assert!(parse_remote("/srv/git/repo.git").is_none());
        assert!(parse_remote("file:///srv/git/repo.git").is_none());
        assert!(
            parse_remote("https://github.com/owner").is_none(),
            "a bare owner is not a project"
        );
        assert!(parse_remote("https://github.com/").is_none());
        assert!(parse_remote("https://///").is_none());
    }

    #[test]
    fn does_not_match_a_host_appearing_inside_the_path() {
        // The old substring parser returned Some("a/b") here and called it a
        // GitHub repo. The host is evil.example, and nothing else.
        let r = parse_remote("https://evil.example/github.com/a/b.git").expect("should parse");
        assert_eq!(r.host, "evil.example");
        assert_eq!(r.path, "github.com/a/b");
        assert!(
            super::super::host_to_forge(&r.host).is_none(),
            "must not be identified as GitHub"
        );
    }

    #[test]
    fn resolves_forge_for_known_hosts() {
        let cases = [
            ("https://github.com/o/r.git", Some("github")),
            ("git@gitlab.com:g/s/p.git", Some("gitlab")),
            ("https://codeberg.org/o/r", Some("forgejo")),
            ("https://git.selfhosted.example/o/r.git", None),
        ];
        for (url, expected) in cases {
            let (_, forge) =
                parse_remote_with_forge(url).unwrap_or_else(|| panic!("failed to parse {url}"));
            assert_eq!(forge.map(|f| f.id), expected, "for {url}");
        }
    }
}
