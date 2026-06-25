/**
 * The cascade card's smart "+ Add" menu (Direction 1) — one entry point for adding
 * any CSS structure to a rule, grouped by author intent rather than mechanism:
 *
 *   ALSO STYLE (nested)  → a related rule (`&:hover`, `& .child`, `&:has()`)
 *   ONLY WHEN (condition) → make it conditional (`@media`, `@container`, `@supports`)
 *
 * Type to filter across the whole modern-CSS surface ("dark", "container", "has"),
 * or type any selector / `@`-rule directly — free text is normalized and inserted.
 * The menu is portaled + fixed-positioned so it's never clipped by the scrolling
 * panel, and flips above the trigger when there isn't room below.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlusIcon } from '../icons/utility';
import {
  NEST_ITEMS,
  WRAP_ITEMS,
  searchStructures,
  classifyFreeText,
  type StructureItem,
} from '../../lib/cssStructures';

interface Props {
  /** Add a nested rule with this selector/prelude (always available). */
  onNest: (selector: string) => void;
  /** Wrap the rule in this at-rule prelude. Absent on nested rules — there a
   *  condition is added by nesting the at-rule instead. */
  onWrap?: (prelude: string) => void;
}

const MENU_WIDTH = 280;

export function AddStructureMenu({ onNest, onWrap }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // The trigger's rect is captured from the click event (never read from a ref
  // during render) and used to position the portaled menu.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const apply = (item: StructureItem) => {
    if (item.kind === 'wrap' && onWrap) onWrap(item.insert);
    else onNest(item.insert); // nested rule, or a nested at-rule on cards without onWrap
    setOpen(false);
    setQuery('');
  };

  // A flat, ordered list of what's shown (used for keyboard nav + Enter).
  const { nests, wraps, free } = useMemo(() => {
    const nests = searchStructures(NEST_ITEMS, query);
    const wraps = searchStructures(WRAP_ITEMS, query);
    const typed = query.trim();
    const known = [...nests, ...wraps].some((i) => i.insert === classifyFreeText(typed)?.insert);
    const free = typed && !known ? classifyFreeText(typed) : null;
    return { nests, wraps, free };
  }, [query]);
  const flat = useMemo(() => [...(free ? [free] : []), ...nests, ...wraps], [free, nests, wraps]);

  // Position under the trigger, clamped; flip up if it would overflow below.
  const pos = useMemo(() => {
    if (!open || !anchor) return null;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_WIDTH - 8));
    const below = window.innerHeight - anchor.bottom;
    const flip = below < 280 && anchor.top > below;
    return {
      left,
      top: flip ? undefined : anchor.bottom + 4,
      bottom: flip ? window.innerHeight - anchor.top + 4 : undefined,
    };
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const trigger = (
    <button
      ref={btnRef}
      type="button"
      className={`ss-card__add-structure${open ? ' is-open' : ''}`}
      title="Add a nested rule or a condition (@media, @container, &:hover, …)"
      aria-expanded={open}
      onClick={(e) => {
        if (open) {
          setOpen(false);
        } else {
          setAnchor(e.currentTarget.getBoundingClientRect());
          setOpen(true);
        }
      }}
    >
      <PlusIcon size={11} /> Add
    </button>
  );

  if (!open || !pos) return trigger;

  return (
    <>
      {trigger}
      {createPortal(
        <div
          ref={popRef}
          className="ss-struct-menu"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: MENU_WIDTH,
          }}
        >
          <input
            className="ss-struct-menu__search"
            autoFocus
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder="Filter, or type a selector / @rule…"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, flat.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                if (flat[active]) apply(flat[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
              }
            }}
          />
          <div className="ss-struct-menu__list">
            {flat.length === 0 && <div className="ss-struct-menu__empty">No matches</div>}
            {free && <Row item={free} active={active === 0} create onSelect={apply} />}
            {nests.length > 0 && <div className="ss-struct-menu__group">Also style</div>}
            {nests.map((it, i) => (
              <Row
                key={it.insert}
                item={it}
                active={active === (free ? 1 : 0) + i}
                onSelect={apply}
              />
            ))}
            {wraps.length > 0 && <div className="ss-struct-menu__group">Only when</div>}
            {wraps.map((it, i) => (
              <Row
                key={it.insert}
                item={it}
                active={active === (free ? 1 : 0) + nests.length + i}
                onSelect={apply}
              />
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

function Row({
  item,
  active,
  create,
  onSelect,
}: {
  item: StructureItem;
  active: boolean;
  create?: boolean;
  onSelect: (item: StructureItem) => void;
}) {
  return (
    <button
      type="button"
      className={`ss-struct-menu__item${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onSelect(item)}
    >
      <code className="ss-struct-menu__label">{create ? `Add ${item.label}` : item.label}</code>
      {item.hint && <span className="ss-struct-menu__hint">{item.hint}</span>}
    </button>
  );
}
