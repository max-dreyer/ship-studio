/**
 * Custom-class control for the visual editor.
 *
 * Renders as a standard panel control row (like "Breakpoint") whose dropdown
 * picks the *edit target* — "This element" or one of the custom classes applied
 * to it (editing the shared `@apply` rule updates every instance) — and manages
 * which classes are on the element.
 *
 * The menu is searchable (essential past a handful of classes), names truncate
 * rather than wrap, and the "Add to element" rows apply without closing the menu
 * so several classes can be added in a row. Applies/unapplies are serialized
 * (one in-flight at a time) so a rapid burst can't drop or mis-order writes.
 * The search field doubles as the name for "create from styles".
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlusIcon } from '../icons/utility';
import { CloseIcon } from '../icons/common';
import type { CustomClass } from '../../lib/customClasses';
import type { EditTarget } from '../../hooks/useVisualEditor';
import { logger } from '../../lib/logger';

interface Props {
  customClasses: CustomClass[];
  /** The selected element's current className string. */
  elementClass: string;
  editTarget: EditTarget;
  /** False when the project has no writable Tailwind entry stylesheet — creating
   *  a class isn't possible, so the create affordance is disabled with a hint. */
  canCreate?: boolean;
  onEditElement: () => void;
  onEditClass: (name: string, tokens: string[]) => void;
  onApplyExisting: (name: string) => void | Promise<void>;
  onUnapply: (name: string) => void | Promise<void>;
  onCreate: (name: string) => void;
}

/** Client-side mirror of the backend's class-name rule (the backend re-validates). */
const NAME_RE = /^[A-Za-z_-][A-Za-z0-9_-]*$/;

function Chevron() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden>
      <polyline points="6 9 12 15 18 9" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function ClassBar({
  customClasses,
  elementClass,
  editTarget,
  canCreate: canCreateClasses = true,
  onEditElement,
  onEditClass,
  onApplyExisting,
  onUnapply,
  onCreate,
}: Props) {
  const byName = useMemo(() => {
    const m = new Map<string, CustomClass>();
    for (const c of customClasses) m.set(c.name, c);
    return m;
  }, [customClasses]);

  const tokens = useMemo(() => elementClass.split(/\s+/).filter(Boolean), [elementClass]);
  const applied = useMemo(
    () => tokens.map((t) => byName.get(t)).filter((c): c is CustomClass => !!c),
    [tokens, byName]
  );
  const appliedNames = useMemo(() => new Set(applied.map((c) => c.name)), [applied]);
  const hasUtilities = useMemo(() => tokens.some((t) => !byName.has(t)), [tokens, byName]);
  const available = useMemo(
    () => customClasses.filter((c) => !appliedNames.has(c.name)),
    [customClasses, appliedNames]
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // True while an apply/unapply write is in flight — disables the toggle rows so a
  // rapid burst can't race (each write must land before the next starts).
  const [busy, setBusy] = useState(false);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuRect({ top: r.bottom + 4, left: r.left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  const q = query.trim().toLowerCase();
  const matchedApplied = useMemo(
    () => applied.filter((c) => c.name.toLowerCase().includes(q)),
    [applied, q]
  );
  const matchedAvailable = useMemo(
    () => available.filter((c) => c.name.toLowerCase().includes(q)),
    [available, q]
  );
  const trimmed = query.trim();
  const canCreate = NAME_RE.test(trimmed) && !byName.has(trimmed);
  const showElementRow = q === '' || 'this element'.includes(q);

  const activeName = editTarget.kind === 'class' ? editTarget.name : null;
  const triggerLabel = activeName ? `.${activeName}` : 'This element';

  // Apply/unapply keep the menu open; serialize so a burst can't race.
  const toggle = useCallback(async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      // The handlers (applyClass/unapplyClass) already toast on failure and
      // don't reject; guard here anyway so a throwing handler can't surface as
      // an unhandled rejection and strand the busy state.
      logger.error('[ClassBar] apply/unapply failed', { error: String(err) });
    } finally {
      setBusy(false);
    }
  }, []);

  const noMatches =
    q !== '' && matchedApplied.length === 0 && matchedAvailable.length === 0 && !canCreate;

  return (
    <div className="ss-edit-panel__control">
      <span className="ss-edit-panel__label">Editing</span>
      <button
        ref={triggerRef}
        type="button"
        className="ss-enum__trigger ss-classedit__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ss-classedit__name">{triggerLabel}</span>
        <Chevron />
      </button>

      {open &&
        menuRect &&
        createPortal(
          <div
            ref={menuRef}
            className="ss-enum__menu ss-classedit__menu"
            role="menu"
            style={{ top: menuRect.top, left: menuRect.left }}
          >
            <input
              type="text"
              className="ss-classedit__search"
              placeholder="Search or name a new class…"
              value={query}
              spellCheck={false}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close();
                if (e.key === 'Enter' && canCreate && hasUtilities && canCreateClasses) {
                  onCreate(trimmed);
                  close();
                }
              }}
            />

            <div className="ss-classedit__scroll">
              {showElementRow && (
                <button
                  type="button"
                  role="menuitem"
                  className={`ss-classedit__item${editTarget.kind === 'element' ? ' is-active' : ''}`}
                  onClick={() => {
                    onEditElement();
                    close();
                  }}
                >
                  <span className="ss-classedit__name">This element</span>
                </button>
              )}

              {matchedApplied.map((c) => (
                <div
                  key={c.name}
                  className={`ss-classedit__row${activeName === c.name ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="ss-classedit__pick"
                    disabled={!c.editable}
                    title={
                      c.editable
                        ? `Edit .${c.name} — updates every element using it`
                        : `.${c.name} mixes custom CSS — edit it in code`
                    }
                    onClick={() => {
                      if (!c.editable) return;
                      onEditClass(c.name, c.tokens);
                      close();
                    }}
                  >
                    <span className="ss-classedit__name">.{c.name}</span>
                  </button>
                  <button
                    type="button"
                    className="ss-classedit__x"
                    disabled={busy}
                    title={`Remove .${c.name} from this element`}
                    onClick={() => void toggle(() => onUnapply(c.name))}
                  >
                    <CloseIcon size={11} />
                  </button>
                </div>
              ))}

              {matchedAvailable.length > 0 && (
                <div className="ss-classedit__group">Add to element</div>
              )}
              {matchedAvailable.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  role="menuitem"
                  className="ss-classedit__item ss-classedit__item--add"
                  disabled={busy}
                  title={`Apply .${c.name} to this element`}
                  onClick={() => void toggle(() => onApplyExisting(c.name))}
                >
                  <PlusIcon size={11} />
                  <span className="ss-classedit__name">.{c.name}</span>
                </button>
              ))}

              {noMatches && (
                <div className="ss-classedit__empty">No classes match “{trimmed}”.</div>
              )}
            </div>

            {canCreate && (
              <button
                type="button"
                role="menuitem"
                className="ss-classedit__createrow"
                disabled={!hasUtilities || !canCreateClasses}
                title={
                  !canCreateClasses
                    ? 'No Tailwind stylesheet found in this project to add the class to'
                    : hasUtilities
                      ? `Create .${trimmed} from this element's current styles`
                      : 'This element has no utility classes to extract'
                }
                onClick={() => {
                  onCreate(trimmed);
                  close();
                }}
              >
                <PlusIcon size={11} />
                <span className="ss-classedit__name">
                  Create <b>.{trimmed}</b> from styles
                </span>
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
