/**
 * The row of open files above the viewer.
 *
 * Opening a file from the tree adds a tab; the tree stays the place you find
 * things, and the tabs become the place you keep them. Switching goes through
 * the same `selectFile` as the tree, so the unsaved-changes confirmation
 * applies here too — a tab click can't quietly drop a buffer.
 *
 * A dirty tab shows a dot instead of its close button until you hover it, the
 * convention every editor uses, because the close button is exactly where the
 * dot would be and losing work to a mis-click is the failure that matters.
 *
 * @module components/code/OpenFileTabs
 */

import { fileKind } from '../../lib/fileIcons';
import { FileKindIcon } from '../icons/fileKinds';

interface Props {
  /** Open files, in the order they were opened. */
  paths: string[];
  activePath: string | null;
  /** True when the active file has unsaved edits. */
  activeDirty: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

export function OpenFileTabs({ paths, activePath, activeDirty, onSelect, onClose }: Props) {
  if (paths.length === 0) return null;

  return (
    <div className="code-tabs" role="tablist" aria-label="Open files">
      {paths.map((path) => {
        const isActive = path === activePath;
        const dirty = isActive && activeDirty;
        const name = basename(path);
        return (
          <div
            key={path}
            className={`code-tabs__tab${isActive ? ' is-active' : ''}${dirty ? ' is-dirty' : ''}`}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              className="code-tabs__label"
              onClick={() => onSelect(path)}
              // The full path: basenames repeat constantly in a real tree.
              title={path}
            >
              <span className={`code-tabs__icon file-tree-icon--${fileKind(name)}`}>
                <FileKindIcon kind={fileKind(name)} size={13} />
              </span>
              <span className="code-tabs__name">{name}</span>
            </button>
            <button
              type="button"
              className="code-tabs__close"
              onClick={() => onClose(path)}
              aria-label={dirty ? `Close ${name} (unsaved changes)` : `Close ${name}`}
            >
              {/* The dot gives way to the × on hover — see code-mode.css. */}
              <span className="code-tabs__dot" aria-hidden />
              <span className="code-tabs__x" aria-hidden>
                ×
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
