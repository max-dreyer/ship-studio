/**
 * One rule in the cascade, as a card (Stacki anatomy):
 *   ┌ @  (wrap rule in an at-rule — top-level editable cards)
 *   │ [selector chip]                                   🗑 (delete)
 *   └ @  (add a nested at-rule inside the rule)
 *     property : value   rows…
 *     nested rule cards (recursive)
 *     + Add property                              styles.css (source chip)
 *
 * Read-only rules (inline / UA-or-framework / multi-file) render as a locked card.
 * Editing is driven by the structured `RuleBody` model (`lib/cssBody`); the card is
 * controlled — it emits a new body via `onChange`.
 */

import { useState } from 'react';
import { ChevronIcon } from '../icons/common';
import { LayersIcon } from '../icons/utility';
import { TrashIcon, FileIcon } from '../icons/editor';
import { DeclarationRow } from './DeclarationRow';
import { AddMenu } from './AddMenu';
import { suggestMediaConditions } from '../../lib/cssProperties';
import { NEST_ITEMS, WRAP_ITEMS, searchStructures } from '../../lib/cssStructures';
import {
  declarations,
  nestedRules,
  addDeclaration,
  addNestedRule,
  removeItem,
  replaceItem,
  moveDeclIntoNested,
  type Decl,
  type RuleBody,
} from '../../lib/cssBody';

interface CommonHeader {
  selector: string;
  file?: string;
  line?: number;
  mediaLabel?: string | null;
  /** The raw `@media` condition (e.g. `(max-width: 768px)`) — for editing the chip. */
  mediaText?: string | null;
  layer?: string | null;
  /** Nesting depth (0 = top-level rule), for indentation. */
  depth?: number;
  /** The rule's @media/@container condition doesn't match the current preview
   *  viewport — the whole card is dimmed and its declarations don't apply now. */
  inactive?: boolean;
}

interface EditableCard extends CommonHeader {
  editable: true;
  body: RuleBody;
  /** Lowercased property names the cascade reports overridden (struck-through). */
  overridden: Map<string, string>;
  onChange: (body: RuleBody) => void;
  /** Present for nested rules — makes the selector chip an editable input. */
  onSelectorChange?: (selector: string) => void;
  /** Present for top-level editable rules — wrap the rule in an at-rule (`@` above). */
  onWrap?: (atPrelude: string) => void;
  /** Present for top-level editable rules — delete the whole rule (🗑). */
  onDelete?: () => void;
  /** Present for top-level editable rules — click-to-edit the selector (any selector). */
  onRename?: (newSelector: string) => void;
  /** Class-name suggestions (e.g. `.btn`) for the selector autocomplete. */
  selectorSuggestions?: string[];
  /** Present for top-level editable rules inside an `@media` — edit its condition. */
  onRenameAtRule?: (newMedia: string) => void;
  /** Project CSS variables (`--foo`) for `var(--…)` value autocomplete. */
  variables?: string[];
}

interface ReadonlyCard extends CommonHeader {
  editable: false;
  decls: Decl[];
  overridden: Map<string, string>;
  readonlyReason?: string;
}

type Props = EditableCard | ReadonlyCard;

const basename = (path: string) => path.split('/').pop() ?? path;

/** A top-level rule's selector as ONE intelligent field — just like writing real
 *  CSS. Type a selector (class names autocomplete from the project) to rename the
 *  rule; type `@…` and it suggests conditions (`@media`, `@container`, `@supports`)
 *  and wraps the rule to scope it. No separate "when" box — one field does both. */
