/**
 * API calls for managing inline editor config — enable/disable, domain config,
 * script tag generation, and project linking.
 */

import { getSupabase } from './supabase';
import type {
  InlineEditorConfig,
  EnableProjectRequest,
  EnableProjectResponse,
} from '@shipstudio/shared';

const API_BASE: string = import.meta.env.VITE_SHIPSTUDIO_API_URL as string;

/** Enable inline editor for a project (calls server API) */
export async function enableInlineEditor(
  req: EnableProjectRequest,
  accessToken: string
): Promise<EnableProjectResponse> {
  const resp = await fetch(`${API_BASE}/api/v1/projects/enable`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(req),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to enable inline editor: ${err}`);
  }

  return resp.json() as Promise<EnableProjectResponse>;
}

/** Get inline editor config for a project (direct Supabase) */
export async function getEditorConfig(projectId: string): Promise<InlineEditorConfig | null> {
  const supabase = getSupabase();
  const { data, error }: { data: InlineEditorConfig | null; error: { message: string } | null } =
    await supabase
      .from('inline_editor_config')
      .select('*')
      .eq('project_id', projectId)
      .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/** Update inline editor config (direct Supabase) */
export async function updateEditorConfig(
  configId: string,
  updates: Partial<
    Pick<InlineEditorConfig, 'is_enabled' | 'allowed_domains' | 'require_auth' | 'auto_apply'>
  >
): Promise<InlineEditorConfig> {
  const supabase = getSupabase();
  const { data, error }: { data: InlineEditorConfig | null; error: { message: string } | null } =
    await supabase
      .from('inline_editor_config')
      .update(updates)
      .eq('id', configId)
      .select('*')
      .single();

  if (error) throw new Error(error.message);
  return data as InlineEditorConfig;
}

/** Look up the remote project ID by repo URL (returns null if not found/not enabled) */
export async function findProjectByRepoUrl(
  repoUrl: string
): Promise<{ projectId: string; config: InlineEditorConfig } | null> {
  const supabase = getSupabase();

  // Look up project by repo_url
  const { data: project, error: projErr }: { data: { id: string } | null; error: unknown } =
    await supabase.from('projects').select('id').eq('repo_url', repoUrl).maybeSingle();

  if (projErr || !project) return null;

  // Fetch inline editor config for this project
  const config = await getEditorConfig(project.id);
  if (!config) return null;

  return { projectId: project.id, config };
}

/** Generate the script tag HTML for embedding */
export function generateScriptTag(studioId: string): string {
  return `<script\n  src="https://api.ship.studio/inline-editor.js"\n  data-studio-id="${studioId}"\n  defer\n></script>`;
}

/** GitHub App installation info */
export interface GitHubInstallation {
  installation_id: number;
  github_account_login: string;
  github_account_type: string;
  repository_selection: string;
  suspended_at: string | null;
  repos: Array<{ repo_full_name: string }>;
}

/**
 * Check if the current user has a GitHub App installation that covers a given repo.
 * Returns the installation if found, null otherwise.
 */
export async function getInstallationForRepo(
  repoFullName: string
): Promise<GitHubInstallation | null> {
  const supabase = getSupabase();

  type InstallRow = Omit<GitHubInstallation, 'repos'>;
  type RepoRow = { installation_id: number; repo_full_name: string };

  // First check for installations with 'all' repos
  const { data: allRepoInstalls }: { data: InstallRow[] | null } = await supabase
    .from('github_app_installations')
    .select(
      'installation_id, github_account_login, github_account_type, repository_selection, suspended_at'
    )
    .eq('repository_selection', 'all')
    .is('suspended_at', null);

  // Check if any 'all' installation matches the repo's owner
  const repoOwner = repoFullName.split('/')[0];
  const matchingAll = allRepoInstalls?.find(
    (i: InstallRow) => i.github_account_login.toLowerCase() === repoOwner.toLowerCase()
  );

  if (matchingAll) {
    return { ...matchingAll, repos: [] };
  }

  // Check 'selected' installations via the repos table
  const { data: repoMatch }: { data: RepoRow | null } = await supabase
    .from('github_app_installation_repos')
    .select('installation_id, repo_full_name')
    .eq('repo_full_name', repoFullName)
    .maybeSingle();

  if (!repoMatch) return null;

  // Get the installation details
  const { data: install }: { data: InstallRow | null } = await supabase
    .from('github_app_installations')
    .select(
      'installation_id, github_account_login, github_account_type, repository_selection, suspended_at'
    )
    .eq('installation_id', repoMatch.installation_id)
    .is('suspended_at', null)
    .maybeSingle();

  if (!install) return null;

  return { ...install, repos: [{ repo_full_name: repoMatch.repo_full_name }] };
}

/** Get the GitHub App install URL */
export function getGitHubAppInstallUrl(): string {
  const appSlug = import.meta.env.VITE_GITHUB_APP_SLUG as string;
  return `https://github.com/apps/${appSlug}/installations/new`;
}
