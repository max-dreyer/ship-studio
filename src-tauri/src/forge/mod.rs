//! # Forge Configuration
//!
//! Defines the git-forge abstraction layer. All forge-specific values (CLI
//! binary names, config-dir env vars, terminology, capability flags) are
//! centralized here so the rest of the codebase can stop hardcoding GitHub.
//!
//! This mirrors the shape of [`crate::agent`]: a plain config struct plus one
//! `const` per supported forge, rather than a trait. The set of forges is known
//! at compile time and small, so dynamic dispatch would buy nothing and would
//! drag `async_trait` in as a dependency.
//!
//! Codeberg runs Forgejo, so it is served by the `forgejo` config rather than
//! getting one of its own — the API is the same.

pub mod detect;
pub mod errors;
pub mod listing;
pub mod pr;
pub mod remote;
pub mod repo;

impl ForgeConfig {
    /// Flatten this config into the shape the frontend consumes.
    pub fn to_info(&self) -> crate::types::ForgeInfo {
        crate::types::ForgeInfo {
            id: self.id.to_string(),
            display_name: self.display_name.to_string(),
            pull_request_term: self.terms.pull_request.to_string(),
            pull_request_short: self.terms.pull_request_short.to_string(),
            organization_term: self.terms.organization.to_string(),
            repository_term: self.terms.repository.to_string(),
            has_cli: matches!(self.transport, ForgeTransport::Cli(_)),
            hosting_auto_deploy: self.capabilities.hosting_auto_deploy,
            nested_namespaces: self.capabilities.nested_namespaces,
        }
    }
}

/// How Ship Studio talks to a forge.
pub enum ForgeTransport {
    /// Shell out to a `gh`-style CLI. The str is the binary name.
    ///
    /// Preferred where a mature official CLI exists: it owns the OAuth flow,
    /// the token storage and the git credential helper, so none of those become
    /// our problem.
    Cli(&'static str),
    /// Talk to the REST API directly with a token from the keychain vault.
    ///
    /// Used where no CLI is worth a hard dependency. Forgejo's situation: `tea`
    /// is Gitea-first and ships no credential helper, `forgejo-cli` has no
    /// winget package. Both would still end at "paste a token", so we ask for
    /// the token directly and skip the binary.
    Rest,
}

/// How a forge represents a draft pull request.
///
/// Only GitHub has a real flag for it; the others encode it in the title. The
/// backend normalizes both directions so the frontend only ever sees a bool.
pub enum DraftSupport {
    /// A dedicated API field (GitHub's `isDraft`).
    Native,
    /// A title prefix, e.g. `"Draft:"` or `"WIP:"`.
    TitlePrefix(&'static str),
}

/// What a forge can and cannot do, relative to the GitHub feature set the app
/// was originally built against.
///
/// The UI reads these to *drop* elements it cannot support, never to render a
/// disabled control with no explanation.
pub struct ForgeCapabilities {
    /// How draft pull requests are encoded.
    pub draft_pull_requests: DraftSupport,
    /// Whether repos the user only collaborates on can be listed separately.
    pub collaborator_repos: bool,
    /// Whether a contribution calendar is available for the dashboard.
    pub contribution_calendar: bool,
    /// Whether project paths can nest deeper than `owner/repo` (GitLab groups).
    pub nested_namespaces: bool,
    /// Whether users routinely run their own instance on a custom domain.
    pub self_hosted: bool,
    /// Whether sign-in runs a browser flow (vs. pasting a personal token).
    pub web_auth_flow: bool,
    /// Whether the hosting providers the app integrates with (Vercel,
    /// Cloudflare) can auto-deploy from this forge on push.
    ///
    /// False for Forgejo: neither provider supports it, so the publish flow
    /// must say so instead of implying a deploy that will never happen.
    pub hosting_auto_deploy: bool,
}

/// Terminology that differs between forges and shows up in user-facing copy.
pub struct ForgeTerms {
    /// Long form: "Pull Request" / "Merge Request".
    pub pull_request: &'static str,
    /// Short form: "PR" / "MR".
    pub pull_request_short: &'static str,
    /// What a group of users is called: "Organization" / "Group".
    pub organization: &'static str,
    /// What a repository is called: "Repository" / "Project". GitLab calls them
    /// projects everywhere in its own UI, so an import wizard that says
    /// "repository" sends users looking for something they won't find.
    pub repository: &'static str,
}

/// Configuration for a git forge integrated with Ship Studio.
pub struct ForgeConfig {
    /// Unique identifier (e.g. "github"). Persisted in project metadata.
    pub id: &'static str,
    /// Human-readable brand name (e.g. "GitHub").
    pub display_name: &'static str,
    /// Host used when the user has not specified one (e.g. "github.com").
    pub default_host: &'static str,
    /// Additional hosts that unambiguously belong to this forge.
    pub known_hosts: &'static [&'static str],
    /// How we talk to it.
    pub transport: ForgeTransport,
    /// Env var that redirects the CLI's config dir, for per-workspace auth
    /// isolation (e.g. "GH_CONFIG_DIR"). `None` for REST forges, whose token is
    /// already scoped per workspace in the keychain vault.
    pub config_dir_env: Option<&'static str>,
    /// CLI args that make the binary act as a git credential helper.
    /// `None` means we have to supply credentials ourselves.
    pub credential_helper_args: Option<&'static [&'static str]>,
    /// Setup item IDs: (binary_id, auth_id). `binary_id` is `None` for REST
    /// forges, which need nothing installed.
    pub setup_item_ids: (Option<&'static str>, &'static str),
    /// Homebrew formula for the CLI, if any.
    pub brew_package: Option<&'static str>,
    /// Winget package id for the CLI, if any.
    pub winget_id: Option<&'static str>,
    /// Path segment that identifies the API root, used to probe an unknown host
    /// (e.g. "api/v4/version" for GitLab, "api/v1/version" for Forgejo).
    pub version_probe_path: &'static str,
    /// User-facing terminology.
    pub terms: ForgeTerms,
    /// Capability flags.
    pub capabilities: ForgeCapabilities,
}

