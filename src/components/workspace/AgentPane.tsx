/**
 * The agent terminal's shell — the box, not the contents.
 *
 * Wraps whatever the agent pane renders (tab bar, terminals, footer) and gives
 * it the two docking states from `useAgentDock`: docked, where it fills the
 * split pane's left column, and floating, where it becomes a draggable,
 * resizable window over the workspace.
 *
 * The children are rendered identically in both states on purpose. They own
 * live xterm instances and PTYs, so re-parenting them would drop the
 * scrollback — only this wrapper's CSS box is allowed to change.
 *
 * @module components/workspace/AgentPane
 */

import type { ReactNode } from 'react';
import { PinIcon } from '../icons';
import type { useAgentDock } from '../../hooks/useAgentDock';

type Dock = ReturnType<typeof useAgentDock>;

interface Props {
  dock: Dock;
  children: ReactNode;
}

/** Toolbar button that switches the pane between docked and floating. Lives in
 *  the agent's tab bar, next to the side-by-side toggle. */
export function AgentDockToggle({ dock }: { dock: Dock }) {
  return (
    <button
      type="button"
      className={`toolbar-icon-btn agent-dock-toggle${dock.isFloating ? ' is-floating' : ''}`}
      onClick={dock.toggleMode}
      title={
        dock.isFloating
          ? 'Dock the agent back into the split view'
          : 'Float the agent over the workspace'
      }
      aria-label="Toggle floating agent panel"
      aria-pressed={dock.isFloating}
    >
      <PinIcon size={13} />
    </button>
  );
}

export function AgentPane({ dock, children }: Props) {
  return (
    <>
      {/* Rendered before the pane so the pane stays on top of it. Covers the
          preview iframe, which would otherwise swallow pointer moves
          mid-drag — the same problem `.split-pane-overlay` solves. */}
      {dock.isDragging && <div className="agent-dock-drag-shield" />}
      <div
        className={`terminal-pane${dock.isFloating ? ' terminal-pane--floating' : ''}${
          dock.isDragging ? ' terminal-pane--dragging' : ''
        }`}
        style={dock.floatStyle}
      >
        {children}
        {dock.isFloating && (
          <>
            <div
              className="agent-dock-grip agent-dock-grip--right"
              {...dock.resizeProps('right')}
            />
            <div
              className="agent-dock-grip agent-dock-grip--bottom"
              {...dock.resizeProps('bottom')}
            />
            <div
              className="agent-dock-grip agent-dock-grip--corner"
              {...dock.resizeProps('corner')}
            />
          </>
        )}
      </div>
    </>
  );
}
