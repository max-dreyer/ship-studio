/**
 * ProjectCard component that displays a single project in the dashboard grid.
 *
 * Shows project thumbnail (or placeholder), name, git branch, uncommitted changes
 * count, and deployment status. Provides hover actions for opening the live site
 * or launching in an IDE.
 *
 * @module components/ProjectCard
 */

import { memo, useCallback } from 'react';
import { DashboardProject } from '../lib/project';
import { BranchIcon, CodeIcon, NewWindowIcon } from './icons';
import { ProjectCardMenu } from './ProjectCardMenu';

/** Props for the ProjectCard component */
type MaybeAsync<T extends unknown[]> = (...args: T) => void | Promise<void>;

interface ProjectCardProps {
  /** Project data including name, path, git info, and deployment URLs */
  project: DashboardProject;
  /** Base64-encoded thumbnail image (or null for placeholder) */
  thumbnailData: string | null;
  /** Callback when the card is clicked to open the project */
  onSelect: MaybeAsync<[project: DashboardProject]>;
  /** Callback when delete button is clicked */
  onDelete: MaybeAsync<[project: DashboardProject]>;
  /** Callback when main branch warning is toggled */
  onToggleMainBranchWarning: MaybeAsync<[projectPath: string, hidden: boolean]>;
  /** Callback to open the project in VS Code or Cursor */
  onOpenIde?: () => void;
  /** Callback to move project to a folder */
  onMoveToFolder: MaybeAsync<[project: DashboardProject]>;
  /** Callback to export project as a template zip */
  onExportAsTemplate: MaybeAsync<[projectPath: string]>;
  /** Callback to open project in a new window */
  onOpenInNewWindow: MaybeAsync<[project: DashboardProject]>;
  /** Whether this is an external project */
  isExternal?: boolean;
  /** Callback when remove from list is clicked (for external projects) */
  onRemove?: MaybeAsync<[project: DashboardProject]>;
}

export const ProjectCard = memo(function ProjectCard({
  project,
  thumbnailData,
  onSelect,
  onDelete,
  onToggleMainBranchWarning,
  onOpenIde,
  onMoveToFolder,
  onExportAsTemplate,
  onOpenInNewWindow,
  isExternal,
  onRemove,
}: ProjectCardProps) {
  const hasChanges = project.uncommitted_count !== null && project.uncommitted_count > 0;
  const hideMainBranchWarning = project.hide_main_branch_warning === true;

  const handleSelect = useCallback(() => {
    void onSelect(project);
  }, [onSelect, project]);
  const handleDelete = useCallback(() => {
    void onDelete(project);
  }, [onDelete, project]);
  const handleToggleWarning = useCallback(
    (hidden: boolean) => {
      void onToggleMainBranchWarning(project.path, hidden);
    },
    [onToggleMainBranchWarning, project.path]
  );
  const handleMoveToFolder = useCallback(() => {
    void onMoveToFolder(project);
  }, [onMoveToFolder, project]);
  const handleExport = useCallback(() => {
    void onExportAsTemplate(project.path);
  }, [onExportAsTemplate, project.path]);
  const handleNewWindow = useCallback(() => {
    void onOpenInNewWindow(project);
  }, [onOpenInNewWindow, project]);
  const handleRemove = useCallback(() => {
    void onRemove?.(project);
  }, [onRemove, project]);

  return (
    <div className="project-card">
      <div
        className="project-card-thumbnail"
        onClick={handleSelect}
        role="button"
        tabIndex={0}
        aria-label={`Open ${project.name}`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleSelect();
          }
        }}
      >
        {thumbnailData ? (
          <img src={thumbnailData} alt={project.name} />
        ) : (
          <div className="project-card-placeholder">
            <span>No preview</span>
          </div>
        )}
        {/* Hover actions overlay */}
        <div className="project-card-overlay">
          <div className="project-card-quick-actions">
            <button
              className="quick-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                handleNewWindow();
              }}
              title="Open in new window"
              aria-label="Open in new window"
            >
              <NewWindowIcon size={16} />
            </button>
            {onOpenIde && (
              <button
                className="quick-action-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenIde();
                }}
                title="Open in IDE"
              >
                <CodeIcon size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="project-card-info">
        <div className="project-card-details" onClick={handleSelect} style={{ cursor: 'pointer' }}>
          <div className="project-card-name-row">
            <span className="project-card-name">{project.name}</span>
          </div>
          <div className="project-card-meta">
            {project.git_branch && (
              <span className="project-card-branch">
                <BranchIcon />
                <span className="project-card-branch-name">{project.git_branch}</span>
              </span>
            )}
            {hasChanges && (
              <span className="project-card-changes">{project.uncommitted_count} uncommitted</span>
            )}
          </div>
        </div>
        <ProjectCardMenu
          hideMainBranchWarning={hideMainBranchWarning}
          onToggleMainBranchWarning={handleToggleWarning}
          onMoveToFolder={handleMoveToFolder}
          onExportAsTemplate={handleExport}
          onDelete={handleDelete}
          isExternal={isExternal}
          onRemove={isExternal ? handleRemove : undefined}
        />
      </div>
    </div>
  );
});
