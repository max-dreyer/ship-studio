//! # Listing and Cloning Repositories Per Forge
//!
//! The import flow needs three things a forge can answer: who am I, which
//! namespaces can I pick from, and which repositories live in one of them.
//! `gh` and `glab` answer all three differently, so the argument shapes and
//! response parsing live here rather than in the command layer.
//!
//! Verified against `gh` 2.x and `glab` 1.113.0:
//!
//! | | `gh` | `glab` |
//! |---|---|---|
//! | own repos | `repo list <user>` | `repo list --user <user>` |
//! | namespace repos | `repo list <org>` | `repo list --group <path> --include-subgroups` |
//! | repos shared with me | `api /user/repos?affiliation=collaborator` | `repo list --member` |
//! | JSON | `--json <fields>` | `-F json` |
//! | page size | `--limit` | `--per-page` |
//! | jq filtering | `--jq` | not on `glab api` — parse the JSON instead |
//!
//! `glab api` has no `--jq` flag in 1.113.0, so the identity and group lookups
//! come back as full JSON and are parsed with serde. That is also why the GitLab
//! project listing keeps its own parser: `glab repo list -F json` returns the
//! raw GitLab API project objects (~150 fields), not a `gh`-shaped subset.

use super::{ForgeConfig, ForgeTransport};
use crate::types::ForgeRepo;

/// How many repositories to ask for. Matches the GitHub import flow's existing
/// `--limit 100`, and is GitLab's maximum accepted `per_page`.
const PAGE_SIZE: &str = "100";

/// Minimum GitLab access level a group must grant to be worth listing.
///
/// 20 is Reporter, the lowest level that can read a private project's
/// repository. Guest (10) would put groups in the picker whose projects the user
/// then cannot clone.
const MIN_GROUP_ACCESS_LEVEL: &str = "20";

/// Which set of repositories the user asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerKind {
    /// Repositories in a user's own namespace.
    User,
    /// Repositories under an organization (GitHub) or group (GitLab).
    Group,
    /// Repositories owned by somebody else that the user has access to.
    Shared,
}

impl OwnerKind {
    /// Parse the frontend's discriminator. Unknown values are a bug in the
    /// caller, not user input, so they get a `Validation` error rather than a
    /// silent fallback that would list the wrong account's repositories.
    pub fn parse(value: &str) -> Result<Self, crate::errors::CommandError> {
        match value {
            "user" => Ok(Self::User),
            "group" => Ok(Self::Group),
            "shared" => Ok(Self::Shared),
            other => Err(crate::errors::CommandError::Validation {
                field: "ownerKind".to_string(),
                reason: format!("Unknown owner kind \"{other}\"."),
            }),
        }
    }
}

/// The CLI binary for a forge, or an error naming the forge when we reach it
/// over REST instead (Forgejo).
pub fn cli_binary(forge: &ForgeConfig) -> Result<&'static str, crate::errors::CommandError> {
    match forge.transport {
        ForgeTransport::Cli(binary) => Ok(binary),
        ForgeTransport::Rest => Err(crate::errors::CommandError::expected(format!(
            "Ship Studio can't import from {} yet — it talks to {} over its API, which needs a token that can't be set up here.",
            forge.display_name, forge.display_name
        ))),
    }
}

/// Arguments for reading the signed-in user's identity.
pub fn user_args(forge: &ForgeConfig) -> Vec<String> {
    match forge.id {
        // No `--jq` on `glab api` (1.113.0); the whole user object comes back
        // and `parse_user` picks the field out.
        "gitlab" => vec!["api".into(), "user".into()],
        _ => vec!["api".into(), "user".into(), "--jq".into(), ".login".into()],
    }
}

/// Arguments for listing the groups/organizations the user can pick from.
pub fn groups_args(forge: &ForgeConfig) -> Vec<String> {
    match forge.id {
        "gitlab" => vec![
            "api".into(),
            format!("groups?min_access_level={MIN_GROUP_ACCESS_LEVEL}&per_page={PAGE_SIZE}"),
        ],
        _ => vec![
            "api".into(),
            "user/orgs".into(),
            "--jq".into(),
            ".[].login".into(),
        ],
    }
}

/// Arguments for reading which instance the CLI is signed in to.
///
/// GitLab only: `glab config get host` names the instance, which matters because
/// a self-hosted GitLab is the normal case. `gh` has no equivalent that is
/// trustworthy without a token scope check, so the GitHub path reports no host
/// rather than claiming "github.com" for what might be an Enterprise instance.
pub fn host_args(forge: &ForgeConfig) -> Option<Vec<String>> {
    (forge.id == "gitlab").then(|| vec!["config".into(), "get".into(), "host".into()])
}

