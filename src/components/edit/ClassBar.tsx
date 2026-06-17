/**
 * Webflow-style class bar for the visual editor.
 *
 * Sits at the top of the style panel and selects the *edit target*: the chips
 * are the custom classes applied to the selected element plus a "this element"
 * chip. Whichever is active is what the controls below edit — a class chip edits
 * the shared `@apply` rule (every instance updates), "this element" edits the
 * element's own utilities. A "+ class" popover creates a class from the current
 * styles or applies an existing one.
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import { PlusIcon } from '../icons/utility';
import { CloseIcon } from '../icons/common';
import type { CustomClass } from '../../lib/customClasses';
import type { EditTarget } from '../../hooks/useVisualEditor';

interface Props {
  /** All custom classes defined in the project. */
  customClasses: CustomClass[];
  /** The selected element's current className string. */
  elementClass: string;
  /** What the controls currently edit. */
  editTarget: EditTarget;
  /** Edit the element's own utilities. */
  onEditElement: () => void;
  /** Edit a custom class's `@apply` list. */
  onEditClass: (name: string, tokens: string[]) => void;
  /** Append an existing class to the element (and edit it). */
  onApplyExisting: (name: string) => void;
  /** Remove a class from the element (keeps it defined in CSS). */
  onUnapply: (name: string) => void;
  /** Extract the element's utilities into a new named class. */
  onCreate: (name: string) => void;
}

/** Client-side mirror of the backend's class-name rule (fast feedback only — the
 *  backend re-validates). */
const NAME_RE = /^[A-Za-z_-][A-Za-z0-9_-]*$/;

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
  // Classes applied to this element, in markup order.
  const applied = useMemo(
    () => tokens.map((t) => byName.get(t)).filter((c): c is CustomClass => !!c),
    [tokens, byName]
  );
  const hasUtilities = useMemo(() => tokens.some((t) => !byName.has(t)), [tokens, byName]);
  const available = useMemo(
    () => customClasses.filter((c) => !tokens.includes(c.name)),
    [customClasses, tokens]
  );

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const nameValid = NAME_RE.test(name) && !byName.has(name);
  const submitCreate = () => {
    if (!nameValid || !hasUtilities) return;
    onCreate(name.trim());
    setName('');
    setOpen(false);
  };

  const activeName = editTarget.kind === 'class' ? editTarget.name : null;

  return (
    <div className="ss-classbar">
      <span className="ss-classbar__label">Editing</span>
      <div className="ss-classbar__chips">
        {applied.map((c) => {
          const active = activeName === c.name;
          return (
            <span
              key={c.name}
              className={`ss-classbar__chip${active ? ' is-active' : ''}${
                c.editable ? '' : ' is-locked'
              }`}
            >
              <button
                type="button"
                className="ss-classbar__chip-name"
                title={
                  c.editable
                    ? `Edit .${c.name} — updates every element using it`
                    : `.${c.name} mixes custom CSS — edit it in code`
                }
                onClick={() => c.editable && onEditClass(c.name, c.tokens)}
                disabled={!c.editable}
              >
                .{c.name}
              </button>
              <button
                type="button"
                className="ss-classbar__chip-x"
                title={`Remove .${c.name} from this element`}
                onClick={() => onUnapply(c.name)}
              >
                <CloseIcon size={10} />
              </button>
            </span>
          );
        })}
        <button
          type="button"
          className={`ss-classbar__chip ss-classbar__chip--element${
            editTarget.kind === 'element' ? ' is-active' : ''
          }`}
          title="Edit this element's own utility classes"
          onClick={onEditElement}
        >
          this element
        </button>
      </div>

      <div className="ss-classbar__add" ref={popoverRef}>
        <button
          type="button"
          className="ss-classbar__add-btn"
          title="Create or apply a custom class"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <PlusIcon size={12} />
        </button>
        {open && (
          <div className="ss-classbar__popover" role="dialog">
            <div className="ss-classbar__create">
              <input
                type="text"
                className="ss-classbar__input"
                placeholder="class-name"
                value={name}
                spellCheck={false}
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitCreate();
                  if (e.key === 'Escape') setOpen(false);
                }}
              />
              <button
                type="button"
                className="ss-classbar__create-btn"
                disabled={!nameValid || !hasUtilities}
                title={
                  !hasUtilities
                    ? 'This element has no utility classes to extract'
                    : !NAME_RE.test(name)
                      ? 'Enter a valid class name'
                      : byName.has(name)
                        ? 'A class with this name already exists'
                        : 'Move these styles into a reusable class'
                }
                onClick={submitCreate}
              >
                Create from styles
              </button>
            </div>
            {available.length > 0 && (
              <div className="ss-classbar__existing">
                <div className="ss-classbar__existing-label">Apply existing</div>
                {available.map((c) => (
                  <button
                    key={c.name}
                    type="button"
                    className="ss-classbar__existing-item"
                    onClick={() => {
                      onApplyExisting(c.name);
                      setOpen(false);
                    }}
                  >
                    .{c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
