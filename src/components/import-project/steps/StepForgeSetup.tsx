/**
 * StepForgeSetup — shown instead of the account list when the forge's CLI isn't
 * ready: not installed, or installed but not signed in.
 *
 * It exists because the GitLab import is otherwise a dead end for anyone who
 * hasn't set `glab` up yet — the first listing call would fail with CLI stderr
 * and no way forward. Both states get the action that fixes them, and the
 * wizard re-checks in the background (see ImportProject), so this screen
 * disappears on its own once the install or sign-in completes.
 *
 * @module components/import-project/steps/StepForgeSetup
 */

import { Button } from '../../primitives/Button';
import { Spinner } from '../../primitives/Spinner';
import { ForgeIcon } from '../../icons';
import type { ForgeInfo } from '../../../lib/forge';
import type { ForgeCliStatus } from '../../../lib/forgeImport';

export interface StepForgeSetupProps {
  forge: ForgeInfo;
  status: ForgeCliStatus;
  /** True while the CLI install is running. */
  installing: boolean;
  /** Install failure, or null. */
  error: string | null;
  /** Install the CLI via the machine's package manager. */
  onInstall: () => void;
  /** Open the CLI's interactive login in a terminal. */
  onConnect: () => void;
  onCancel: () => void;
}

export function StepForgeSetup({
  forge,
  status,
  installing,
  error,
  onInstall,
  onConnect,
  onCancel,
}: StepForgeSetupProps) {
  const needsInstall = !status.installed;

  return (
    <div className="create-modal-content">
      <div className="create-modal-header">
        <div>
          <h2>Connect {forge.displayName}</h2>
          <p>
            {needsInstall
              ? `Importing from ${forge.displayName} uses its command line tool, ${status.binary}.`
              : `${status.binary} is installed but not signed in yet.`}
          </p>
        </div>
        <button
          className="create-modal-close"
          onClick={onCancel}
          type="button"
          title="Close"
          aria-label="Close"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="import-forge-setup">
        <div className="import-forge-setup-icon">
          <ForgeIcon forgeId={forge.id} size={28} />
        </div>
        <p className="import-forge-setup-text">
          {needsInstall
            ? `Install ${status.binary} once and every workspace on this Mac can use it. This takes about a minute.`
            : `The sign-in runs in a terminal: ${status.binary} asks which instance to use, so a self-hosted ${forge.displayName} works too.`}
        </p>

        {installing && (
          <p className="import-forge-setup-status">
            <Spinner size="sm" />
            <span>Installing {status.binary}…</span>
          </p>
        )}

        {error && <p className="error">{error}</p>}
      </div>

      <div className="create-actions">
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        {needsInstall ? (
          <Button variant="primary" type="button" disabled={installing} onClick={onInstall}>
            Install {status.binary}
          </Button>
        ) : (
          <Button variant="primary" type="button" onClick={onConnect}>
            Sign in to {forge.displayName}
          </Button>
        )}
      </div>
    </div>
  );
}
