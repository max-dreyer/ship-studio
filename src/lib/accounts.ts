/**
 * Account (Workspace) management utilities.
 *
 * An Account ("Workspace" in the UI) isolates Claude Code login, GitHub CLI
 * login, and a small credential vault per org/client context. It's selected
 * once per session (at startup, or via "Switch Workspace") rather than
 * assigned per-project. Credential values are stored in the OS keychain —
 * this module only deals in presence/absence (AccountCredentialStatus),
 * never raw key/token values.
 *
 * @module lib/accounts
 */

import { invoke } from '@tauri-apps/api/core';

/** A Workspace for isolating Claude/GitHub config and credentials per org/client. */
export interface Account {
  id: string;
  name: string;
  /** Hex color for visual identification, e.g. "#6b7280" */
  color: string;
  /** True for the built-in Default workspace (cannot be deleted) */
  isDefault: boolean;
  /** Unix timestamp (ms) when the workspace was created */
  createdAt: number;
}

/** Auth/credential status for a workspace (values stay in the keychain / CLI config). */
export interface AccountCredentialStatus {
  claudeAuthEmail: string | null;
  githubAuthEmail: string | null;
  hasAnthropicBaseUrl: boolean;
  hasVercelToken: boolean;
  hasFigmaToken: boolean;
  hasOpenaiApiKey: boolean;
  hasGitName: boolean;
  hasGitEmail: boolean;
}

/** Credential key identifiers accepted by set/clear commands. */
export type CredentialKey =
  | 'anthropic_base_url'
  | 'vercel_token'
  | 'figma_token'
  | 'openai_api_key'
  | 'git_name'
  | 'git_email';

/** Human-readable labels for each credential key. */
export const CREDENTIAL_LABELS: Record<CredentialKey, string> = {
  anthropic_base_url: 'Anthropic Base URL',
  vercel_token: 'Vercel Token',
  figma_token: 'Figma Personal Access Token',
  openai_api_key: 'OpenAI API Key',
  git_name: 'Git Name',
  git_email: 'Git Email',
};

/** Credential keys that are sensitive (masked input). */
export const SENSITIVE_KEYS = new Set<CredentialKey>([
  'anthropic_base_url',
  'vercel_token',
  'figma_token',
  'openai_api_key',
]);

/** Maps AccountCredentialStatus boolean field → CredentialKey. */
export const STATUS_FIELD_TO_KEY: Record<
  Exclude<keyof AccountCredentialStatus, 'claudeAuthEmail' | 'githubAuthEmail'>,
  CredentialKey
> = {
  hasAnthropicBaseUrl: 'anthropic_base_url',
  hasVercelToken: 'vercel_token',
  hasFigmaToken: 'figma_token',
  hasOpenaiApiKey: 'openai_api_key',
  hasGitName: 'git_name',
  hasGitEmail: 'git_email',
};

/** Predefined palette for workspace colors. */
export const ACCOUNT_COLORS = [
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

/**
 * Event fired on the window whenever the set of Workspaces (or the active one)
 * changes — create / update / delete / switch. `useActiveAccount` listens for
 * it so every workspace indicator (sidebar footer button, ⌘K command, etc.)
 * refreshes live instead of going stale until the next remount.
 */
export const ACCOUNTS_CHANGED_EVENT = 'shipstudio:accounts-changed';

function notifyAccountsChanged(): void {
  window.dispatchEvent(new Event(ACCOUNTS_CHANGED_EVENT));
}

export async function listAccounts(): Promise<Account[]> {
  return invoke<Account[]>('list_accounts');
}

export async function createAccount(name: string, color: string): Promise<Account> {
  const account = await invoke<Account>('create_account', { name, color });
  notifyAccountsChanged();
  return account;
}

export async function updateAccount(id: string, name: string, color: string): Promise<Account> {
  const account = await invoke<Account>('update_account', { id, name, color });
  notifyAccountsChanged();
  return account;
}

export async function deleteAccount(id: string): Promise<void> {
  await invoke('delete_account', { id });
  notifyAccountsChanged();
}

export async function getActiveAccountId(): Promise<string> {
  return invoke<string>('get_active_account_id');
}

export async function setActiveAccountId(id: string): Promise<void> {
  await invoke('set_active_account_id', { id });
  notifyAccountsChanged();
}

export async function getAccountCredentialStatus(id: string): Promise<AccountCredentialStatus> {
  return invoke<AccountCredentialStatus>('get_account_credential_status', { id });
}

export async function setAccountCredential(
  id: string,
  key: CredentialKey,
  value: string
): Promise<void> {
  return invoke('set_account_credential', { id, key, value });
}

export async function clearAccountCredential(id: string, key: CredentialKey): Promise<void> {
  return invoke('clear_account_credential', { id, key });
}

export async function moveProjectToAccount(projectPath: string, accountId: string): Promise<void> {
  return invoke('move_project_to_account', { projectPath, accountId });
}

export async function getProjectAccountId(projectPath: string): Promise<string> {
  return invoke<string>('get_project_account_id', { projectPath });
}

/**
 * Env vars (CLAUDE_CONFIG_DIR, GH_CONFIG_DIR, CODEX_HOME, XDG_DATA_HOME,
 * credential tokens) for a specific workspace. Used to spawn a project's PTY
 * with that project's workspace, rather than the globally active one.
 */
export async function getAccountEnvVars(id: string): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('get_account_env_vars', { accountId: id });
}