/// GitHub, via the `gh` CLI. The original and still the default.
pub const GITHUB: ForgeConfig = ForgeConfig {
    id: "github",
    display_name: "GitHub",
    default_host: "github.com",
    known_hosts: &["github.com", "www.github.com"],
    transport: ForgeTransport::Cli("gh"),
    config_dir_env: Some("GH_CONFIG_DIR"),
    credential_helper_args: Some(&["auth", "git-credential"]),
    setup_item_ids: (Some("gh"), "gh_auth"),
    brew_package: Some("gh"),
    winget_id: Some("GitHub.cli"),
    version_probe_path: "api/v3/",
    terms: ForgeTerms {
        pull_request: "Pull Request",
        pull_request_short: "PR",
        organization: "Organization",
        repository: "Repository",
    },
    capabilities: ForgeCapabilities {
        draft_pull_requests: DraftSupport::Native,
        collaborator_repos: true,
        contribution_calendar: true,
        nested_namespaces: false,
        self_hosted: false,
        web_auth_flow: true,
        hosting_auto_deploy: true,
    },
};

/// GitLab, via the official `glab` CLI.
pub const GITLAB: ForgeConfig = ForgeConfig {
    id: "gitlab",
    display_name: "GitLab",
    default_host: "gitlab.com",
    known_hosts: &["gitlab.com", "www.gitlab.com"],
    transport: ForgeTransport::Cli("glab"),
    config_dir_env: Some("GITLAB_CONFIG_DIR"),
    credential_helper_args: Some(&["auth", "git-credential"]),
    setup_item_ids: (Some("glab"), "glab_auth"),
    brew_package: Some("glab"),
    winget_id: Some("GLab.GLab"),
    version_probe_path: "api/v4/version",
    terms: ForgeTerms {
        pull_request: "Merge Request",
        pull_request_short: "MR",
        organization: "Group",
        repository: "Project",
    },
    capabilities: ForgeCapabilities {
        draft_pull_requests: DraftSupport::TitlePrefix("Draft:"),
        collaborator_repos: true,
        contribution_calendar: false,
        nested_namespaces: true,
        self_hosted: true,
        web_auth_flow: true,
        hosting_auto_deploy: true,
    },
};

/// Forgejo, via its REST API. Also serves Codeberg, which runs Forgejo.
pub const FORGEJO: ForgeConfig = ForgeConfig {
    id: "forgejo",
    display_name: "Forgejo",
    default_host: "codeberg.org",
    known_hosts: &["codeberg.org", "www.codeberg.org"],
    transport: ForgeTransport::Rest,
    config_dir_env: None,
    credential_helper_args: None,
    setup_item_ids: (None, "forgejo_auth"),
    brew_package: None,
    winget_id: None,
    version_probe_path: "api/v1/version",
    terms: ForgeTerms {
        pull_request: "Pull Request",
        pull_request_short: "PR",
        organization: "Organization",
        repository: "Repository",
    },
    capabilities: ForgeCapabilities {
        draft_pull_requests: DraftSupport::TitlePrefix("WIP:"),
        collaborator_repos: true,
        contribution_calendar: false,
        nested_namespaces: false,
        self_hosted: true,
        // Neither Vercel nor Cloudflare Pages can deploy from Forgejo.
        hosting_auto_deploy: false,
        web_auth_flow: false,
    },
};

/// Every forge Ship Studio knows about.
pub const ALL_FORGES: &[&ForgeConfig] = &[&GITHUB, &GITLAB, &FORGEJO];

