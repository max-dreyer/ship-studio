/**
 * Step2RepoSelection — second wizard step for ImportProject. Shows a searchable
 * list of repositories from the selected namespace, on any forge.
 *
 * @module components/import-project/steps/Step2RepoSelection
 */

import { Button } from '../../primitives/Button';
import { Spinner } from '../../primitives/Spinner';
import type { ForgeInfo } from '../../../lib/forge';
import {
  repositoryPlural,
  visibilityLabel,
  type ForgeOwnerSelection,
  type ForgeRepo,
} from '../../../lib/forgeImport';

export interface Step2RepoSelectionProps {
  /** The forge being imported from; supplies its terminology. */
  forge: ForgeInfo;
  selectedOwner: ForgeOwnerSelection | null;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  loadingRepos: boolean;
  filteredRepos: ForgeRepo[];
  selectedRepo: ForgeRepo | null;
  onRepoSelect: (repo: ForgeRepo) => void;
  error: string | null;
  onBack: () => void;
  onImport: () => void;
  onCancel: () => void;
}

export function Step2RepoSelection({
  forge,
  selectedOwner,
  searchQuery,
  onSearchChange,
  loadingRepos,
  filteredRepos,
  selectedRepo,
  onRepoSelect,
  error,
  onBack,
  onImport,
  onCancel,
}: Step2RepoSelectionProps) {
  const isShared = selectedOwner?.kind === 'shared';
  const plural = repositoryPlural(forge).toLowerCase();

  return (
    <div className="create-modal-content import-repo-step">
      <div className="create-modal-header">
        <div>
          <h2>Import Project</h2>
          <p className="template-context">
            {isShared ? (
              <>Shared with you</>
            ) : (
              <>
                From <strong>{selectedOwner?.name}</strong>
              </>
            )}
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

      <div className="import-search">
        <input
          type="text"
          placeholder={`Search ${plural}...`}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          autoFocus
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>

      <div className="import-repo-list">
        {loadingRepos ? (
          <div className="import-repo-loading">
            <Spinner style={{ color: 'var(--text-primary)' }} />
            <span>Loading {plural}...</span>
          </div>
        ) : filteredRepos.length === 0 ? (
          <div className="import-repo-empty">
            {searchQuery ? (
              <p>
                No {plural} found matching "{searchQuery}"
              </p>
            ) : (
              <p>No {plural} found</p>
            )}
          </div>
        ) : (
          filteredRepos.map((repo) => {
            const visibility = visibilityLabel(repo);
            return (
              <button
                key={repo.fullPath}
                className={`import-repo-item ${
                  selectedRepo?.fullPath === repo.fullPath ? 'selected' : ''
                }`}
                onClick={() => onRepoSelect(repo)}
              >
                <div className="import-repo-header">
                  {/* Own namespaces don't need repeating on every row; a shared
                      list is only readable with the owner's name attached. */}
                  <span className="import-repo-name">{isShared ? repo.fullPath : repo.name}</span>
                  {visibility && <span className="import-repo-badge private">{visibility}</span>}
                  {repo.primaryLanguage && (
                    <span className="import-repo-badge lang">{repo.primaryLanguage.name}</span>
                  )}
                </div>
                {repo.description && <p className="import-repo-description">{repo.description}</p>}
              </button>
            );
          })
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="create-actions">
        <Button variant="secondary" type="button" onClick={onBack}>
          Back
        </Button>
        {/* "Project" here is Ship Studio's own word for what gets created
            locally, so it stays the same on every forge. */}
        <Button variant="primary" type="button" disabled={!selectedRepo} onClick={onImport}>
          Import Project
        </Button>
      </div>
    </div>
  );
}