/// Arguments for listing repositories in the requested scope.
///
/// `owner` is ignored for [`OwnerKind::Shared`], which is defined by the
/// signed-in user rather than by a namespace.
pub fn repo_list_args(forge: &ForgeConfig, kind: OwnerKind, owner: &str) -> Vec<String> {
    match (forge.id, kind) {
        ("gitlab", OwnerKind::User) => vec![
            "repo".into(),
            "list".into(),
            "--user".into(),
            owner.into(),
            "-F".into(),
            "json".into(),
            "--per-page".into(),
            PAGE_SIZE.into(),
        ],
        ("gitlab", OwnerKind::Group) => vec![
            "repo".into(),
            "list".into(),
            "--group".into(),
            owner.into(),
            // Subgroups are how GitLab teams organize; without this a group
            // picker would show an empty list for exactly those users.
            "--include-subgroups".into(),
            "-F".into(),
            "json".into(),
            "--per-page".into(),
            PAGE_SIZE.into(),
        ],
        ("gitlab", OwnerKind::Shared) => vec![
            "repo".into(),
            "list".into(),
            "--member".into(),
            "-F".into(),
            "json".into(),
            "--per-page".into(),
            PAGE_SIZE.into(),
        ],
        (_, OwnerKind::Shared) => vec![
            "api".into(),
            "/user/repos?affiliation=collaborator&per_page=100&sort=updated".into(),
            "--paginate".into(),
        ],
        _ => vec![
            "repo".into(),
            "list".into(),
            owner.into(),
            "--json".into(),
            "name,url,sshUrl,isPrivate,description,primaryLanguage,updatedAt".into(),
            "--limit".into(),
            PAGE_SIZE.into(),
        ],
    }
}

/// Arguments for cloning a repository into `target_dir` under the caller's cwd.
///
/// Both CLIs take `<path> [dir]` positionally and both use the credentials they
/// already hold, which is the reason the import shells out to them instead of
/// running `git clone` against a URL: neither a token nor an SSH key has to be
/// assembled here.
pub fn clone_args(_forge: &ForgeConfig, repo_path: &str, target_dir: &str) -> Vec<String> {
    vec![
        "repo".into(),
        "clone".into(),
        repo_path.into(),
        target_dir.into(),
    ]
}

/// Pull the username out of `glab api user`'s response.
pub fn parse_user(stdout: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(stdout).ok()?;
    value
        .get("username")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|name| !name.is_empty())
}

/// Pull group paths out of `glab api groups`'s response.
///
/// `full_path` rather than `name`: nested groups need their whole path both to
/// be unambiguous in the picker and to be accepted by `--group`.
pub fn parse_groups(stdout: &str) -> Vec<String> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(stdout)
    else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|g| g.get("full_path").and_then(|v| v.as_str()))
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect()
}

/// One project as `glab repo list -F json` sends it.
///
/// Only the fields the import flow uses are declared; GitLab sends ~150 per
/// project and serde ignores the rest.
#[derive(serde::Deserialize)]
struct GitLabProject {
    /// Slug within the namespace ("rausradar"), which is what the local folder
    /// gets named after. Distinct from `name`, GitLab's display title
    /// ("RausRadar").
    path: String,
    path_with_namespace: String,
    web_url: String,
    ssh_url_to_repo: String,
    /// "private" | "internal" | "public".
    visibility: String,
    description: Option<String>,
    last_activity_at: Option<String>,
    created_at: Option<String>,
}

/// Parse `glab repo list -F json` into the shared repo shape.
pub fn parse_gitlab_repos(stdout: &str) -> Result<Vec<ForgeRepo>, serde_json::Error> {
    let projects: Vec<GitLabProject> = serde_json::from_str(stdout)?;
    Ok(projects
        .into_iter()
        .map(|p| ForgeRepo {
            name: p.path,
            full_path: p.path_with_namespace,
            url: p.web_url,
            ssh_url: p.ssh_url_to_repo,
            // "internal" is not public, so it must not read as public — but it
            // is not private either, which is why `visibility` travels along
            // and the UI labels it rather than flattening it to a bool.
            is_private: p.visibility != "public",
            visibility: Some(p.visibility),
            // GitLab's project list carries no language; it would need a
            // per-project `/languages` call. Left unset instead of guessed.
            primary_language: None,
            description: p.description.filter(|d| !d.trim().is_empty()),
            // Sorting in the picker needs *some* timestamp. `last_activity_at`
            // is GitLab's equivalent of GitHub's `updatedAt`; a project with
            // neither falls back to its creation date rather than to "now",
            // which would jump a stale project to the top of the list.
            updated_at: p
                .last_activity_at
                .or(p.created_at)
                .unwrap_or_else(String::new),
        })
        .collect())
}