/// The forge assumed when nothing else identifies one. GitHub, so existing
/// projects behave exactly as they did before forges were a concept.
pub const DEFAULT_FORGE: &ForgeConfig = &GITHUB;

/// Look up a forge by its id. Unknown ids fall back to [`DEFAULT_FORGE`] rather
/// than failing: a project tagged with an id from a newer build should keep
/// working as a GitHub project instead of breaking the whole workspace.
pub fn get_forge_by_id(id: &str) -> &'static ForgeConfig {
    ALL_FORGES
        .iter()
        .find(|f| f.id == id)
        .copied()
        .unwrap_or(DEFAULT_FORGE)
}

/// Map a hostname to a forge, for hosts we can identify without asking the
/// network. Returns `None` for anything self-hosted — those need either a probe
/// or an explicit choice by the user, and guessing would be worse than asking.
///
/// GitHub Enterprise Cloud (`*.ghe.com`) is matched by suffix because those
/// hosts are per-customer subdomains.
pub fn host_to_forge(host: &str) -> Option<&'static ForgeConfig> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() {
        return None;
    }

    for forge in ALL_FORGES {
        if forge.known_hosts.iter().any(|known| *known == host) {
            return Some(forge);
        }
    }

    if host.ends_with(".ghe.com") {
        return Some(&GITHUB);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_forge_ids_are_unique() {
        let mut ids: Vec<&str> = ALL_FORGES.iter().map(|f| f.id).collect();
        ids.sort_unstable();
        let count = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate forge id in ALL_FORGES");
    }

    #[test]
    fn get_forge_by_id_finds_each_forge() {
        for forge in ALL_FORGES {
            assert_eq!(get_forge_by_id(forge.id).id, forge.id);
        }
    }

    #[test]
    fn get_forge_by_id_falls_back_to_github() {
        assert_eq!(get_forge_by_id("bitbucket").id, "github");
        assert_eq!(get_forge_by_id("").id, "github");
    }

    #[test]
    fn host_to_forge_maps_known_hosts() {
        assert_eq!(host_to_forge("github.com").map(|f| f.id), Some("github"));
        assert_eq!(host_to_forge("gitlab.com").map(|f| f.id), Some("gitlab"));
        assert_eq!(host_to_forge("codeberg.org").map(|f| f.id), Some("forgejo"));
    }

    #[test]
    fn host_to_forge_is_case_insensitive_and_trims() {
        assert_eq!(host_to_forge(" GitHub.COM ").map(|f| f.id), Some("github"));
        assert_eq!(
            host_to_forge("Codeberg.org.").map(|f| f.id),
            Some("forgejo")
        );
    }

    #[test]
    fn host_to_forge_matches_github_enterprise_cloud() {
        assert_eq!(
            host_to_forge("acme.ghe.com").map(|f| f.id),
            Some("github"),
            "GHE Cloud subdomains are GitHub"
        );
    }

    #[test]
    fn host_to_forge_returns_none_for_self_hosted() {
        // A self-hosted instance is unidentifiable by name alone — it must be
        // probed or chosen, never guessed.
        assert!(host_to_forge("git.example.com").is_none());
        assert!(host_to_forge("").is_none());
        // Not a substring match: this is somebody's own domain, not GitHub.
        assert!(host_to_forge("github.com.evil.example").is_none());
    }

    #[test]
    fn gitlab_speaks_gitlab() {
        // GitLab's own UI says "project" and "group" everywhere; an import
        // wizard saying "repository" sends users looking for the wrong thing.
        assert_eq!(GITLAB.terms.repository, "Project");
        assert_eq!(GITLAB.terms.organization, "Group");
        assert_eq!(GITHUB.terms.repository, "Repository");
    }

    #[test]
    fn forgejo_does_not_promise_hosting_auto_deploy() {
        // Guards the honesty of the publish flow: if this ever flips to true,
        // the UI would imply a Vercel/Cloudflare deploy that cannot happen.
        assert!(!FORGEJO.capabilities.hosting_auto_deploy);
        assert!(GITHUB.capabilities.hosting_auto_deploy);
        assert!(GITLAB.capabilities.hosting_auto_deploy);
    }

    #[test]
    fn rest_forges_declare_no_cli_setup_item() {
        for forge in ALL_FORGES {
            match forge.transport {
                ForgeTransport::Rest => {
                    assert!(
                        forge.setup_item_ids.0.is_none(),
                        "{} is REST-based and needs no binary installed",
                        forge.id
                    );
                    assert!(forge.config_dir_env.is_none());
                }
                ForgeTransport::Cli(binary) => {
                    assert!(
                        forge.setup_item_ids.0.is_some(),
                        "{} shells out to {binary} and must declare a setup item",
                        forge.id
                    );
                }
            }
        }
    }
}
