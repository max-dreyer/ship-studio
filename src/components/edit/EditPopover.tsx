/**
 * A small popup editor anchored next to a clicked declaration prop/value. The
 * convention: click a value → this opens right beside it with the current value
 * pre-selected; type and press Enter to save, Escape cancels, click-away commits.
 *
 * It's the seam for value-type-specific editors. The first one: when the value is a
 * color, it shows the Tailwind editor's `ColorPicker`; otherwise a plain text input
 * (with optional autocomplete). Lengths/draggers etc. can slot in the same way.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ColorPicker } from './ColorPicker';
import { colorSwatch } from '../../lib/cssProperties';

interface Props {
  anchor: HTMLElement | null;
  initial: string;
  /** Optional native autocomplete options (text mode). */
  options?: string[];
  placeholder?: string;
  onCommit: (value: string) => void;
  onClose: () => void;
}

export function EditPopover({ anchor, initial, options, placeholder, onCommit, onClose }: Props) {
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const textRef = useRef(text);
  useEffect(() => {
    textRef.current = text;
  }, [text]);
  const listId = useId();

  const isColor = colorSwatch(initial) !== null;
  const width = isColor ? 224 : 200;

  // Position just below-left of the anchor, clamped into the viewport. Computed
  // from the anchor's measured rect at open time (anchor is stable while open).
  const pos = useMemo(() => {
    if (!anchor) return null;
    const r = anchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const top = Math.min(r.bottom + 4, window.innerHeight - (isColor ? 240 : 60));
    return { top, left };
  }, [anchor, width, isColor]);

  // Focus + select the current value on open (text mode).
  useEffect(() => {
    if (isColor) return;
    const el = inputRef.current;
    if (el) {
      el.focus();
      el.select();
    }
  }, [isColor]);

  // Escape cancels; click-away commits the current value. Clicks inside the popover
  // or its portaled sub-menus (the color format dropdown) don't dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (popRef.current?.contains(t)) return;
      // Clicking the anchor again is a toggle — let its own onClick close us.
      if (anchor?.contains(t)) return;
      if (t.closest?.('.ss-enum__menu, .ss-color-popover')) return;
      onCommit(textRef.current);
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [onClose, onCommit, anchor]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={popRef}
      className={`ss-value-pop${isColor ? ' ss-value-pop--color' : ''}`}
      style={{ position: 'fixed', top: pos.top, left: pos.left, width }}
    >
      {isColor ? (
        <ColorPicker
          value={text}
          onChange={(c) => {
            setText(c);
            onCommit(c); // live-apply as you drag
          }}
        />
      ) : (
        <input
          ref={inputRef}
          className="ss-value-pop__input"
          value={text}
          list={options ? listId : undefined}
          spellCheck={false}
          autoComplete="off"
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit(text);
              onClose();
            }
          }}
        />
      )}
      {options && !isColor && (
        <datalist id={listId}>
          {options.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      )}
    </div>,
    document.body
  );
}