/// A label for a listing invocation, for timeout messages and telemetry.
pub fn label(forge: &ForgeConfig, what: &str) -> String {
    let binary = match forge.transport {
        ForgeTransport::Cli(name) => name,
        ForgeTransport::Rest => forge.id,
    };
    format!("{binary} {what}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forge::{FORGEJO, GITHUB, GITLAB};

    #[test]
    fn owner_kind_parses_the_frontend_values() {
        assert_eq!(OwnerKind::parse("user").unwrap(), OwnerKind::User);
        assert_eq!(OwnerKind::parse("group").unwrap(), OwnerKind::Group);
        assert_eq!(OwnerKind::parse("shared").unwrap(), OwnerKind::Shared);
    }

    #[test]
    fn an_unknown_owner_kind_is_rejected_rather_than_guessed() {
        // Falling back to "user" here would list the wrong account's repos.
        assert!(matches!(
            OwnerKind::parse("org"),
            Err(crate::errors::CommandError::Validation { .. })
        ));
    }

    #[test]
    fn github_lists_a_namespace_positionally() {
        let args = repo_list_args(&GITHUB, OwnerKind::Group, "acme");
        assert_eq!(args[0..3], ["repo", "list", "acme"]);
        assert!(args.contains(&"--json".to_string()));
        assert!(args.contains(&"--limit".to_string()));
    }

    #[test]
    fn gitlab_separates_users_from_groups() {
        let user = repo_list_args(&GITLAB, OwnerKind::User, "maxdreyer");
        let user_idx = user.iter().position(|a| a == "--user").expect("has --user");
        assert_eq!(user[user_idx + 1], "maxdreyer");
        assert!(!user.contains(&"--include-subgroups".to_string()));

        let group = repo_list_args(&GITLAB, OwnerKind::Group, "acme/web");
        let group_idx = group
            .iter()
            .position(|a| a == "--group")
            .expect("has --group");
        assert_eq!(group[group_idx + 1], "acme/web");
        // Without this, a group that keeps its projects in subgroups looks empty.
        assert!(group.contains(&"--include-subgroups".to_string()));
    }

    #[test]
    fn shared_repos_ignore_the_owner_and_ask_each_cli_its_own_way() {
        let gitlab = repo_list_args(&GITLAB, OwnerKind::Shared, "ignored");
        assert!(gitlab.contains(&"--member".to_string()));
        assert!(!gitlab.contains(&"ignored".to_string()));

        let github = repo_list_args(&GITHUB, OwnerKind::Shared, "ignored");
        assert_eq!(github[0], "api");
        assert!(github
            .iter()
            .any(|a| a.contains("affiliation=collaborator")));
        assert!(!github.contains(&"ignored".to_string()));
    }

    #[test]
    fn every_gitlab_listing_asks_for_json() {
        for kind in [OwnerKind::User, OwnerKind::Group, OwnerKind::Shared] {
            let args = repo_list_args(&GITLAB, kind, "acme");
            assert!(args.contains(&"-F".to_string()), "{kind:?} misses -F");
            assert!(args.contains(&"json".to_string()), "{kind:?} misses json");
        }
    }

    #[test]
    fn gitlab_identity_lookups_avoid_jq() {
        // `glab api` has no --jq (1.113.0); passing it fails the whole call.
        assert!(!user_args(&GITLAB).contains(&"--jq".to_string()));
        assert!(!groups_args(&GITLAB).contains(&"--jq".to_string()));
        // gh does have it, and using it keeps the response small.
        assert!(user_args(&GITHUB).contains(&"--jq".to_string()));
    }

    #[test]
    fn gitlab_groups_are_filtered_to_readable_ones() {
        let args = groups_args(&GITLAB);
        assert!(args
            .iter()
            .any(|a| a.contains("min_access_level=20") && a.contains("per_page=100")));
    }

    #[test]
    fn only_gitlab_reports_its_instance() {
        // gh can't answer this without guessing, and guessing "github.com" for
        // an Enterprise instance would be worse than saying nothing.
        assert_eq!(
            host_args(&GITLAB),
            Some(vec!["config".into(), "get".into(), "host".into()])
        );
        assert_eq!(host_args(&GITHUB), None);
    }

    #[test]
    fn clone_passes_path_and_directory_positionally() {
        for forge in [&GITHUB, &GITLAB] {
            let args = clone_args(forge, "acme/web", "web");
            assert_eq!(args, ["repo", "clone", "acme/web", "web"]);
        }
    }

    #[test]
    fn rest_forges_are_refused_by_name() {
        assert_eq!(cli_binary(&GITHUB).unwrap(), "gh");
        assert_eq!(cli_binary(&GITLAB).unwrap(), "glab");
        let err = cli_binary(&FORGEJO).unwrap_err();
        assert!(format!("{err}").contains("Forgejo"));
    }

    #[test]
    fn parses_the_gitlab_user() {
        assert_eq!(
            parse_user(r#"{"id":1,"username":"maxdreyer","name":"Max"}"#).as_deref(),
            Some("maxdreyer")
        );
        assert_eq!(parse_user(r#"{"username":""}"#), None);
        assert_eq!(parse_user("not json"), None);
    }

    #[test]
    fn parses_nested_group_paths() {
        let json = r#"[{"id":1,"name":"Websites","full_path":"acme/websites"},
                       {"id":2,"name":"Ops","full_path":"acme"}]"#;
        assert_eq!(parse_groups(json), ["acme/websites", "acme"]);
    }

    #[test]
    fn group_parsing_survives_unexpected_shapes() {
        // A failed call must degrade to "no groups", not kill the whole step.
        assert!(parse_groups("not json").is_empty());
        assert!(parse_groups(r#"{"message":"401 Unauthorized"}"#).is_empty());
    }

    /// Trimmed from a real `glab repo list -F json` response (glab 1.113.0).
    const GITLAB_LIST: &str = r#"[
      {
        "id": 84224950,
        "name": "RausRadar",
        "path": "rausradar",
        "path_with_namespace": "maxdreyer/rausradar",
        "description": "",
        "visibility": "private",
        "web_url": "https://gitlab.com/maxdreyer/rausradar",
        "ssh_url_to_repo": "git@gitlab.com:maxdreyer/rausradar.git",
        "http_url_to_repo": "https://gitlab.com/maxdreyer/rausradar.git",
        "created_at": "2026-07-08T07:47:36.224Z",
        "last_activity_at": "2026-08-17T10:32:59.942Z"
      },
      {
        "id": 84224951,
        "name": "Juicemix",
        "path": "juicemix",
        "path_with_namespace": "websites5080618/juicemix",
        "description": "Kundenseite",
        "visibility": "internal",
        "web_url": "https://gitlab.com/websites5080618/juicemix",
        "ssh_url_to_repo": "git@gitlab.com:websites5080618/juicemix.git",
        "created_at": "2026-05-13T19:51:42.488Z"
      }
    ]"#;

    #[test]
    fn parses_a_real_gitlab_listing() {
        let repos = parse_gitlab_repos(GITLAB_LIST).expect("parses");
        assert_eq!(repos.len(), 2);

        // The slug, not GitLab's display title: the local folder is named after
        // this, and "RausRadar" would produce a differently-cased directory.
        assert_eq!(repos[0].name, "rausradar");
        assert_eq!(repos[0].full_path, "maxdreyer/rausradar");
        assert_eq!(repos[0].updated_at, "2026-08-17T10:32:59.942Z");
        // An empty description is no description, not an empty line in the UI.
        assert_eq!(repos[0].description, None);
        // GitLab's list has no language field; nothing is invented for it.
        assert!(repos[0].primary_language.is_none());
    }

    #[test]
    fn internal_projects_are_not_reported_as_public() {
        let repos = parse_gitlab_repos(GITLAB_LIST).expect("parses");
        assert!(repos[1].is_private, "internal is not public");
        assert_eq!(repos[1].visibility.as_deref(), Some("internal"));
        assert_eq!(repos[1].description.as_deref(), Some("Kundenseite"));
    }

    #[test]
    fn a_project_without_activity_falls_back_to_its_creation_date() {
        let repos = parse_gitlab_repos(GITLAB_LIST).expect("parses");
        assert_eq!(repos[1].updated_at, "2026-05-13T19:51:42.488Z");
    }

    #[test]
    fn labels_name_the_binary() {
        assert_eq!(label(&GITLAB, "repo list"), "glab repo list");
        assert_eq!(label(&GITHUB, "api user"), "gh api user");
    }
}
