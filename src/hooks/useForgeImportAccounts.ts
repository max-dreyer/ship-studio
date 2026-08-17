/**
 * useForgeImportAccounts — the "who can I import as" half of the import wizard.
 *
 * Owns two states that belong together: the namespaces the signed-in user can
 * import from, and the reason there are none yet (the forge's CLI isn't
 * installed, or it is but nobody is signed in). Keeping them in one hook is what
 * lets the wizard show the fixable setup step instead of an error nobody can act
 * on, and it keeps ImportProject about the import itself.
 *
 * @module hooks/useForgeImportAccounts
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { trackError } from '../lib/analytics';
import { describeAccountsLoadError, friendlyProcessError } from '../lib/errors';
import { getForgeById } from '../lib/forge';
import {
  checkForgeCliStatus,
  listForgeOwners,
  type ForgeCliStatus,
  type ForgeOwners,
} from '../lib/forgeImport';
import { installPackages } from '../lib/setup';
import { usePolling } from './usePolling';

export interface UseForgeImportAccountsResult {
  /** The signed-in user's account name, or null before it's known. */
  username: string | null;
  /** Organizations (GitHub) or groups (GitLab). */
  groups: string[];
  /** The instance the CLI is signed in to, when knowable. */
  host: string | null;
  /** True while the account lookup is running. */
  loading: boolean;
  /** A real failure to report, as opposed to a setup step. */
  error: string | null;
  /**
   * Set only while the CLI isn't usable (missing, or signed out); null once it
   * is. Non-null means the wizard should show the setup step.
   */
  cliStatus: ForgeCliStatus | null;
  /** True while the CLI install is running. */
  installingCli: boolean;
  /** An install failure, or null. */
  setupError: string | null;
  /** Install the CLI with the machine's package manager, then re-check. */
  installCli: () => Promise<void>;
}

/**
 * @param forgeId - Which forge to read accounts from.
 * @param onOwnersLoaded - Called each time the accounts load, so the caller can
 *   preselect the personal namespace. Held in a ref, so it doesn't have to be
 *   memoized by the caller.
 */
export function useForgeImportAccounts(
  forgeId: string,
  onOwnersLoaded: (owners: ForgeOwners) => void
): UseForgeImportAccountsResult {
  const forge = getForgeById(forgeId);
  const [username, setUsername] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [host, setHost] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cliStatus, setCliStatus] = useState<ForgeCliStatus | null>(null);
  const [installingCli, setInstallingCli] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const onOwnersLoadedRef = useRef(onOwnersLoaded);
  onOwnersLoadedRef.current = onOwnersLoaded;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const owners = await listForgeOwners(forgeId);
      setCliStatus(null);
      setError(null);
      setUsername(owners.username);
      setGroups(owners.groups);
      setHost(owners.host);
      onOwnersLoadedRef.current(owners);
    } catch (err) {
      // A missing CLI or a missing login is a setup step, not a failure to
      // report — find out which before showing an error the user can't act on.
      // Only asked for on the failure path, so the happy path stays one call.
      const status = await checkForgeCliStatus(forgeId).catch(() => null);
      if (status && (!status.installed || !status.authenticated)) {
        setCliStatus(status);
        setError(null);
        return;
      }
      trackError('forge_accounts_load', err, 'Dashboard');
      setError(describeAccountsLoadError(err, forge.displayName));
    } finally {
      setLoading(false);
    }
  }, [forgeId, forge.displayName]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-check after an install or a sign-in, loading the accounts once ready. */
  const recheck = useCallback(async () => {
    const status = await checkForgeCliStatus(forgeId);
    if (status.installed && status.authenticated) {
      await load();
    } else {
      setCliStatus(status);
    }
  }, [forgeId, load]);

  // While the setup step shows, keep checking: the sign-in runs in a separate
  // terminal, so nothing else would tell us it finished.
  usePolling(recheck, {
    intervalMs: 3000,
    enabled: cliStatus !== null && !installingCli,
    name: 'forgeCliReadiness',
  });

  const installCli = useCallback(async () => {
    if (!cliStatus) return;
    setInstallingCli(true);
    setSetupError(null);
    try {
      await installPackages([cliStatus.binary]);
      await recheck();
    } catch (err) {
      trackError('forge_cli_install', err, 'Dashboard');
      setSetupError(friendlyProcessError(err));
    } finally {
      setInstallingCli(false);
    }
  }, [cliStatus, recheck]);

  return {
    username,
    groups,
    host,
    loading,
    error,
    cliStatus,
    installingCli,
    setupError,
    installCli,
  };
}
