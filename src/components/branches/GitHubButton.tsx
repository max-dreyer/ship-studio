/**
 * GitHubButton component for GitHub repository management.
 *
 * Provides a dropdown button that allows users to:
 * - Create a new GitHub repository for the project
 * - Push changes to an existing repository
 * - View repository status (remote URL, pending changes)
 * - Auto-connect to Vercel after repo creation
 *
 * Uses the GitHub CLI (gh) for all operations via Tauri backend.
 *
 * @module components/GitHubButton
 */

import { useState, useEffect, useRef } from 'react';
import { GitHubState } from '../../hooks/useIntegrationStatus';
import {
  ProjectGitHubStatus,
  pushToGitHub,
  getGitHubOrgs,
  getGitHubUsername,
} from '../../lib/github';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Button } from '../primitives/Button';
import { ModalFrame } from '../primitives/ModalFrame';
import { useOptionalToast } from '../../contexts/ToastContext';
import { humanizeGitError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import {
  ALL_FORGES,
  getForgeById,
  getDefaultForge,
  moveProjectToForge,
  mirrorProjectToForge,
} from '../../lib/forge';
import { useProjectForge } from '../../hooks/useProjectForge';
// This file carries its own local GitHubIcon (below); ForgeIcon comes from the
// shared barrel because it has to dispatch on the project's forge.
import { ForgeIcon, ChevronIcon } from '../icons';

/** Props for the GitHubButton component */
interface GitHubButtonProps {
  /** Global GitHub authentication state */
  githubState: GitHubState;
  /** Current project's GitHub status (remote, branch, pending changes) */
  projectStatus: ProjectGitHubStatus | null;
  /** Absolute path to the project directory */
  projectPath: string;
  /** Project name (used as default repo name) */
  projectName: string;
  /** Callback to refresh project status after changes */
  onStatusChange: () => Promise<void> | void;
  /** Callback to initiate GitHub CLI authentication */
  onGitHubConnect: () => void;
  /** Optional callback when modal is closed */
  onModalClose?: () => void;
}

export function GitHubButton({
  githubState,
  projectStatus,
  projectPath,
  projectName,
  onStatusChange,
  onGitHubConnect,
  onModalClose,
}: GitHubButtonProps) {
  const { showToast } = useOptionalToast();
  const onToast = (message: string, type?: 'success' | 'error') => showToast(message, type);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [repoName, setRepoName] = useState(projectName);
  // Which forge to create on. Chosen, not detected: the project has no remote
  // yet, which is exactly what this flow is here to fix.
  const [targetForgeId, setTargetForgeId] = useState('github');
  // Which job the shared modal is doing: create a repo for a project that has
  // none, move an existing one, or mirror it alongside the current remote.
  const [transferMode, setTransferMode] = useState<'create' | 'move' | 'mirror'>('create');
  const [showTransferMenu, setShowTransferMenu] = useState(false);
  const targetForge = getForgeById(targetForgeId);
  // For a project that already has a remote, the link below must carry that
  // forge's mark and name — a GitLab project used to show a GitHub icon.
  const projectForge = useProjectForge(projectPath);
  const [isPrivate, setIsPrivate] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingRepo, setIsCreatingRepo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<string[]>([]);
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);
  // GitHub login for *this project's* workspace, which can differ from the
  // globally-active workspace login carried by `githubState.username`. The
  // repo is created under the project's workspace (push_to_github is
  // project-scoped), so the owner we show must come from the same place — else
  // the dropdown defaults to the active workspace's account (the wrong-owner bug).
  const [projectUsername, setProjectUsername] = useState<string | null>(null);
  const createRepoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { cliStatus, username: activeUsername } = githubState;
  // Prefer the project-scoped login; fall back to the active one until it loads.
  const username = projectUsername ?? activeUsername;

  const closeCreateModal = () => {
    setShowCreateModal(false);
    onModalClose?.();
  };

  // Clear fallback timeout on unmount
  useEffect(() => {
    return () => {
      if (createRepoTimeoutRef.current) {
        clearTimeout(createRepoTimeoutRef.current);
      }
    };
  }, []);

  // Fetch the owner (this project's workspace login) and its orgs when the
  // modal opens. Both are scoped to `projectPath` so they match the account the
  // repo will be created under, not whichever workspace is globally active.
  useEffect(() => {
    if (!showCreateModal || !cliStatus.authenticated) return;
    let cancelled = false;
    void getGitHubUsername(projectPath)
      .then((name) => {
        if (cancelled) return;
        setProjectUsername(name);
        // Default the dropdown to the project's account unless the user already
        // picked an owner this session.
        setSelectedOwner((prev) => prev ?? name);
      })
      .catch(() => {
        /* fall back to the active-workspace username already in state */
      });
    void getGitHubOrgs(projectPath)
      .then((list) => {
        if (!cancelled) setOrgs(list);
      })
      .catch(() => {
        if (!cancelled) setOrgs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [showCreateModal, cliStatus.authenticated, projectPath]);

  // Preselect the user's default forge whenever the modal opens to create a
  // repo. Not for a move or mirror: there the target is what they just picked.
  useEffect(() => {
    if (!showCreateModal || transferMode !== 'create') return;
    let cancelled = false;
    void getDefaultForge().then((forge) => {
      if (!cancelled) setTargetForgeId(forge.id);
    });
    return () => {
      cancelled = true;
    };
  }, [showCreateModal, transferMode]);

  // Clear isCreatingRepo when status becomes connected
  // This synchronizes local loading state with external status - a valid pattern
  useEffect(() => {
    if (projectStatus?.status === 'connected') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsCreatingRepo(false);
    }
  }, [projectStatus?.status]);

  const modalTitle =
    transferMode === 'move'
      ? `Move to ${targetForge.displayName}`
      : transferMode === 'mirror'
        ? `Mirror to ${targetForge.displayName}`
        : `Create ${targetForge.displayName} Repository`;

  const modalDescription =
    transferMode === 'move'
      ? `Creates the project on ${targetForge.displayName}, points origin at it and pushes every branch and tag. The repository on ${projectForge.displayName} is left where it is — nothing is deleted.`
      : transferMode === 'mirror'
        ? `Creates the project on ${targetForge.displayName} and adds it as a second remote. Origin stays on ${projectForge.displayName}, so pull requests keep running there.`
        : `Create a new ${targetForge.displayName} repository for this project.`;

  const modalSubmitLabel =
    transferMode === 'move' ? 'Move' : transferMode === 'mirror' ? 'Mirror' : 'Create Repository';
  const modalBusyLabel =
    transferMode === 'move'
      ? 'Moving...'
      : transferMode === 'mirror'
        ? 'Mirroring...'
        : 'Creating...';

  const repoModal = (
    <ModalFrame
      isOpen={showCreateModal}
      onClose={closeCreateModal}
      title={modalTitle}
      className="github-modal"
      dismissable={!isLoading}
    >
      <p>{modalDescription}</p>

      <div className="github-form">
        {transferMode === 'create' && (
          <label>
            Host
            <select
              className="owner-select"
              value={targetForgeId}
              onChange={(e) => setTargetForgeId(e.target.value)}
            >
              {ALL_FORGES.filter((f) => f.hasCli).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.displayName}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Owner picking is GitHub-only for now: the list comes from `gh`'s
              org API. On GitLab the project lands in the signed-in user's own
              namespace, which is what `glab repo create` does without a group. */}
        {targetForgeId === 'github' && (
          <label>
            Owner
            <select
              className="owner-select"
              value={selectedOwner || username || ''}
              onChange={(e) => setSelectedOwner(e.target.value)}
            >
              {username && <option value={username}>{username}</option>}
              {orgs.map((org) => (
                <option key={org} value={org}>
                  {org}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          Repository name
          <div className="repo-name-input">
            {targetForgeId === 'github' && (
              <span className="repo-prefix">{selectedOwner || username}/</span>
            )}
            <input
              type="text"
              value={repoName}
              onChange={(e) => setRepoName(e.target.value.replace(/[^a-zA-Z0-9-_]/g, '-'))}
              placeholder="my-project"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        </label>

        <label className="visibility-option">
          <input
            type="radio"
            name="visibility"
            checked={isPrivate}
            onChange={() => setIsPrivate(true)}
          />
          <div>
            <strong>Private</strong>
            <span>Only you can see this repository</span>
          </div>
        </label>

        <label className="visibility-option">
          <input
            type="radio"
            name="visibility"
            checked={!isPrivate}
            onChange={() => setIsPrivate(false)}
          />
          <div>
            <strong>Public</strong>
            <span>Anyone can see this repository</span>
          </div>
        </label>

        {error && <p className="github-error">{error}</p>}
      </div>

      <div className="modal-actions">
        <Button variant="secondary" onClick={closeCreateModal} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            if (!repoName.trim()) return;

            const handleCreate = async () => {
              setIsLoading(true);
              setIsCreatingRepo(true);
              setError(null);
              try {
                // GitHub takes "owner/name"; glab takes a bare name and
                // uses the signed-in user's namespace. Sending "owner/name"
                // to glab would create a project literally called that.
                const owner = selectedOwner || username;
                const fullRepoName = targetForgeId === 'github' ? `${owner}/${repoName}` : repoName;
                const transferOptions = {
                  projectPath,
                  forgeId: targetForgeId,
                  repoName: fullRepoName,
                  isPrivate,
                  remoteName: targetForgeId,
                };

                let doneMessage = 'Repository created!';
                if (transferMode === 'move') {
                  const result = await moveProjectToForge(transferOptions);
                  doneMessage = `Moved to ${targetForge.displayName}`;
                  // The old remote is the only way back and nothing else
                  // records it, so put it where the user can still read it.
                  if (result.previousOriginUrl) {
                    logger.info('Project moved to another forge', {
                      previousOrigin: result.previousOriginUrl,
                      newOrigin: result.url,
                    });
                  }
                } else if (transferMode === 'mirror') {
                  const result = await mirrorProjectToForge(transferOptions);
                  doneMessage = `Mirrored to ${targetForge.displayName} as '${result.remoteName}'`;
                } else {
                  await pushToGitHub({
                    projectPath,
                    repoName: fullRepoName,
                    isPrivate,
                    forgeId: targetForgeId,
                  });
                }

                // Close modal immediately after the repo exists
                setShowCreateModal(false);
                setIsLoading(false);
                onModalClose?.();

                // Refresh status - this will clear isCreatingRepo when status updates
                await onStatusChange();
                onToast?.(doneMessage, 'success');

                // Fallback: clear isCreatingRepo after a delay if status doesn't update
                createRepoTimeoutRef.current = setTimeout(() => {
                  setIsCreatingRepo(false);
                }, 3000);
              } catch (e) {
                // Include the humanized cause in the toast: a static string
                // collapses every failure mode (auth, name collision,
                // network…) into one undiagnosable telemetry fingerprint
                // (issue #511).
                const detail = humanizeGitError(e);
                setError(detail);
                const verb =
                  transferMode === 'move'
                    ? 'move the project'
                    : transferMode === 'mirror'
                      ? 'mirror the project'
                      : 'create repository';
                onToast?.(`Failed to ${verb}: ${detail}`, 'error');
                setIsLoading(false);
                setIsCreatingRepo(false);
              }
            };

            void handleCreate();
          }}
          disabled={isLoading || !repoName.trim()}
        >
          {isLoading ? modalBusyLabel : modalSubmitLabel}
        </Button>
      </div>
    </ModalFrame>
  );

  // If gh CLI not installed, show install prompt
  if (!cliStatus.installed) {
    return (
      <button
        className="github-button github-install"
        onClick={() => void openUrl('https://cli.github.com/')}
        title="Install GitHub CLI"
      >
        <GitHubIcon />
        Install CLI
      </button>
    );
  }

  // If not authenticated, show connect button
  if (!cliStatus.authenticated) {
    return (
      <button
        className="github-button github-connect"
        onClick={onGitHubConnect}
        title="Connect your GitHub account"
      >
        <GitHubIcon />
        Connect
      </button>
    );
  }

  // If the project has a repo on its forge, show a link to it plus the ways to
  // put it on another one.
  if (projectStatus?.status === 'connected' && projectStatus?.github_url) {
    // Only forges we can actually drive, and never the one it's already on.
    const otherForges = ALL_FORGES.filter((f) => f.hasCli && f.id !== projectForge.id);

    const startTransfer = (mode: 'move' | 'mirror', forgeId: string) => {
      setTransferMode(mode);
      setTargetForgeId(forgeId);
      setRepoName(projectName);
      setSelectedOwner(null);
      setError(null);
      setShowTransferMenu(false);
      setShowCreateModal(true);
    };

    return (
      <>
        <div className="github-link-group">
          <button
            className="github-button github-link"
            onClick={() => void openUrl(projectStatus.github_url!)}
            title={`Open on ${projectForge.displayName}`}
          >
            <ForgeIcon forgeId={projectForge.id} />
          </button>

          {otherForges.length > 0 && (
            <button
              className="github-button github-link github-link-more"
              onClick={() => setShowTransferMenu((open) => !open)}
              aria-expanded={showTransferMenu}
              aria-haspopup="menu"
              title="Put this project on another host"
            >
              <ChevronIcon size={12} />
            </button>
          )}

          {showTransferMenu && (
            <>
              {/* Click-away layer: the menu is small enough that a focus trap
                  would be heavier than the problem it solves. */}
              <div
                className="github-transfer-backdrop"
                onClick={() => setShowTransferMenu(false)}
              />
              <div className="github-transfer-menu" role="menu">
                {otherForges.map((f) => (
                  <div key={f.id} className="github-transfer-group">
                    <button role="menuitem" onClick={() => startTransfer('move', f.id)}>
                      Move to {f.displayName}
                    </button>
                    <button role="menuitem" onClick={() => startTransfer('mirror', f.id)}>
                      Also push to {f.displayName}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        {repoModal}
      </>
    );
  }

  // Show loading state while creating repo (even after modal closes)
  if (isCreatingRepo) {
    return (
      <button className="github-button github-creating" disabled title="Setting up...">
        <GitHubIcon />
        Setting up...
      </button>
    );
  }

  // Still checking GitHub status - show loading state
  if (projectStatus === null) {
    return (
      <button className="github-button github-checking" disabled title="Checking GitHub status...">
        <GitHubIcon />
        Checking...
      </button>
    );
  }

  // Project not connected - show Create Repo button
  return (
    <>
      <button
        className="github-button github-create"
        onClick={() => {
          setTransferMode('create');
          setRepoName(projectName);
          // Clear so the modal's effect can default the owner to this project's
          // workspace login once it resolves (see the fetch effect above).
          setSelectedOwner(null);
          setShowCreateModal(true);
          setError(null);
        }}
        title="Create GitHub repository"
      >
        <GitHubIcon />
        <span style={{ whiteSpace: 'nowrap' }}>Create Repo</span>
      </button>

      {repoModal}
    </>
  );
}

function GitHubIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
