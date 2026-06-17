/**
 * Custom-class control for the visual editor.
 *
 * Renders as a standard panel control row (like "Breakpoint") whose dropdown
 * picks the *edit target*: "This element" (its own utilities) or one of the
 * custom classes applied to it (editing the shared `@apply` rule updates every
 * instance). The same menu applies an existing class, creates one from the
 * current styles, or removes the active class from the element. Styling reuses
 * the panel's native dropdown (`ss-enum__*`) so it matches the rest of the panel.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CustomClass } from '../../lib/customClasses';
import type { EditTarget } from '../../hooks/useVisualEditor';

interface Props {
  customClasses: CustomClass[];
  /** The selected element's current className string. */
  elementClass: string;
  editTarget: EditTarget;
  onEditElement: () => void;
  onEditClass: (name: string, tokens: string[]) => void;
  onApplyExisting: (name: string) => void;
  onUnapply: (name: string) => void;
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
  const hasUtilities = useMemo(() => tokens.some((t) => !byName.has(t)), [tokens, byName]);
  const available = useMemo(
    () => customClasses.filter((c) => !tokens.includes(c.name)),
    [customClasses, tokens]
  );

  const activeName = editTarget.kind === 'class' ? editTarget.name : null;
  const triggerLabel = activeName ? `.${activeName}` : 'This element';

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(
    null
  );
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuRect({ top: r.bottom + 4, left: r.left, width: r.width });
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
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const nameValid = NAME_RE.test(name) && !byName.has(name);
  const submitCreate = () => {
    if (!nameValid || !hasUtilities) return;
    onCreate(name.trim());
    setName('');
    setCreating(false);
  };
  const cancelCreate = () => {
    setName('');
    setCreating(false);
  };

  return (
    <div className="ss-edit-panel__control">
      <span className="ss-edit-panel__label">Editing</span>

      {creating ? (
        <span className="ss-classedit__create">
          <input
            type="text"
            className="ss-classedit__input"
            placeholder="class-name"
            value={name}
            spellCheck={false}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate();
              if (e.key === 'Escape') cancelCreate();
            }}
            onBlur={() => !name && cancelCreate()}
          />
          <button
            type="button"
            className="ss-classedit__go"
            disabled={!nameValid || !hasUtilities}
            title={
              !hasUtilities
                ? 'This element has no utility classes to extract'
                : !NAME_RE.test(name)
                  ? 'Enter a valid class name'
                  : byName.has(name)
                    ? 'A class with this name already exists'
                    : 'Create the class from these styles'
            }
            onClick={submitCreate}
          >
            Create
          </button>
        </span>
      ) : (
        <button
          ref={triggerRef}
          type="button"
          className="ss-enum__trigger"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span>{triggerLabel}</span>
          <Chevron />
        </button>
      )}

      {open &&
        menuRect &&
        createPortal(
          <div
            ref={menuRef}
            className="ss-enum__menu"
            role="menu"
            style={{ top: menuRect.top, left: menuRect.left, minWidth: menuRect.width }}
          >
            <button
              type="button"
              role="menuitem"
              className={`ss-enum__item${editTarget.kind === 'element' ? ' is-active' : ''}`}
              onClick={() => {
                onEditElement();
                setOpen(false);
              }}
            >
              This element
            </button>
            {applied.map((c) => (
              <button
                key={c.name}
                type="button"
                role="menuitem"
                className={`ss-enum__item${activeName === c.name ? ' is-active' : ''}`}
                title={c.editable ? undefined : `.${c.name} mixes custom CSS — edit it in code`}
                disabled={!c.editable}
                onClick={() => {
                  onEditClass(c.name, c.tokens);
                  setOpen(false);
                }}
              >
                .{c.name}
              </button>
            ))}

            <div className="ss-classedit__sep" role="separator" />

            {available.map((c) => (
              <button
                key={c.name}
                type="button"
                role="menuitem"
                className="ss-enum__item ss-classedit__muted"
                onClick={() => {
                  onApplyExisting(c.name);
                  setOpen(false);
                }}
              >
                Apply .{c.name}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="ss-enum__item ss-classedit__muted"
              title={hasUtilities ? undefined : 'This element has no utility classes to extract'}
              disabled={!hasUtilities}
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              + New class from styles…
            </button>
            {activeName && (
              <button
                type="button"
                role="menuitem"
                className="ss-enum__item ss-classedit__muted"
                onClick={() => {
                  onUnapply(activeName);
                  setOpen(false);
                }}
              >
                Remove .{activeName} from element
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
