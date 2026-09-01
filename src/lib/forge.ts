/**
 * Forge abstraction layer for the frontend.
 *
 * Mirrors `src-tauri/src/forge/mod.rs`. The backend is the source of truth and
 * sends the resolved forge per project via `get_project_forge`; the constants
 * here exist so components have a sensible shape before that call returns, and
 * so tests don't need a Tauri bridge.
 *
 * Terminology lives on the config rather than in each component: GitHub says
 * "Pull Request", GitLab says "Merge Request", and a component that hardcodes
 * either is wrong for half the users.
 *
 * @module lib/forge
 */

import { invoke } from '@tauri-apps/api/core';

/** A git forge Ship Studio can talk to. */
export interface ForgeInfo {
  /** Stable id: "github" | "gitlab" | "forgejo". */
  id: string;
  /** Brand name for display ("GitLab"). */
  displayName: string;
  /** Long form: "Pull Request" or "Merge Request". */
  pullRequestTerm: string;
  /** Short form: "PR" or "MR". */
  pullRequestShort: string;
  /** "Organization" or "Group". */
  organizationTerm: string;
  /** What the forge calls a repository: "Repository", or "Project" on GitLab. */
  repositoryTerm: string;
  /**
   * Whether an installed CLI can drive this forge. False for REST-only forges
   * (Forgejo), where PR actions must be hidden rather than offered and failed.
   */
  hasCli: boolean;
  /** Whether Vercel/Cloudflare can auto-deploy from this forge on push. */
  hostingAutoDeploy: boolean;
  /** Whether project paths nest deeper than `owner/repo` (GitLab groups). */
  nestedNamespaces: boolean;
}

export const GITHUB: ForgeInfo = {
  id: 'github',
  displayName: 'GitHub',
  pullRequestTerm: 'Pull Request',
  pullRequestShort: 'PR',
  organizationTerm: 'Organization',
  repositoryTerm: 'Repository',
  hasCli: true,
  hostingAutoDeploy: true,
  nestedNamespaces: false,
};

export const GITLAB: ForgeInfo = {
  id: 'gitlab',
  displayName: 'GitLab',
  pullRequestTerm: 'Merge Request',
  pullRequestShort: 'MR',
  organizationTerm: 'Group',
  repositoryTerm: 'Project',
  hasCli: true,
  hostingAutoDeploy: true,
  nestedNamespaces: true,
};

export const FORGEJO: ForgeInfo = {
  id: 'forgejo',
  displayName: 'Forgejo',
  pullRequestTerm: 'Pull Request',
  pullRequestShort: 'PR',
  organizationTerm: 'Organization',
  repositoryTerm: 'Repository',
  hasCli: false,
  hostingAutoDeploy: false,
  nestedNamespaces: false,
};

export const ALL_FORGES: ForgeInfo[] = [GITHUB, GITLAB, FORGEJO];

/**
 * The forge assumed before the backend answers, and for anything we can't
 * identify. GitHub, so the UI reads exactly as it did before forges existed.
 */
export const DEFAULT_FORGE: ForgeInfo = GITHUB;

/** Look up a forge by id, falling back to the default for unknown ids. */
export function getForgeById(id: string): ForgeInfo {
  return ALL_FORGES.find((f) => f.id === id) ?? DEFAULT_FORGE;
}

/**
 * Ask the backend which forge a project's `origin` points at.
 *
 * Resolves to {@link DEFAULT_FORGE} rather than rejecting when the lookup
 * fails: this only drives wording and which buttons show, so a failed probe
 * should leave the UI usable, not blank it.
 */
export async function fetchProjectForge(projectPath: string): Promise<ForgeInfo> {
  try {
    const result = await invoke<ForgeInfo>('get_project_forge', { projectPath });
    // A resolved-but-empty answer is as unusable as a rejection, and it does
    // happen: an unmocked command in tests resolves to undefined, and reading
    // a term off it would crash the component rather than degrade it.
    if (!result || typeof result.pullRequestTerm !== 'string') return DEFAULT_FORGE;
    return result;
  } catch {
    return DEFAULT_FORGE;
  }
}

/**
 * Every forge the project already has a remote for, `origin` included.
 *
 * Resolves to an empty list rather than rejecting: this only decides which
 * entries a menu offers, and the caller falls back to origin's forge alone.
 */
export async function fetchProjectForges(projectPath: string): Promise<ForgeInfo[]> {
  try {
    const result = await invoke<ForgeInfo[]>('list_project_forges', { projectPath });
    // An unmocked command in tests resolves to undefined; reading `.id` off the
    // entries would crash the menu rather than degrade it.
    if (!Array.isArray(result)) return [];
    return result.filter((forge) => forge && typeof forge.id === 'string');
  } catch {
    return [];
  }
}

/** Options for putting an existing project on another forge. */
export interface ForgeTransferOptions {
  projectPath: string;
  /** Target forge id ("github" | "gitlab"). */
  forgeId: string;
  /**
   * Repository name. GitHub accepts `owner/name`; GitLab takes a bare name and
   * creates the project in the signed-in user's namespace.
   */
  repoName: string;
  isPrivate: boolean;
  /** Remote to write. Ignored by {@link moveProjectToForge}, which forces `origin`. */
  remoteName: string;
}

export interface ForgeTransferResult {
  /** Web URL of the newly created repository. */
  url: string;
  /** The remote that now points at it. */
  remoteName: string;
  /**
   * What `origin` pointed at before a move. Nothing else records this, so it is
   * the only way to tell the user how to undo.
   */
  previousOriginUrl: string | null;
}

/**
 * Move a project to another forge: create the repository there, repoint
 * `origin`, push every branch and tag.
 *
 * The repository on the old forge is left in place — this never deletes
 * anything, so a move made by mistake is undone by pointing `origin` back at
 * `previousOriginUrl`.
 */
export async function moveProjectToForge(
  options: ForgeTransferOptions
): Promise<ForgeTransferResult> {
  return invoke<ForgeTransferResult>('move_project_to_forge', { options });
}

/**
 * Add another forge as a second remote, leaving `origin` alone. Pull requests
 * and branch actions keep running against `origin`.
 */
export async function mirrorProjectToForge(
  options: ForgeTransferOptions
): Promise<ForgeTransferResult> {
  return invoke<ForgeTransferResult>('mirror_project_to_forge', { options });
}

/**
 * The forge preselected when creating a repository for a new project.
 * Resolves to {@link DEFAULT_FORGE} when unset or unreadable.
 */
export async function getDefaultForge(): Promise<ForgeInfo> {
  try {
    const id = await invoke<string | null>('get_default_forge_id');
    return id ? getForgeById(id) : DEFAULT_FORGE;
  } catch {
    return DEFAULT_FORGE;
  }
}

/** Persist which forge new repositories should default to. */
export async function setDefaultForgeId(forgeId: string): Promise<void> {
  return invoke('set_default_forge_id', { forgeId });
}

/**
 * "Pull Request" / "Merge Request", pluralized.
 *
 * Both terms pluralize with a trailing "s", so this stays a simple suffix. It
 * exists to keep that assumption in one place rather than scattered `+ 's'`.
 */
export function pullRequestPlural(forge: ForgeInfo): string {
  return `${forge.pullRequestTerm}s`;
}

/** Lowercased long form, for mid-sentence use ("open a merge request"). */
export function pullRequestLower(forge: ForgeInfo): string {
  return forge.pullRequestTerm.toLowerCase();
}
