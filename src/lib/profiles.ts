/**
 * Profile management utilities.
 *
 * Profiles isolate credentials per client/context (Personal, Work, Company A…).
 * Credential values are stored in the OS keychain — this module only deals in
 * presence/absence (ProfileCredentialStatus), never raw key/token values.
 *
 * @module lib/profiles
 */

import { invoke } from '@tauri-apps/api/core';

/** A user profile for isolating credentials per client/context. */
export interface Profile {
  id: string;
  name: string;
  /** Hex color for visual identification, e.g. "#6b7280" */
  color: string;
  /** True for the built-in Default profile (cannot be deleted) */
  isDefault: boolean;
  /** Unix timestamp (ms) when profile was created */
  createdAt: number;
}

/** Which credential keys are configured for a profile (values stay in the keychain). */
export interface ProfileCredentialStatus {
  hasAnthropicApiKey: boolean;
  hasAnthropicBaseUrl: boolean;
  hasGithubToken: boolean;
  hasVercelToken: boolean;
  hasFigmaToken: boolean;
  hasOpenaiApiKey: boolean;
  hasGitName: boolean;
  hasGitEmail: boolean;
}

/** Credential key identifiers accepted by set/clear commands. */
export type CredentialKey =
  | 'anthropic_api_key'
  | 'anthropic_base_url'
  | 'github_token'
  | 'vercel_token'
  | 'figma_token'
  | 'openai_api_key'
  | 'git_name'
  | 'git_email';

/** Human-readable labels for each credential key. */
export const CREDENTIAL_LABELS: Record<CredentialKey, string> = {
  anthropic_api_key: 'Anthropic API Key',
  anthropic_base_url: 'Anthropic Base URL',
  github_token: 'GitHub Token',
  vercel_token: 'Vercel Token',
  figma_token: 'Figma Personal Access Token',
  openai_api_key: 'OpenAI API Key',
  git_name: 'Git Name',
  git_email: 'Git Email',
};

/** Credential keys that are sensitive (masked input). */
export const SENSITIVE_KEYS = new Set<CredentialKey>([
  'anthropic_api_key',
  'github_token',
  'vercel_token',
  'figma_token',
  'openai_api_key',
]);

/** Maps ProfileCredentialStatus boolean field → CredentialKey. */
export const STATUS_FIELD_TO_KEY: Record<keyof ProfileCredentialStatus, CredentialKey> = {
  hasAnthropicApiKey: 'anthropic_api_key',
  hasAnthropicBaseUrl: 'anthropic_base_url',
  hasGithubToken: 'github_token',
  hasVercelToken: 'vercel_token',
  hasFigmaToken: 'figma_token',
  hasOpenaiApiKey: 'openai_api_key',
  hasGitName: 'git_name',
  hasGitEmail: 'git_email',
};

/** Predefined palette for profile colors. */
export const PROFILE_COLORS = [
  '#6b7280', // gray (default)
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#06b6d4', // cyan
];

export async function listProfiles(): Promise<Profile[]> {
  return invoke<Profile[]>('list_profiles');
}

export async function createProfile(name: string, color: string): Promise<Profile> {
  return invoke<Profile>('create_profile', { name, color });
}

export async function updateProfile(id: string, name: string, color: string): Promise<Profile> {
  return invoke<Profile>('update_profile', { id, name, color });
}

export async function deleteProfile(id: string): Promise<void> {
  return invoke('delete_profile', { id });
}

export async function getProjectProfileId(projectPath: string): Promise<string> {
  return invoke<string>('get_project_profile_id', { projectPath });
}

export async function setProjectProfileId(projectPath: string, profileId: string): Promise<void> {
  return invoke('set_project_profile_id', { projectPath, profileId });
}

export async function getProfileCredentialStatus(
  profileId: string
): Promise<ProfileCredentialStatus> {
  return invoke<ProfileCredentialStatus>('get_profile_credential_status', { profileId });
}

export async function setProfileCredential(
  profileId: string,
  key: CredentialKey,
  value: string
): Promise<void> {
  return invoke('set_profile_credential', { profileId, key, value });
}

export async function clearProfileCredential(profileId: string, key: CredentialKey): Promise<void> {
  return invoke('clear_profile_credential', { profileId, key });
}