function SelectorChip({
  selector,
  suggestions,
  onCommit,
  onWrap,
}: {
  selector: string;
  suggestions: string[];
  onCommit: (newSelector: string) => void;
  /** Wrap the rule in a condition when the user types an `@`-rule. */
  onWrap?: (prelude: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(selector);
  const [active, setActive] = useState(0);

  if (!editing) {
    return (
      <code
        className="ss-card__selector-chip ss-card__selector-chip--editable"
        title="Click to edit — type a selector, or @media (…) to scope this rule"
        role="button"
        tabIndex={0}
        onClick={() => {
          setText(selector);
          setActive(0);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setText(selector);
            setActive(0);
            setEditing(true);
          }
        }}
      >
        {selector}
      </code>
    );
  }

  const typed = text.trim();
  const isCondition = typed.startsWith('@');
  // Typing `@…` switches the field into condition mode (wrap the rule); otherwise
  // it autocompletes the project's class names (rename the rule).
  const matches: { label: string; value: string; hint?: string }[] = isCondition
    ? [
        ...(typed.length > 1 && !WRAP_ITEMS.some((w) => w.insert === typed)
          ? [{ label: typed, value: typed, hint: 'new condition' }]
          : []),
        ...searchStructures(WRAP_ITEMS, typed).map((w) => ({
          label: w.label,
          value: w.insert,
          hint: w.hint,
        })),
      ]
    : (typed
        ? suggestions.filter((s) => s.toLowerCase().includes(typed.toLowerCase()))
        : suggestions
      )
        .slice(0, 8)
        .map((s) => ({ label: s, value: s }));

  const commit = (value: string) => {
    const v = value.trim();
    if (!v) {
      setEditing(false);
      return;
    }
    if (v.startsWith('@'))
      onWrap?.(v); // scope the rule in a condition
    else if (v !== selector) onCommit(v); // rename the selector
    setEditing(false);
  };

  return (
    <span className="ss-card__chip-edit ss-card__selector-edit">
      <input
        className="ss-card__selector-chip ss-card__selector-chip--input"
        autoFocus
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-label="Rule selector"
        placeholder="selector, or @media (…) to scope it"
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(matches[active]?.value ?? text);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText(selector);
            setEditing(false);
          }
        }}
        onBlur={() => setEditing(false)}
      />
      {matches.length > 0 && (
        <span className="ss-add-menu ss-card__chip-menu ss-card__chip-menu--left">
          <span className="ss-add-menu__list">
            {matches.map((m, i) => (
              <button
                key={m.value}
                type="button"
                className={`ss-add-menu__item${active === i ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(m.value)}
              >
                <code className="ss-add-menu__label">{m.label}</code>
                {m.hint && <span className="ss-add-menu__hint">{m.hint}</span>}
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

/** A nested rule's selector — a live input with autocomplete over the modern nesting
 *  vocabulary (`&:hover`, `&:nth-child(2n)`, `&::before`, `&:has(…)`, `& .child`) plus
 *  the project's classes. Controlled: edits the body on every keystroke. */
function NestedSelectorInput({
  value,
  suggestions,
  onChange,
}: {
  value: string;
  suggestions: string[];
  onChange: (selector: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);

  const typed = value.trim();
  // Curated nesting vocab matched on label/hint/keywords (so "even" finds
  // &:nth-child), plus the project's classes as `& .class`.
  const q = typed.toLowerCase();
  const curated = searchStructures(NEST_ITEMS, typed).map((i) => i.insert);
  const classMatches = suggestions
    .map((s) => `& ${s}`)
    .filter((p) => !q || p.toLowerCase().includes(q));
  const matches = [...curated, ...classMatches].slice(0, 8);
  const showMenu = focused && matches.length > 0 && !(matches.length === 1 && matches[0] === value);

  return (
    <span className="ss-card__chip-edit ss-card__selector-edit">
      <input
        className="ss-card__selector-chip ss-card__selector-chip--input"
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-label="Nested selector"
        placeholder="&:hover, &:nth-child(2n), & .child…"
        onFocus={() => {
          setFocused(true);
          setActive(0);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (!showMenu) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onChange(matches[active]);
            setFocused(false);
          } else if (e.key === 'Escape') {
            setFocused(false);
          }
        }}
        onBlur={() => setFocused(false)}
      />
      {showMenu && (
        <span className="ss-add-menu ss-card__chip-menu ss-card__chip-menu--left">
          <span className="ss-add-menu__list">
            {matches.map((s, i) => (
              <button
                key={s}
                type="button"
                className={`ss-add-menu__item${active === i ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s);
                  setFocused(false);
                }}
              >
                <code className="ss-add-menu__label">{s}</code>
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

/** A click-to-edit `@media` condition chip (shows the compact label, edits the raw
 *  condition with a native datalist of common conditions). */
function MediaChip({
  label,
  condition,
  onCommit,
}: {
  label: string;
  condition: string;
  onCommit: (newMedia: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(condition);
  const [active, setActive] = useState(0);
  if (!editing) {
    return (
      <span
        className="ss-card__chip ss-card__chip--media ss-card__chip--editable"
        title={`${condition} — click to edit`}
        role="button"
        tabIndex={0}
        onClick={() => {
          setText(condition);
          setActive(0);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setText(condition);
            setActive(0);
            setEditing(true);
          }
        }}
      >
        {label}
      </span>
    );
  }
  const commit = (value: string) => {
    const v = value.trim();
    if (v && v !== condition) onCommit(v);
    setEditing(false);
  };
  const matches = suggestMediaConditions(text);
  return (
    <span className="ss-card__chip-edit">
      <input
        className="ss-card__chip ss-card__chip--media-input"
        autoFocus
        value={text}
        spellCheck={false}
        autoComplete="off"
        aria-label="Media condition"
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(matches[active] ?? text);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText(condition);
            setEditing(false);
          }
        }}
        onBlur={() => setEditing(false)}
      />
      {matches.length > 0 && (
        <span className="ss-add-menu ss-card__chip-menu">
          <span className="ss-add-menu__list">
            {matches.map((m, i) => (
              <button
                key={m}
                type="button"
                className={`ss-add-menu__item${active === i ? ' is-active' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(m)}
              >
                <code className="ss-add-menu__label">{m}</code>
              </button>
            ))}
          </span>
        </span>
      )}
    </span>
  );
}

function Chips({
  mediaLabel,
  mediaText,
  layer,
  onRenameAtRule,
}: Pick<CommonHeader, 'mediaLabel' | 'mediaText' | 'layer'> & {
  onRenameAtRule?: (newMedia: string) => void;
}) {
  return (
    <>
      {layer && (
        <span className="ss-card__chip ss-card__chip--layer">
          <LayersIcon size={10} />
          {layer}
        </span>
      )}
      {mediaLabel &&
        (onRenameAtRule && mediaText ? (
          <MediaChip label={mediaLabel} condition={mediaText} onCommit={onRenameAtRule} />
        ) : (
          <span className="ss-card__chip ss-card__chip--media">{mediaLabel}</span>
        ))}
    </>
  );
}

export function CascadeRuleCard(props: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const depth = props.depth ?? 0;
  const editable = props.editable;
  const inactive = props.inactive ?? false;
  const onRenameAtRule = props.editable ? props.onRenameAtRule : undefined;

  const selectorRow = (
    <div className="ss-card__selector-row">
      <button
        type="button"
        className={`ss-card__collapse${collapsed ? ' is-collapsed' : ''}`}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand rule' : 'Collapse rule'}
        onClick={() => setCollapsed((c) => !c)}
      >
        <ChevronIcon size={12} />
      </button>
      {editable && props.onSelectorChange ? (
        <NestedSelectorInput
          value={props.selector}
          suggestions={props.selectorSuggestions ?? []}
          onChange={(sel) => props.onSelectorChange?.(sel)}
        />
      ) : props.editable && props.onRename ? (
        <SelectorChip
          selector={props.selector}
          suggestions={props.selectorSuggestions ?? []}
          onCommit={props.onRename}
          onWrap={props.onWrap}
        />
      ) : (
        <code className="ss-card__selector-chip" title={props.selector}>
          {props.selector}
        </code>
      )}
      <span className="ss-card__head-spacer" />
      <Chips
        mediaLabel={props.mediaLabel}
        mediaText={props.mediaText}
        layer={props.layer}
        onRenameAtRule={onRenameAtRule}
      />
      {inactive && (
        <span
          className="ss-card__chip ss-card__chip--inactive"
          title="This condition doesn't match the current preview size — these styles aren't applying right now"
        >
          inactive
        </span>
      )}
      {!editable && <span className="ss-card__src ss-card__src--ro">read-only</span>}
      {editable && props.onDelete && (
        <button
          type="button"
          className="ss-card__trash"
          title="Delete rule"
          aria-label="Delete rule"
          onClick={props.onDelete}
        >
          <TrashIcon size={12} />
        </button>
      )}
    </div>
  );

  if (!editable) {
    return (
      <section
        className={`ss-card is-readonly${depth ? ' is-nested' : ''}${collapsed ? ' is-collapsed' : ''}${inactive ? ' is-inactive' : ''}`}
        data-testid="cascade-card"
      >
        <header className="ss-card__head">{selectorRow}</header>
        {!collapsed && (
          <div className="ss-card__body">
            {props.decls.map((d, i) => (
              <DeclarationRow
                key={`${d.prop}-${i}`}
                editable={false}
                decl={d}
                overridden={props.overridden.has(d.prop.toLowerCase())}
                overriddenBy={props.overridden.get(d.prop.toLowerCase())}
              />
            ))}
            {props.readonlyReason && <p className="ss-card__note">{props.readonlyReason}</p>}
          </div>
        )}
      </section>
    );
  }

  const { body, onChange, overridden } = props;
  const decls = declarations(body);
  const nested = nestedRules(body);

  return (
    <section
      className={`ss-card${depth ? ' is-nested' : ''}${collapsed ? ' is-collapsed' : ''}${inactive ? ' is-inactive' : ''}`}
      data-testid="cascade-card"
    >
      <header className="ss-card__head">{selectorRow}</header>

      {!collapsed && (
        <div className="ss-card__body">
          {decls.map((d) => (
            <DeclarationRow
              key={d.index}
              editable
              decl={{ prop: d.prop, value: d.value, important: d.important }}
              overridden={overridden.has(d.prop.toLowerCase())}
              overriddenBy={overridden.get(d.prop.toLowerCase())}
              nestTargets={nested.map((r) => r.selector)}
              variables={props.variables}
              onChange={(next) => onChange(replaceItem(body, d.index, { kind: 'decl', ...next }))}
              onRemove={() => onChange(removeItem(body, d.index))}
              onNest={(sel) => onChange(moveDeclIntoNested(body, d.index, sel))}
            />
          ))}

          {nested.map((r) => (
            <CascadeRuleCard
              key={r.index}
              editable
              depth={depth + 1}
              selector={r.selector}
              overridden={new Map()}
              body={r.body}
              variables={props.variables}
              selectorSuggestions={props.selectorSuggestions}
              onChange={(nextBody) =>
                onChange(
                  replaceItem(body, r.index, { kind: 'rule', selector: r.selector, body: nextBody })
                )
              }
              onSelectorChange={(sel) =>
                onChange(replaceItem(body, r.index, { kind: 'rule', selector: sel, body: r.body }))
              }
              onDelete={() => onChange(removeItem(body, r.index))}
            />
          ))}

          <footer className="ss-card__foot">
            <AddMenu
              onAddProperty={(prop) =>
                onChange(addDeclaration(body, { prop, value: '', important: false }))
              }
              onNest={(sel) => onChange(addNestedRule(body, sel))}
            />
            {props.file && (
              <span className="ss-card__src-chip" title={`${props.file}:${props.line}`}>
                <FileIcon size={11} />
                {basename(props.file)}
              </span>
            )}
          </footer>
        </div>
      )}
    </section>
  );
}
