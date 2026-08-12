/**
 * A numeric CSS field with Webflow's three interactions: drag the grip to
 * scrub the value, arrow-key to nudge it, pick a unit from the suffix menu.
 *
 * Typing still works exactly as before — the input stays free-form, so
 * `calc()`, `var()` and keywords go in by hand. Those values simply opt out of
 * scrubbing (see `isScrubbable`) rather than being rewritten.
 *
 * Live feedback follows the panel's existing contract: `onPreview` fires
 * continuously while dragging or holding an arrow key, `onSave` once the
 * gesture ends, so a drag produces one source write instead of forty.
 *
 * @module components/edit/CssLengthField
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutsidePointer } from '../../hooks/useDismissOnOutsidePointer';
import {
  CSS_UNITS,
  isScrubbable,
  parseLength,
  scrubSensitivity,
  stepLength,
  withUnit,
} from '../../lib/cssLength';

interface Props {
  prop: string;
  value: string;
  placeholder?: string;
  /** Live value while a gesture is in flight. */
  onPreview: (property: string, value: string | null) => void;
  /** Final value once the gesture ends. */
  onSave: (property: string, value: string | null) => void;
  /** Validity check, shared with the panel's typed-input path. */
  isValid: (value: string) => boolean;
}

/** The unit menu also offers "no unit" for line-height and friends. */
const UNIT_OPTIONS = [...CSS_UNITS, ''] as const;

export function CssLengthField({ prop, value, placeholder, onPreview, onSave, isValid }: Props) {
  const [text, setText] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  const [unitMenu, setUnitMenu] = useState<{ top: number; left: number } | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const unitBtnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Scrub origin: where the pointer went down and what the value was then.
  const scrubRef = useRef<{ x: number; from: string; last: string } | null>(null);
  // Arrow-key runs commit once on key-up rather than per repeat.
  const pendingKeyValue = useRef<string | null>(null);

  // Adopt external changes (selection change, reset, breakpoint switch) unless
  // the user is mid-gesture, which would fight their drag. Adjusted during
  // render rather than in an effect — React re-renders before painting, so the
  // stale value never reaches the screen.
  if (value !== syncedValue && !isScrubbing) {
    setSyncedValue(value);
    setText(value);
  }

  const valid = text.trim() === '' || isValid(text.trim());
  const parsed = parseLength(text);
  const canScrub = isScrubbable(text);

  const commit = useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (trimmed === value.trim()) return;
      if (trimmed !== '' && !isValid(trimmed)) {
        setText(value);
        onPreview(prop, value || null);
        return;
      }
      onSave(prop, trimmed === '' ? null : trimmed);
    },
    [isValid, onPreview, onSave, prop, value]
  );

  // ===== Drag to scrub =====

  const onScrubDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (!canScrub) return;
      e.preventDefault();
      scrubRef.current = { x: e.clientX, from: text, last: text };
      setIsScrubbing(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [canScrub, text]
  );

  const onScrubMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = scrubRef.current;
      if (!s) return;
      const steps = Math.trunc((e.clientX - s.x) / scrubSensitivity(prop));
      if (steps === 0) {
        if (s.last !== s.from) {
          s.last = s.from;
          setText(s.from);
          onPreview(prop, s.from || null);
        }
        return;
      }
      const next = stepLength(s.from, prop, steps, e.shiftKey);
      if (next === s.last) return;
      s.last = next;
      setText(next);
      onPreview(prop, next || null);
    },
    [onPreview, prop]
  );

  const onScrubUp = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = scrubRef.current;
      if (!s) return;
      scrubRef.current = null;
      setIsScrubbing(false);
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      commit(s.last);
    },
    [commit]
  );

  // ===== Unit menu =====

  useDismissOnOutsidePointer(unitMenu !== null, menuRef, () => setUnitMenu(null), {
    isOutside: (t) => !menuRef.current?.contains(t) && !unitBtnRef.current?.contains(t),
  });

  const openUnitMenu = () => {
    const r = unitBtnRef.current?.getBoundingClientRect();
    if (!r) return;
    const H = UNIT_OPTIONS.length * 24 + 8;
    setUnitMenu({
      top: Math.min(r.bottom + 4, window.innerHeight - H - 8),
      left: Math.max(8, r.right - 64),
    });
  };

  const pickUnit = (unit: string) => {
    setUnitMenu(null);
    const next = withUnit(text, unit, prop);
    setText(next);
    onPreview(prop, next || null);
    commit(next);
  };

  return (
    <>
      <span className="ss-cc-lengthwrap">
        {/* Drag handle, inside the field's left edge. Pointer-only on purpose:
            the keyboard equivalent is arrow-keys on the input itself, so this
            stays out of the tab order and off the a11y tree. */}
        <span
          className={`ss-cc-scrub${canScrub ? '' : ' is-disabled'}${
            isScrubbing ? ' is-scrubbing' : ''
          }`}
          onPointerDown={onScrubDown}
          onPointerMove={onScrubMove}
          onPointerUp={onScrubUp}
          onPointerCancel={onScrubUp}
          aria-hidden
        />
        <input
          className={`ss-cc-input${!valid ? ' is-invalid' : ''}`}
          value={text}
          placeholder={placeholder}
          spellCheck={false}
          inputMode="decimal"
          onChange={(e) => {
            setText(e.target.value);
            const t = e.target.value.trim();
            if (t && isValid(t)) onPreview(prop, t);
          }}
          onBlur={() => commit(text)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              (e.target as HTMLInputElement).blur();
              return;
            }
            if (e.key === 'Escape') {
              setText(value);
              onPreview(prop, value || null);
              (e.target as HTMLInputElement).blur();
              return;
            }
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            if (!isScrubbable(text)) return;
            // Take over from the browser's caret movement.
            e.preventDefault();
            const next = stepLength(text, prop, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
            if (next === text) return;
            setText(next);
            pendingKeyValue.current = next;
            onPreview(prop, next || null);
          }}
          onKeyUp={(e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const next = pendingKeyValue.current;
            pendingKeyValue.current = null;
            if (next !== null) commit(next);
          }}
        />
        {parsed && (
          <button
            ref={unitBtnRef}
            type="button"
            className="ss-cc-unit"
            onClick={() => (unitMenu ? setUnitMenu(null) : openUnitMenu())}
            aria-expanded={unitMenu !== null}
            aria-label={`Unit for ${prop}`}
            title="Change unit"
          >
            {parsed.unit || '—'}
          </button>
        )}
      </span>
      {unitMenu &&
        createPortal(
          <div
            ref={menuRef}
            className="ss-cc-unitmenu"
            style={{ top: unitMenu.top, left: unitMenu.left }}
            role="menu"
          >
            {UNIT_OPTIONS.map((u) => (
              <button
                key={u || 'none'}
                type="button"
                role="menuitem"
                className={`ss-cc-unitmenu__item${parsed?.unit === u ? ' is-active' : ''}`}
                onClick={() => pickUnit(u)}
              >
                {u || 'none'}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}
