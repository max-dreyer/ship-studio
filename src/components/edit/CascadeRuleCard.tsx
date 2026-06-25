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

import { useId, useState } from 'react';
import { ChevronIcon } from '../icons/common';
import { LayersIcon } from '../icons/utility';
import { TrashIcon, FileIcon } from '../icons/editor';
import { DeclarationRow } from './DeclarationRow';
import { AddPropertyRow } from './AddPropertyRow';
import { AtRuleButton } from './AtRuleButton';
import { suggestMediaConditions } from '../../lib/cssProperties';
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
}

interface ReadonlyCard extends CommonHeader {
  editable: false;
  decls: Decl[];
  overridden: Map<string, string>;
  readonlyReason?: string;
}

type Props = EditableCard | ReadonlyCard;

const basename = (path: string) => path.split('/').pop() ?? path;

/** A top-level rule's selector: a chip you click to edit into ANY selector, with a
 *  native datalist of the project's class names. Commits on Enter/blur. */
function SelectorChip({
  selector,
  suggestions,
  onCommit,
}: {
  selector: string;
  suggestions: string[];
  onCommit: (newSelector: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(selector);
  const listId = useId();

  if (!editing) {
    return (
      <code
        className="ss-card__selector-chip ss-card__selector-chip--editable"
        title="Click to edit selector"
        role="button"
        tabIndex={0}
        onClick={() => {
          setText(selector);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setText(selector);
            setEditing(true);
          }
        }}
      >
        {selector}
      </code>
    );
  }

  const commit = () => {
    const v = text.trim();
    if (v && v !== selector) onCommit(v);
    setEditing(false);
  };
  return (
    <>
      <input
        className="ss-card__selector-chip ss-card__selector-chip--input"
        autoFocus
        value={text}
        list={listId}
        spellCheck={false}
        autoComplete="off"
        aria-label="Rule selector"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setText(selector);
            setEditing(false);
          }
        }}
        onBlur={commit}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
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
  const listId = useId();
  if (!editing) {
    return (
      <span
        className="ss-card__chip ss-card__chip--media ss-card__chip--editable"
        title={`${condition} — click to edit`}
        role="button"
        tabIndex={0}
        onClick={() => {
          setText(condition);
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            setText(condition);
            setEditing(true);
          }
        }}
      >
        {label}
      </span>
    );
  }
  const commit = () => {
    const v = text.trim();
    if (v && v !== condition) onCommit(v);
    setEditing(false);
  };
  return (
    <>
      <input
        className="ss-card__chip ss-card__chip--media-input"
        autoFocus
        value={text}
        list={listId}
        spellCheck={false}
        autoComplete="off"
        aria-label="Media condition"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setText(condition);
            setEditing(false);
          }
        }}
        onBlur={commit}
      />
      <datalist id={listId}>
        {suggestMediaConditions('').map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
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
        <input
          className="ss-card__selector-chip ss-card__selector-chip--input"
          value={props.selector}
          spellCheck={false}
          autoComplete="off"
          aria-label="Nested selector"
          onChange={(e) => props.onSelectorChange?.(e.target.value)}
        />
      ) : editable && props.onRename ? (
        <SelectorChip
          selector={props.selector}
          suggestions={props.selectorSuggestions ?? []}
          onCommit={props.onRename}
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
        className={`ss-card is-readonly${depth ? ' is-nested' : ''}${collapsed ? ' is-collapsed' : ''}`}
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

  const { body, onChange, overridden, onWrap } = props;
  const decls = declarations(body);
  const nested = nestedRules(body);

  return (
    <section
      className={`ss-card${depth ? ' is-nested' : ''}${collapsed ? ' is-collapsed' : ''}`}
      data-testid="cascade-card"
    >
      <header className="ss-card__head">
        {onWrap && (
          <AtRuleButton
            label="Add parent"
            title="Wrap this rule in a parent at-rule (e.g. @media)"
            onSubmit={onWrap}
          />
        )}
        {selectorRow}
        <AtRuleButton
          label="Add child"
          title="Add a nested child rule (at-rule or selector like &:hover)"
          onSubmit={(prelude) => onChange(addNestedRule(body, prelude))}
        />
      </header>

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
            <AddPropertyRow
              onAdd={(prop) =>
                onChange(addDeclaration(body, { prop, value: '', important: false }))
              }
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
