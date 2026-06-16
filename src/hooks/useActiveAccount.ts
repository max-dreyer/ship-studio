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
  type Account,
} from '../lib/accounts';

export function useActiveAccount(projectPath?: string | null) {
  const [activeAccount, setActiveAccount] = useState<Account | null>(null);

  const refresh = useCallback(async () => {
    try {
      const accounts = await listAccounts();
      // Prefer the open project's workspace; fall back to the active account.
      let accountId: string | null = null;
      if (projectPath) {
        accountId = await getProjectAccountId(projectPath).catch(() => null);
      }
      if (!accountId) {
        accountId = await getActiveAccountId();
      }
      setActiveAccount(accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null);
    } catch {
      setActiveAccount(null);
    }
  }, [projectPath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: fetch the workspace on mount / when projectPath changes
    void refresh();
  }, [refresh]);

  return { activeAccount, refresh };
}
