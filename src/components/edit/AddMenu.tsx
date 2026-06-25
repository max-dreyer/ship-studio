/**
 * The cascade card's single "+ Add" menu — ONE entry point for adding anything to a
 * rule, grouped by author intent so there's no "add property vs add structure"
 * confusion:
 *
 *   PROPERTY              → a declaration (`color`, `display`, …) with suggestions
 *   ALSO STYLE (nested)   → a related rule (`&:hover`, `& .child`, `&:has()`)
 *   ONLY WHEN (condition) → make it conditional (`@media`, `@container`, `@supports`)
 *
 * What you type routes intent: a word filters properties (+ structure by keyword);
 * leading `@` means a condition; a leading selector char (`&`, `:`, `.`, `>`…) means
 * a nested rule. Free text is always honored and normalized. Portaled + flip-up
 * positioned so it's never clipped by the scrolling panel.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { PlusIcon } from '../icons/utility';
import { suggestProperties } from '../../lib/cssProperties';
import {
  NEST_ITEMS,
  WRAP_ITEMS,
  searchStructures,
  classifyFreeText,
} from '../../lib/cssStructures';

interface Props {
  onAddProperty: (prop: string) => void;
  /** Add a nested rule with this selector/prelude (always available). */
  onNest: (selector: string) => void;
  /** Wrap the rule in this at-rule prelude. Absent on nested rules — there a
   *  condition is added by nesting the at-rule instead. */
  onWrap?: (prelude: string) => void;
}

type RowKind = 'prop' | 'nest' | 'wrap';
interface MenuRow {
  key: string;
  label: string;
  hint?: string;
  kind: RowKind;
  /** The string handed to the matching callback. */
  insert: string;
}
interface Section {
  title: string;
  rows: MenuRow[];
}

const MENU_WIDTH = 288;
const SEL_START = /^[&:>+~.#[*]/;
const LOOKS_PROP = /^[a-zA-Z-]+$/;

export function AddMenu({ onAddProperty, onNest, onWrap }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  // The trigger's rect is captured from the click event (never read from a ref
  // during render) and used to position the portaled menu.
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setQuery('');
    setActive(0);
  };
  const applyRow = (r: MenuRow) => {
    if (r.kind === 'prop') onAddProperty(r.insert);
    else if (r.kind === 'wrap' && onWrap) onWrap(r.insert);
    else onNest(r.insert); // nest, or a nested at-rule on cards without onWrap
    close();
  };

  const sections = useMemo<Section[]>(() => {
    const typed = query.trim();
    const startsAt = typed.startsWith('@');
    const startsSel = SEL_START.test(typed);
    const out: Section[] = [];

    // PROPERTY — only when the query isn't clearly a selector or at-rule.
    if (!startsAt && !startsSel) {
      const sugg = suggestProperties(typed);
      const rows: MenuRow[] = [];
      if (typed && LOOKS_PROP.test(typed) && !sugg.includes(typed)) {
        rows.push({
          key: `new:${typed}`,
          label: typed,
          hint: 'new property',
          kind: 'prop',
          insert: typed,
        });
      }
      for (const p of sugg) rows.push({ key: `p:${p}`, label: p, kind: 'prop', insert: p });
      if (rows.length) out.push({ title: 'Property', rows });
    }

    // ALSO STYLE (nested) — catalog matches + a free-typed selector.
    if (!startsAt) {
      const rows: MenuRow[] = [];
      const items = searchStructures(NEST_ITEMS, typed);
      if (startsSel) {
        const free = classifyFreeText(typed);
        if (free && free.kind === 'nest' && !items.some((i) => i.insert === free.insert)) {
          rows.push({
            key: `fn:${free.insert}`,
            label: free.insert,
            hint: 'new nested rule',
            kind: 'nest',
            insert: free.insert,
          });
        }
      }
      for (const it of items)
        rows.push({
          key: `n:${it.insert}`,
          label: it.label,
          hint: it.hint,
          kind: 'nest',
          insert: it.insert,
        });
      if (rows.length) out.push({ title: 'Also style', rows });
    }

    // ONLY WHEN (condition) — catalog matches + a free-typed at-rule.
    if (!startsSel) {
      const rows: MenuRow[] = [];
      const items = searchStructures(WRAP_ITEMS, typed);
      if (startsAt && typed.length > 1 && !items.some((i) => i.insert === typed)) {
        rows.push({
          key: `fw:${typed}`,
          label: typed,
          hint: 'new condition',
          kind: 'wrap',
          insert: typed,
        });
      }
      for (const it of items)
        rows.push({
          key: `w:${it.insert}`,
          label: it.label,
          hint: it.hint,
          kind: 'wrap',
          insert: it.insert,
        });
      if (rows.length) out.push({ title: 'Only when', rows });
    }

    return out;
  }, [query]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  // Position under the trigger, clamped; flip up if it would overflow below.
  const pos = useMemo(() => {
    if (!open || !anchor) return null;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - MENU_WIDTH - 8));
    const below = window.innerHeight - anchor.bottom;
    const flip = below < 300 && anchor.top > below;
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
      close();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [open]);

  const trigger = (
    <button
      ref={btnRef}
      type="button"
      className={`ss-card__add${open ? ' is-open' : ''}`}
      aria-label="Add a property, nested rule, or condition"
      aria-expanded={open}
      onClick={(e) => {
        if (open) close();
        else {
          setAnchor(e.currentTarget.getBoundingClientRect());
          setOpen(true);
        }
      }}
    >
      <PlusIcon size={11} /> Add
    </button>
  );

  if (!open || !pos) return trigger;

  let idx = -1; // running flat index for keyboard highlight
  return (
    <>
      {trigger}
      {createPortal(
        <div
          ref={popRef}
          className="ss-add-menu"
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            width: MENU_WIDTH,
          }}
        >
          <input
            className="ss-add-menu__search"
            autoFocus
            value={query}
            spellCheck={false}
            autoComplete="off"
            placeholder="Add a property, &:hover, @media…"
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
                if (flat[active]) applyRow(flat[active]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
          />
          <div className="ss-add-menu__list">
            {flat.length === 0 && <div className="ss-add-menu__empty">No matches</div>}
            {sections.map((section) => (
              <div key={section.title}>
                <div className="ss-add-menu__group">{section.title}</div>
                {section.rows.map((row) => {
                  idx += 1;
                  const isActive = idx === active;
                  return (
                    <button
                      key={row.key}
                      type="button"
                      className={`ss-add-menu__item${isActive ? ' is-active' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyRow(row)}
                    >
                      <code className="ss-add-menu__label">{row.label}</code>
                      {row.hint && <span className="ss-add-menu__hint">{row.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
