/**
 * A portaled autocomplete dropdown for the inline chip inputs (rule selector, nested
 * selector, @media condition).
 *
 * Why portaled: the previous inline-absolute version rendered *inside* the editor
 * panel's DOM, where an ancestor's layout context flowed its rows into columns
 * (a column would fill to the height cap, then a second column started). Rendering to
 * `document.body` with fixed positioning escapes every ancestor context, so the list
 * is a plain block of stacked rows — the same approach the working `+ Add` menu uses.
 *
 * It's presentational: the owning input keeps the text/active-index/keyboard state and
 * passes the filtered items down; this just positions and renders them + handles clicks.
 */

import { useMemo } from 'react';
import { createPortal } from 'react-dom';

export interface Suggestion {
  /** Committed when picked. */
  value: string;
  /** Shown (defaults to value). */
  label: string;
  hint?: string;
}

interface Props {
  /** The input element the dropdown anchors under (a DOM node, not a React ref). */
  anchor: HTMLElement | null;
  items: Suggestion[];
  /** Highlighted index (keyboard nav lives in the owning input). */
  active: number;
  onPick: (value: string) => void;
  width?: number;
}

export function SuggestionPopover({ anchor, items, active, onPick, width = 240 }: Props) {
  const pos = useMemo(() => {
    if (!anchor || items.length === 0) return null;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = window.innerHeight - r.bottom;
    const flip = below < 220 && r.top > below;
    return {
      left,
      top: flip ? undefined : r.bottom + 4,
      bottom: flip ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: Math.max(120, (flip ? r.top : below) - 12),
    };
  }, [anchor, items.length, width]);

  if (!pos) return null;

  return createPortal(
    <div
      className="ss-suggest"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        bottom: pos.bottom,
        width,
        maxHeight: pos.maxHeight,
      }}
    >
      {items.map((it, i) => (
        <button
          key={it.value}
          type="button"
          className={`ss-suggest__item${i === active ? ' is-active' : ''}`}
          // Keep the input focused so its blur doesn't close us before the click lands.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(it.value)}
        >
          <code className="ss-suggest__label">{it.label}</code>
          {it.hint && <span className="ss-suggest__hint">{it.hint}</span>}
        </button>
      ))}
    </div>,
    document.body
  );
}
