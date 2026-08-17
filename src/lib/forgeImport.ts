/**
 * Importing an existing repository from a git forge (GitHub, GitLab).
 *
 * The frontend half of `src-tauri/src/commands/forge_import.rs`. Everything
 * forge-specific — which CLI, which arguments, how a namespace is addressed —
 * stays in the backend; this module only carries the answers and the copy that
 * goes with them.
 *
 * Terminology comes from {@link ForgeInfo} (see `lib/forge`), so the wizard says
 * "project" and "group" on GitLab without any component knowing why.
 *
 * @module lib/forgeImport
 */

import { invoke } from '@tauri-apps/api/core';
import type { ForgeInfo } from './forge';

/** A repository as the import wizard shows it, for any forge. */
export interface ForgeRepo {
  /** Slug within its namespace ("rausradar"); the local folder is named after it. */
  name: string;
  /** Full path including the namespace ("acme/web"), used to clone. */
  fullPath: string;
  /** Web URL of the repository. */
  url: string;
  /** SSH clone URL. */
  sshUrl: string;
  /** Whether it's invisible to anonymous users (GitLab's "internal" counts). */
  isPrivate: boolean;
  /**
   * The forge's own visibility word when it has more than two
   * ("private" | "internal" | "public"), else null.
   */
  visibility: string | null;
  description: string | null;
  /** Primary language, when the forge's listing carries one (GitLab's doesn't). */
  primaryLanguage: { name: string } | null;
  /** Last activity timestamp, used to sort the list. */
  updatedAt: string;
}

/** The namespaces a user can import from on one forge. */
export interface ForgeOwners {
  /** The signed-in user's own account name. */
  username: string;
  /** Organizations (GitHub) or groups (GitLab), by full path. */
  groups: string[];
  /**
   * The instance the CLI is signed in to, when it's knowable. Null on GitHub,
   * where an Enterprise host can't be told from github.com without extra token
   * scopes — the UI then shows no host rather than a possibly wrong one.
   */
  host: string | null;
}

/** Whether a forge's CLI is installed and signed in. */
export interface ForgeCliStatus {
  installed: boolean;
  authenticated: boolean;
  /** Binary name ("gh" | "glab"), for naming the tool in setup instructions. */
  binary: string;
}

/** Which set of repositories to list. */
export type ForgeOwnerKind = 'user' | 'group' | 'shared';

/** A namespace pick from the wizard's first step. */
export interface ForgeOwnerSelection {
  kind: ForgeOwnerKind;
  /** Account or group path. Empty for `shared`, which has no namespace. */
  name: string;
}

/** The forges the import wizard can drive. Both are CLI-backed. */
export type ImportForgeId = 'github' | 'gitlab';

/** Read the signed-in identity and the namespaces it can import from. */
export async function listForgeOwners(forgeId: string): Promise<ForgeOwners> {
  return invoke<ForgeOwners>('list_forge_owners', { forgeId });
}

/** List the repositories in one namespace. */
export async function listForgeRepos(
  forgeId: string,
  owner: ForgeOwnerSelection
): Promise<ForgeRepo[]> {
  return invoke<ForgeRepo[]>('list_forge_repos', {
    forgeId,
    ownerKind: owner.kind,
    owner: owner.name,
  });
}

/** An external command to run in a PTY. */
export interface ForgeCommandSpec {
  command: string;
  args: string[];
}

/**
 * The clone command for a repository. Asked for rather than assembled here so
 * `gh` vs `glab` (and their argument shapes) stay in one place — the backend.
 */
export async function getForgeCloneCommand(
  forgeId: string,
  repoPath: string,
  targetDir: string
): Promise<ForgeCommandSpec> {
  return invoke<ForgeCommandSpec>('forge_clone_command', { forgeId, repoPath, targetDir });
}

/** Check whether the forge's CLI is installed and signed in. */
export async function checkForgeCliStatus(forgeId: string): Promise<ForgeCliStatus> {
  return invoke<ForgeCliStatus>('check_forge_cli_status', { forgeId });
}

/**
 * Copy for the "repositories somebody else owns" entry in the owner picker.
 *
 * The two forges don't mean quite the same thing: GitHub can list repos where
 * the user is specifically a *collaborator*, while GitLab's `--member` covers
 * every membership, the user's own projects included. The labels say which,
 * instead of promising a distinction GitLab's listing doesn't make.
 */
export function sharedOwnerCopy(forge: ForgeInfo): { title: string; subtitle: string } {
  if (forge.id === 'gitlab') {
    return { title: 'Member access', subtitle: "Projects you're a member of" };
  }
  return { title: 'Collaborator access', subtitle: 'Repos shared with you' };
}

/**
 * Plural repository term ("Repositories" / "Projects").
 *
 * Unlike `pullRequestPlural`, a trailing "s" isn't enough here: "Repository"
 * pluralizes to "Repositories".
 */
export function repositoryPlural(forge: ForgeInfo): string {
  const term = forge.repositoryTerm;
  return term.endsWith('y') ? `${term.slice(0, -1)}ies` : `${term}s`;
}

/**
 * The visibility label for a repo, or null when it's public and needs none.
 *
 * GitLab's "internal" is neither public nor private: it's visible to everyone
 * signed in to the instance. Showing "Private" for it would misstate who can
 * see the code, so the forge's own word is used when it sent one.
 */
export function visibilityLabel(repo: ForgeRepo): string | null {
  if (repo.visibility && repo.visibility !== 'public') {
    return repo.visibility.charAt(0).toUpperCase() + repo.visibility.slice(1);
  }
  return repo.isPrivate ? 'Private' : null;
}

/** Sort newest-activity-first, the order the picker shows repos in. */
export function sortReposByActivity(repos: ForgeRepo[]): ForgeRepo[] {
  return [...repos].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/** Case-insensitive match on name, full path, and description. */
export function filterRepos(repos: ForgeRepo[], query: string): ForgeRepo[] {
  const q = query.trim().toLowerCase();
  if (!q) return repos;
  return repos.filter(
    (repo) =>
      repo.name.toLowerCase().includes(q) ||
      repo.fullPath.toLowerCase().includes(q) ||
      (repo.description?.toLowerCase().includes(q) ?? false)
  );
}
