//! # Creating a Repository Per Forge
//!
//! Builds the arguments for "create a project on the forge and put this folder
//! in it". The two CLIs differ more here than anywhere else, so the differences
//! are named rather than papered over.
//!
//! Verified against `gh` 2.x and `glab` 1.113.0:
//!
//! | | `gh repo create` | `glab repo create` |
//! |---|---|---|
//! | name | positional | `--name` |
//! | visibility | `--private` / `--public` | `--private` / `--public`, and it defaults to **internal** if neither is given |
//! | existing folder | `--source .` | implicit: acts on the current repo |
//! | remote | `--remote origin` | `--remoteName origin` |
//! | pushes for you | yes, with `--push` | **no** |
//!
//! The last row is the trap: a GitLab create that looks like it succeeded
//! leaves the branch unpushed, so [`needs_explicit_push`] tells the caller to
//! follow up with a `git push`.

use super::{ForgeConfig, ForgeTransport};

/// Arguments for creating a repository from the current directory.
pub fn create_args(forge: &ForgeConfig, repo_name: &str, is_private: bool) -> Vec<String> {
    match forge.id {
        "gitlab" => vec![
            "repo".into(),
            "create".into(),
            "--name".into(),
            repo_name.into(),
            // Always explicit: glab's default is "internal", which on gitlab.com
            // behaves like public to any signed-in user. Someone asking for a
            // private repo must not silently get a visible one.
            if is_private {
                "--private".into()
            } else {
                "--public".into()
            },
            "--remoteName".into(),
            "origin".into(),
        ],
        _ => vec![
            "repo".into(),
            "create".into(),
            repo_name.into(),
            if is_private {
                "--private".into()
            } else {
                "--public".into()
            },
            "--source".into(),
            ".".into(),
            "--remote".into(),
            "origin".into(),
            "--push".into(),
        ],
    }
}

/// Whether the caller must run `git push` itself after creating the repo.
///
/// `gh repo create --push` uploads the branch; `glab repo create` only creates
/// the project and wires up the remote. Without this the GitLab flow would
/// report success on an empty remote.
pub fn needs_explicit_push(forge: &ForgeConfig) -> bool {
    forge.id == "gitlab"
}

/// A label for the create invocation, for timeout messages and telemetry.
pub fn create_label(forge: &ForgeConfig) -> String {
    let binary = match forge.transport {
        ForgeTransport::Cli(name) => name,
        ForgeTransport::Rest => forge.id,
    };
    format!("{binary} repo create")
}

/// Whether the forge's stderr says the name is already taken.
///
/// A collision is user input needing a different name, not a malfunction, so
/// the caller turns it into plain language rather than the CLI's raw GraphQL or
/// API error (issue #279).
pub fn is_name_taken(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    // GitHub: "GraphQL: Name already exists on this account (createRepository)".
    // GitLab: "has already been taken" for both the path and name fields.
    //
    // Deliberately not a bare "already exists": git says "remote origin already
    // exists" when a retry hits a half-configured repo, and telling the user to
    // pick a different repository name would send them to fix the wrong thing.
    lower.contains("name already exists on this account")
        || lower.contains("has already been taken")
        || lower.contains("name already exists")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forge::{GITHUB, GITLAB};

    #[test]
    fn github_creates_and_pushes_in_one_command() {
        let args = create_args(&GITHUB, "my-app", true);
        assert_eq!(args[0], "repo");
        assert!(args.contains(&"--push".to_string()));
        assert!(args.contains(&"--source".to_string()));
        // Name is positional on gh.
        assert_eq!(args[2], "my-app");
        assert!(!needs_explicit_push(&GITHUB));
    }

    #[test]
    fn gitlab_names_the_project_with_a_flag_and_needs_a_separate_push() {
        let args = create_args(&GITLAB, "my-app", true);
        let name_idx = args.iter().position(|a| a == "--name").expect("has --name");
        assert_eq!(args[name_idx + 1], "my-app");
        assert!(!args.contains(&"--push".to_string()));
        assert!(!args.contains(&"--source".to_string()));
        assert!(args.contains(&"--remoteName".to_string()));
        // Without this the branch would never reach the remote.
        assert!(needs_explicit_push(&GITLAB));
    }

    #[test]
    fn visibility_is_always_explicit_on_gitlab() {
        // glab defaults to "internal"; a requested private repo must be private.
        assert!(create_args(&GITLAB, "a", true).contains(&"--private".to_string()));
        assert!(create_args(&GITLAB, "a", false).contains(&"--public".to_string()));
        assert!(create_args(&GITHUB, "a", true).contains(&"--private".to_string()));
        assert!(create_args(&GITHUB, "a", false).contains(&"--public".to_string()));
    }

    #[test]
    fn recognizes_both_forges_name_collisions() {
        assert!(is_name_taken(
            "GraphQL: Name already exists on this account (createRepository)"
        ));
        assert!(is_name_taken("Path has already been taken"));
        assert!(!is_name_taken("network unreachable"));
    }

    #[test]
    fn an_existing_git_remote_is_not_a_name_collision() {
        // A retry over a half-configured repo hits this. Telling the user to
        // rename the repository would point them at the wrong problem.
        assert!(!is_name_taken("error: remote origin already exists."));
    }

    #[test]
    fn labels_name_the_binary() {
        assert_eq!(create_label(&GITHUB), "gh repo create");
        assert_eq!(create_label(&GITLAB), "glab repo create");
    }
}
