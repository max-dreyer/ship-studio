/**
 * Recursive file tree component for the code browser.
 *
 * Renders a tree of directories and files with expand/collapse,
 * selection highlighting, and sorted display (directories first).
 */

import type { FileTreeNode } from '../../lib/code';
import { ChevronRightIcon, FolderIcon } from '../icons';
import { FileKindIcon } from '../icons/fileKinds';
import { fileKind } from '../../lib/fileIcons';

interface FileTreeProps {
  nodes: FileTreeNode[];
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
  level?: number;
}

export function FileTree({
  nodes,
  expandedPaths,
  selectedFilePath,
  onToggleDirectory,
  onSelectFile,
  level = 0,
}: FileTreeProps) {
  return (
    <div className="file-tree-nodes" role={level === 0 ? 'tree' : 'group'}>
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          expandedPaths={expandedPaths}
          selectedFilePath={selectedFilePath}
          onToggleDirectory={onToggleDirectory}
          onSelectFile={onSelectFile}
          level={level}
        />
      ))}
    </div>
  );
}

interface FileTreeItemProps {
  node: FileTreeNode;
  expandedPaths: Set<string>;
  selectedFilePath: string | null;
  onToggleDirectory: (path: string) => void;
  onSelectFile: (path: string) => void;
  level: number;
}

function FileTreeItem({
  node,
  expandedPaths,
  selectedFilePath,
  onToggleDirectory,
  onSelectFile,
  level,
}: FileTreeItemProps) {
  const isExpanded = expandedPaths.has(node.path);
  const isSelected = node.path === selectedFilePath;

  const handleClick = () => {
    if (node.isDirectory) {
      onToggleDirectory(node.path);
    } else {
      onSelectFile(node.path);
    }
  };

  return (
    <>
      <button
        className={`file-tree-item ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: `${12 + level * 16}px` }}
        onClick={handleClick}
        title={node.path}
        role="treeitem"
        aria-expanded={node.isDirectory ? isExpanded : undefined}
        aria-selected={isSelected}
      >
        {node.isDirectory && (
          <span className={`file-tree-chevron ${isExpanded ? 'expanded' : ''}`}>
            <ChevronRightIcon size={12} />
          </span>
        )}
        {/* Tinted by file type, the way VS Code makes a long list scannable.
            The hue lives in CSS (`--fi-*`), keyed off this class. */}
        <span
          className={`file-tree-icon${
            node.isDirectory ? '' : ` file-tree-icon--${fileKind(node.name)}`
          }`}
        >
          {node.isDirectory ? (
            <FolderIcon size={14} />
          ) : (
            <FileKindIcon kind={fileKind(node.name)} />
          )}
        </span>
        <span className="file-tree-name">{node.name}</span>
      </button>
      {node.isDirectory && isExpanded && node.children.length > 0 && (
        <FileTree
          nodes={node.children}
          expandedPaths={expandedPaths}
          selectedFilePath={selectedFilePath}
          onToggleDirectory={onToggleDirectory}
          onSelectFile={onSelectFile}
          level={level + 1}
        />
      )}
    </>
  );
}
