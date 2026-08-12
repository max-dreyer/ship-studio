/**
 * Agent panel docking — float the agent terminal over the workspace, or keep
 * it docked in the split pane.
 *
 * Mirrors the visual editor's float/pin model (`ss-edit-panel--pinned`), with
 * one hard constraint the editor doesn't have: the agent pane owns live xterm
 * instances and PTYs. Remounting it would throw away the scrollback, so the
 * pane must never move in the React tree. Both modes therefore render the same
 * node in the same place; only its CSS box changes — docked fills the split
 * pane's left column, floating is `position: fixed` with a self-owned rect.
 *
 * `position: fixed` resolves against the viewport here because no ancestor of
 * `.terminal-pane` establishes a containing block (no transform / filter /
 * contain). `.terminal-pane`'s own `container-type: inline-size` doesn't count
 * — an element is never its own containing block. Adding a transform to
 * `.workspace-main`, `.workspace-content`, or `.split-pane` would break
 * floating mode.
 *
 * Every geometry change fires a synthetic `resize` event, which is how the
 * terminals' fit addon learns to re-measure (the same trick `SplitPane` uses
 * while dragging its divider).
 *
 * @module hooks/useAgentDock
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { logger } from '../lib/logger';

export type AgentDockMode = 'docked' | 'floating';

/** The floating panel's viewport rect, in px. */
export interface AgentDockRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Which edges a resize drag moves. */
type ResizeEdge = 'right' | 'bottom' | 'corner';

const MODE_KEY = 'ss:agentDock:mode';
const RECT_KEY = 'ss:agentDock:rect';

/** Small enough to park in a corner, large enough for a usable agent session. */
const MIN_W = 320;
const MIN_H = 200;
/** Keep this much of the panel on screen so the header stays grabbable. */
const EDGE_MARGIN = 8;

/** Default resting rect: left half of the window, clear of the header. */
function defaultRect(): AgentDockRect {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1400;
  const h = typeof window !== 'undefined' ? window.innerHeight : 900;
  return {
    top: 88,
    left: 24,
    width: Math.max(MIN_W, Math.min(560, Math.round(w * 0.42))),
    height: Math.max(MIN_H, Math.round(h * 0.62)),
  };
}

/** Clamp a rect so the panel can't be dragged fully off screen. */
function clampRect(rect: AgentDockRect): AgentDockRect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.max(MIN_W, Math.min(rect.width, vw - EDGE_MARGIN * 2));
  const height = Math.max(MIN_H, Math.min(rect.height, vh - EDGE_MARGIN * 2));
  return {
    width,
    height,
    left: Math.max(EDGE_MARGIN, Math.min(rect.left, vw - width - EDGE_MARGIN)),
    top: Math.max(EDGE_MARGIN, Math.min(rect.top, vh - height - EDGE_MARGIN)),
  };
}

function readMode(): AgentDockMode {
  return localStorage.getItem(MODE_KEY) === 'floating' ? 'floating' : 'docked';
}

function readRect(): AgentDockRect {
  const raw = localStorage.getItem(RECT_KEY);
  if (!raw) return defaultRect();
  try {
    const parsed = JSON.parse(raw) as Partial<AgentDockRect>;
    const { top, left, width, height } = parsed;
    if ([top, left, width, height].some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      return defaultRect();
    }
    return clampRect(parsed as AgentDockRect);
  } catch (err) {
    // A corrupt entry must not strand the panel — fall back and move on.
    logger.warn('[useAgentDock] ignoring unreadable saved rect', { error: String(err) });
    return defaultRect();
  }
}

/** Let the terminals re-measure after the pane's box changed. */
function notifyResize() {
  window.dispatchEvent(new Event('resize'));
}

export function useAgentDock() {
  const [mode, setMode] = useState<AgentDockMode>(readMode);
  const [rect, setRect] = useState<AgentDockRect>(readRect);
  const [isDragging, setIsDragging] = useState(false);

  // Grab offset for a header drag, or the anchor for a resize drag.
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const resizeRef = useRef<{ edge: ResizeEdge; x: number; y: number; rect: AgentDockRect } | null>(
    null
  );

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next: AgentDockMode = prev === 'floating' ? 'docked' : 'floating';
      localStorage.setItem(MODE_KEY, next);
      // The pane's box changes on the next paint; let xterm catch up after it.
      requestAnimationFrame(notifyResize);
      return next;
    });
  }, []);

  /** Commit a geometry change: clamp, store, and re-fit the terminals. */
  const applyRect = useCallback((next: AgentDockRect) => {
    const clamped = clampRect(next);
    setRect(clamped);
    localStorage.setItem(RECT_KEY, JSON.stringify(clamped));
    notifyResize();
  }, []);

  // A shrinking window can strand a floating panel outside the viewport.
  useEffect(() => {
    if (mode !== 'floating') return;
    const onWindowResize = () => setRect((r) => clampRect(r));
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [mode]);

  const onHeaderPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (mode !== 'floating') return;
      // Buttons in the bar keep their clicks — pointer capture would eat them.
      if ((e.target as HTMLElement).closest('button, input, select, a')) return;
      dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      setIsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [mode, rect.left, rect.top]
  );

  const onHeaderPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const d = dragRef.current;
      if (!d) return;
      applyRect({ ...rect, left: e.clientX - d.dx, top: e.clientY - d.dy });
    },
    [applyRect, rect]
  );

  const onHeaderPointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const onResizePointerDown = useCallback(
    (edge: ResizeEdge) => (e: ReactPointerEvent<HTMLElement>) => {
      e.preventDefault();
      resizeRef.current = { edge, x: e.clientX, y: e.clientY, rect };
      setIsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [rect]
  );

  const onResizePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const r = resizeRef.current;
      if (!r) return;
      const widen = r.edge === 'right' || r.edge === 'corner';
      const heighten = r.edge === 'bottom' || r.edge === 'corner';
      applyRect({
        ...r.rect,
        width: widen ? r.rect.width + (e.clientX - r.x) : r.rect.width,
        height: heighten ? r.rect.height + (e.clientY - r.y) : r.rect.height,
      });
    },
    [applyRect]
  );

  const onResizePointerUp = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    setIsDragging(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const isFloating = mode === 'floating';

  /** Inline box for floating mode; docked mode is pure CSS (the grid column). */
  const floatStyle: CSSProperties | undefined = isFloating
    ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    : undefined;

  return {
    mode,
    isFloating,
    isDragging,
    toggleMode,
    rect,
    floatStyle,
    /** Spread onto the pane's header bar to make it the drag handle. */
    headerDragProps: isFloating
      ? {
          onPointerDown: onHeaderPointerDown,
          onPointerMove: onHeaderPointerMove,
          onPointerUp: onHeaderPointerUp,
          onPointerCancel: onHeaderPointerUp,
        }
      : {},
    /** Spread onto a resize grip for the given edge. */
    resizeProps: (edge: ResizeEdge) => ({
      onPointerDown: onResizePointerDown(edge),
      onPointerMove: onResizePointerMove,
      onPointerUp: onResizePointerUp,
      onPointerCancel: onResizePointerUp,
    }),
  };
}
