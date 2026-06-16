/**
 * Hook for reading the Workspace (Account) to display in the UI.
 *
 * When a `projectPath` is given, it resolves the workspace that project is
 * tagged with (`account_id` in `.shipstudio/project.json`) so the indicator
 * follows the open project as you switch between projects in the sidebar.
 * Without a path (e.g. on Home), it falls back to the globally active account.
 *
 * @module hooks/useActiveAccount
 */

import { useCallback, useEffect, useState } from 'react';
import {
  listAccounts,
  getActiveAccountId,
  getProjectAccountId,
  ACCOUNTS_CHANGED_EVENT,
  type Account,
} from '../lib/accounts';

export function useActiveAccount(projectPath?: string | null) {
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);

  const refresh = useCallback(async () => {
    try {
      const all = await listAccounts();
      setAccounts(all);
      // Prefer the open project's workspace; fall back to the active account.
      let accountId: string | null = null;
      if (projectPath) {
        accountId = await getProjectAccountId(projectPath).catch(() => null);
      }
      if (!accountId) {
        accountId = await getActiveAccountId();
      }
      setActiveAccount(all.find((a) => a.id === accountId) ?? all[0] ?? null);
    } catch {
      setActiveAccount(null);
      setAccounts([]);
    }
  }, [projectPath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetch the workspace on mount / when projectPath changes
    void refresh();
    // Re-fetch whenever a workspace is created/renamed/deleted/switched so the
    // indicator never goes stale (e.g. the footer switcher appearing the moment
    // a second workspace exists).
    const onAccountsChanged = () => void refresh();
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, onAccountsChanged);
    return () => window.removeEventListener(ACCOUNTS_CHANGED_EVENT, onAccountsChanged);
  }, [refresh]);

  return { activeAccount, accounts, refresh };
}
