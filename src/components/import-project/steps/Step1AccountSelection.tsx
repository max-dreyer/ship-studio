/**
 * Step1AccountSelection — first wizard step for ImportProject. Lists the
 * namespaces the user can import from on the selected forge: their own account,
 * their organizations (GitHub) or groups (GitLab), and repositories somebody
 * else owns that they have access to.
 *
 * @module components/import-project/steps/Step1AccountSelection
 */

import type { ForgeInfo } from '../../../lib/forge';
import { sharedOwnerCopy, type ForgeOwnerSelection } from '../../../lib/forgeImport';

export interface Step1AccountSelectionProps {
  /** The forge being imported from; supplies its brand name and terminology. */
  forge: ForgeInfo;
  username: string | null;
  /** Organizations (GitHub) or groups (GitLab), by full path. */
  groups: string[];
  /** The instance the CLI is signed in to, when known. */
  host: string | null;
  selectedOwner: ForgeOwnerSelection | null;
  error: string | null;
  onOwnerSelect: (owner: ForgeOwnerSelection) => void;
  onCancel: () => void;
}

/** Initial for the avatar tile: the last path segment, so "acme/web" reads "W". */
function ownerInitial(path: string): string {
  const segment = path.split('/').filter(Boolean).pop() ?? path;
  return (segment[0] ?? '?').toUpperCase();
}

export function Step1AccountSelection({
  forge,
  username,
  groups,
  host,
  selectedOwner,
  error,
  onOwnerSelect,
  onCancel,
}: Step1AccountSelectionProps) {
  const shared = sharedOwnerCopy(forge);

  return (
    <div className="create-modal-content">
      <div className="create-modal-header">
        <div>
          <h2>Import Project</h2>
          <p>
            Select a {forge.displayName} account
            {/* Only shown when the CLI can tell us — a self-hosted GitLab is the
                normal case, and the user needs to see which instance this is. */}
            {host && <span className="import-owner-host"> · {host}</span>}
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

      <div className="import-owner-list">
        {username && (
          <button
            className={`import-owner-btn ${selectedOwner?.kind === 'user' ? 'selected' : ''}`}
            onClick={() => onOwnerSelect({ kind: 'user', name: username })}
          >
            <div className="import-owner-avatar">{ownerInitial(username)}</div>
            <div className="import-owner-info">
              <span className="import-owner-name">{username}</span>
              <span className="import-owner-type">Personal</span>
            </div>
          </button>
        )}
        {groups.map((group) => (
          <button
            key={group}
            className={`import-owner-btn ${
              selectedOwner?.kind === 'group' && selectedOwner.name === group ? 'selected' : ''
            }`}
            onClick={() => onOwnerSelect({ kind: 'group', name: group })}
          >
            <div className="import-owner-avatar org">{ownerInitial(group)}</div>
            <div className="import-owner-info">
              <span className="import-owner-name">{group}</span>
              <span className="import-owner-type">{forge.organizationTerm}</span>
            </div>
          </button>
        ))}
        {/* Repositories owned by others that the user has access to. */}
        <button
          className={`import-owner-btn ${selectedOwner?.kind === 'shared' ? 'selected' : ''}`}
          onClick={() => onOwnerSelect({ kind: 'shared', name: '' })}
        >
          <div className="import-owner-avatar collab">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div className="import-owner-info">
            <span className="import-owner-name">{shared.title}</span>
            <span className="import-owner-type">{shared.subtitle}</span>
          </div>
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="create-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
