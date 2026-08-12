/**
 * Box-model spacing editor for the CSS editor — the margin box wrapping the
 * padding box, four editable sides each.
 *
 * The CSS-mode twin of `SpacingBox` (which speaks Tailwind's scale). It shares
 * that component's markup and styling so both editors look identical, but
 * reads and writes real declarations through `lib/cssBoxModel`: a shorthand is
 * expanded for display, and editing one side rewrites the box as longhands so
 * the rule can't contradict itself.
 *
 * Each side drags along its own axis, outward to grow, the way Webflow does it:
 * pull the top bar up, the bottom bar down.
 *
 * @module components/edit/CssSpacingBox
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { isScrubbable, stepLength } from '../../lib/cssLength';
import {
  BOX_SIDES,
  readBoxSides,
  setBoxSide,
  type BoxBase,
  type BoxChange,
  type BoxSide,
} from '../../lib/cssBoxModel';
import type { CssDeclaration } from '../../lib/edit-css';

/** Drag axis + direction per side: pulling outward grows the value. */
const SIDE_DRAG: Record<BoxSide, { axis: 'x' | 'y'; sign: 1 | -1 }> = {
  top: { axis: 'y', sign: -1 },
  bottom: { axis: 'y', sign: 1 },
  left: { axis: 'x', sign: -1 },
  right: { axis: 'x', sign: 1 },
};

/** Pixels of drag per step. */
const DRAG_SENSITIVITY = 4;

const EDGE_KEY: Record<BoxSide, string> = { top: 't', bottom: 'b', left: 'l', right: 'r' };

interface SideFieldProps {
  base: BoxBase;
  side: BoxSide;
  value: string;
  onPreview: (value: string | null) => void;
  onCommit: (value: string | null) => void;
}

function SideField({ base, side, value, onPreview, onCommit }: SideFieldProps) {
  const [text, setText] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const dragRef = useRef<{ origin: number; from: string; last: string } | null>(null);
  const prop = `${base}-${side}`;

  // Adopt outside changes unless a drag is in flight (see CssLengthField).
  if (value !== syncedValue && !isScrubbing) {
    setSyncedValue(value);
    setText(value);
  }

  const commit = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (trimmed === value.trim()) return;
      onCommit(trimmed === '' ? null : trimmed);
    },
    [onCommit, value]
  );

  const dir = SIDE_DRAG[side];

  const onPointerDown = (e: ReactPointerEvent<HTMLInputElement>) => {
    if (!isScrubbable(text)) return;
    const origin = dir.axis === 'x' ? e.clientX : e.clientY;
    dragRef.current = { origin, from: text, last: text };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLInputElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const now = dir.axis === 'x' ? e.clientX : e.clientY;
    const steps = Math.trunc(((now - d.origin) * dir.sign) / DRAG_SENSITIVITY);
    // A drag that hasn't moved a full step yet shouldn't steal focus-to-type.
    if (steps !== 0 && !isScrubbing) setIsScrubbing(true);
    const next = steps === 0 ? d.from : stepLength(d.from, prop, steps, e.shiftKey);
    if (next === d.last) return;
    d.last = next;
    setText(next);
    onPreview(next || null);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLInputElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setIsScrubbing(false);
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    commit(d.last);
  };

  return (
    <input
      className={`ss-box__field ss-box__edge--${EDGE_KEY[side]}`}
      value={text}
      placeholder="0"
      spellCheck={false}
      autoComplete="off"
      aria-label={`${base} ${side}`}
      title={`${base} ${side} (drag, arrow keys, or type)`}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => commit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (e.key === 'Escape') {
          setText(value);
          (e.target as HTMLInputElement).blur();
          return;
        }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (!isScrubbable(text)) return;
        e.preventDefault();
        const next = stepLength(text, prop, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
        if (next === text) return;
        setText(next);
        onPreview(next || null);
      }}
      onKeyUp={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') commit(text);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}

interface Props {
  declarations: CssDeclaration[];
  onPreview: (property: string, value: string | null) => void;
  onSaveMany: (changes: BoxChange[]) => void;
}

export function CssSpacingBox({ declarations, onPreview, onSaveMany }: Props) {
  const margin = readBoxSides(declarations, 'margin');
  const padding = readBoxSides(declarations, 'padding');

  const field = (base: BoxBase, side: BoxSide) => (
    <SideField
      key={`${base}-${side}`}
      base={base}
      side={side}
      value={(base === 'margin' ? margin : padding)[side]}
      onPreview={(v) => onPreview(`${base}-${side}`, v)}
      onCommit={(v) => onSaveMany(setBoxSide(declarations, base, side, v))}
    />
  );

  return (
    <div className="ss-box" data-testid="css-spacing-box">
      <span className="ss-box__tag">MARGIN</span>
      {BOX_SIDES.map((side) => field('margin', side))}

      <div className="ss-box__inner">
        <span className="ss-box__tag">PADDING</span>
        {BOX_SIDES.map((side) => field('padding', side))}
        <div className="ss-box__core" />
      </div>
    </div>
  );
}
