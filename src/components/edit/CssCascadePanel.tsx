/**
 * Code-first CSS editor panel (vanilla-CSS projects) — the structured cascade card
 * GUI. Click an element → its whole cascade renders as a stack of cards (one per
 * rule, in cascade order), each rule's properties as editable GUI rows, nested
 * rules as nested cards. A GUI layer on real CSS, not abstracted controls.
 *
 * Shares the `ss-edit-panel` chrome (draggable header, pin, close) with the other
 * editor panels.
 */

import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PinIcon } from '../icons/layout';
import { CloseIcon } from '../icons/common';
import { PlusIcon } from '../icons/utility';
import { Spinner } from '../primitives/Spinner';
import { CascadeRuleCard } from './CascadeRuleCard';
import { ElementSettingsPanel } from './ElementSettingsPanel';
import { CssVariablesPanel } from './CssVariablesPanel';
import { CssAnimationsPanel } from './CssAnimationsPanel';
import { SuggestionPopover, type Suggestion } from './SuggestionPopover';
import { WRAP_ITEMS, searchStructures } from '../../lib/cssStructures';
import { mediaChipLabel, rowKey, type CascadeRow } from '../../lib/cssCascade';
import type { RuleBody } from '../../lib/cssBody';
import type { CascadeSelection } from '../../hooks/useCssCascadeEditor';
import type { ElementSettings } from '../../hooks/useElementSettings';
import type { useCssVariables } from '../../hooks/useCssVariables';
import type { useCssAnimations } from '../../hooks/useCssAnimations';

/** The panel's scope: the selected element, or the project-global tokens/animations. */
type Scope = 'element' | 'variables' | 'animations';

const PANEL_WIDTH = 360;

interface Props {
  selection: CascadeSelection | null;
  rows: CascadeRow[];
  loading: boolean;
  bodies: Record<string, RuleBody>;
  overridden: Record<string, Map<string, string>>;
  onChangeBody: (key: string, body: RuleBody) => void;
  onDeleteRule: (key: string) => void;
  onWrapRule: (key: string, atPrelude: string) => void;
  onRenameRule: (key: string, newSelector: string) => void;
  onRenameAtRule: (key: string, newMedia: string) => void;
  onAddSelector: (selector: string) => void;
  /** `.class` suggestions for the selector autocomplete. */
  selectorSuggestions: string[];
  /** Full text of every existing rule selector (`.card`, `@keyframes reveal`) — shown
   *  in "Add selector" so existing rules are discoverable and re-surfaced on a match. */
  existingSelectors: string[];
  /** Project CSS variables (`--foo`) for `var(--…)` value autocomplete. */
  variables: string[];
  /** Project `@keyframes` names for `animation` value autocomplete. */
  animations: string[];
  settings: ElementSettings;
  /** Project-global Variables editor state (custom properties / design tokens). */
  variablesState: ReturnType<typeof useCssVariables>;
  /** Project-global Animations editor state (`@keyframes`). */
  animationsState: ReturnType<typeof useCssAnimations>;
  onClose: () => void;
  pinned?: boolean;
  onTogglePin?: () => void;
}

export function CssCascadePanel({
  selection,
  rows,
  loading,
  bodies,
  overridden,
  onChangeBody,
  onDeleteRule,
  onWrapRule,
  onRenameRule,
  onRenameAtRule,
  onAddSelector,
  selectorSuggestions,
  existingSelectors,
  variables,
  animations,
  settings,
  variablesState,
  animationsState,
  onClose,
  pinned,
  onTogglePin,
}: Props) {
  const [tab, setTab] = useState<'style' | 'settings'>('style');
  const [scope, setScope] = useState<Scope>('element');
  // Collapse state keyed by rule identity (selector + media), not the per-element row
  // key — so minimizing a shared rule like `*` keeps it minimized across element
  // switches. Lives on the panel (which stays mounted), so it survives reselection.
  const [collapsedRules, setCollapsedRules] = useState<Set<string>>(() => new Set());
  const toggleCollapsed = useCallback((ruleKey: string) => {
    setCollapsedRules((prev) => {
      const next = new Set(prev);
      if (next.has(ruleKey)) next.delete(ruleKey);
      else next.add(ruleKey);
      return next;
    });
  }, []);
  const [pos, setPos] = useState(() => ({
    top: 76,
    left: Math.max(
      8,
      (typeof window !== 'undefined' ? window.innerWidth : 1280) - PANEL_WIDTH - 24
    ),
  }));
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onHeaderPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.ss-edit-panel__header-actions')) return;
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onHeaderPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const w = rootRef.current?.offsetWidth ?? PANEL_WIDTH;
    const left = Math.max(8, Math.min(e.clientX - d.dx, window.innerWidth - w - 8));
    const top = Math.max(8, Math.min(e.clientY - d.dy, window.innerHeight - 40));
    setPos({ top, left });
  }, []);
  const onHeaderPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  const classes = (selection?.signature.className ?? '').split(/\s+/).filter(Boolean);
  // The element's own classes lead the "Add selector" suggestions (so a class you
  // just added in Settings is one click away from getting a rule), then the rest of
  // the project's classes, then every existing rule selector (incl. `@keyframes …`)
  // so what's already defined is discoverable and re-openable rather than duplicated.
  const addSelectorOptions = [
    ...new Set([...classes.map((c) => `.${c}`), ...selectorSuggestions, ...existingSelectors]),
  ];

  return (
    <div
      ref={rootRef}
      className={`ss-edit-panel ss-cascade-panel${pinned ? ' ss-edit-panel--pinned' : ''}`}
      data-testid="css-cascade-panel"
      style={
        pinned
          ? undefined
          : {
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              right: 'auto',
              zIndex: 1000,
              maxHeight: `min(680px, calc(100vh - ${pos.top + 16}px))`,
            }
      }
    >
      <div
        className="ss-edit-panel__header"
        onPointerDown={pinned ? undefined : onHeaderPointerDown}
        onPointerMove={pinned ? undefined : onHeaderPointerMove}
        onPointerUp={pinned ? undefined : onHeaderPointerUp}
      >
        <span className="ss-edit-panel__title">CSS</span>
        <span className="ss-edit-panel__header-actions">
          {onTogglePin && (
            <button
              className={`ss-edit-panel__pin${pinned ? ' is-pinned' : ''}`}
              onClick={onTogglePin}
              title={pinned ? 'Unpin — float over the preview' : 'Pin as sidebar'}
              aria-pressed={pinned}
            >
              <PinIcon size={13} />
            </button>
          )}
          <button className="ss-edit-panel__close" onClick={onClose} aria-label="Exit edit mode">
            <CloseIcon size={14} />
          </button>
        </span>
      </div>

      <div className="ss-edit-panel__body">
        <div className="ss-cascade-scope" role="tablist" aria-label="CSS scope">
          {(['element', 'variables', 'animations'] as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              className={`ss-cascade-scope__tab${scope === s ? ' is-active' : ''}`}
              onClick={() => {
                setScope(s);
                if (s === 'variables') void variablesState.reload();
                else if (s === 'animations') void animationsState.reload();
              }}
            >
              {s === 'element' ? 'Element' : s === 'variables' ? 'Variables' : 'Animations'}
            </button>
          ))}
        </div>

        {scope === 'variables' ? (
          <CssVariablesPanel
            variables={variablesState.variables}
            loading={variablesState.loading}
            variableNames={variables}
            onSetValue={variablesState.setValue}
            onAddVariable={(n, v) => void variablesState.addVariable(n, v)}
          />
        ) : scope === 'animations' ? (
          <CssAnimationsPanel
            animations={animationsState.animations}
            loading={animationsState.loading}
            selectorSuggestions={selectorSuggestions}
            variables={variables}
            onChangeBody={animationsState.setBody}
            onDelete={(s) => void animationsState.remove(s)}
            onCreate={(n) => void animationsState.create(n)}
            onRename={(s, n) => void animationsState.rename(s, n)}
          />
        ) : !selection ? (
          <p className="ss-cascade-empty">Click an element to see the CSS that styles it.</p>
        ) : (
          <>
            <div className="ss-cascade-target">
              <code className="ss-cascade-target__tag">{selection.signature.tagName}</code>
              {classes.length > 0 && (
                <span className="ss-cascade-target__classes">
                  {classes.map((c) => (
                    <code key={c} className="ss-cascade-target__class">
                      .{c}
                    </code>
                  ))}
                </span>
              )}
              {selection.instanceCount > 1 && (
                <span className="ss-cascade-target__count">×{selection.instanceCount}</span>
              )}
            </div>

            <div className="ss-cascade-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'style'}
                className={`ss-cascade-tab${tab === 'style' ? ' is-active' : ''}`}
                onClick={() => setTab('style')}
              >
                Style
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'settings'}
                className={`ss-cascade-tab${tab === 'settings' ? ' is-active' : ''}`}
                onClick={() => setTab('settings')}
              >
                Settings
              </button>
            </div>

            {tab === 'settings' ? (
              <ElementSettingsPanel settings={settings} />
            ) : (
              <>
                <AddSelectorBar
                  onAddSelector={onAddSelector}
                  suggestions={addSelectorOptions}
                  existing={existingSelectors}
                />

                {loading ? (
                  <div className="ss-cascade-loading">
                    <Spinner size="sm" />
                  </div>
                ) : (
                  <div className="ss-cascade-cards">
                    {rows.map((row) => {
                      const key = rowKey(row);
                      const media = mediaChipLabel(row);
                      // Stable across element switches (unlike `key`, which embeds the row index).
                      const collapseKey = `${row.selector ?? ''}|${row.mediaText ?? ''}`;
                      const collapsed = collapsedRules.has(collapseKey);
                      const onToggleCollapse = () => toggleCollapsed(collapseKey);
                      if (row.editable && bodies[key]) {
                        return (
                          <CascadeRuleCard
                            key={key}
                            editable
                            selector={row.selector ?? ''}
                            file={row.file}
                            line={row.line}
                            mediaLabel={media}
                            mediaText={row.mediaText}
                            layer={row.layer}
                            inactive={row.inactiveMedia}
                            overridden={
                              row.inactiveMedia ? new Map() : (overridden[key] ?? new Map())
                            }
                            body={bodies[key]}
                            draft={row.draft}
                            onChange={(b) => onChangeBody(key, b)}
                            onDelete={() => onDeleteRule(key)}
                            // A draft rule doesn't exist in source yet — no rename/wrap
                            // until it's created (by adding the first property).
                            onWrap={row.draft ? undefined : (at) => onWrapRule(key, at)}
                            onRename={row.draft ? undefined : (s) => onRenameRule(key, s)}
                            onRenameAtRule={row.draft ? undefined : (m) => onRenameAtRule(key, m)}
                            selectorSuggestions={selectorSuggestions}
                            variables={variables}
                            animations={animations}
                            collapsed={collapsed}
                            onToggleCollapse={onToggleCollapse}
                          />
                        );
                      }
                      return (
                        <CascadeRuleCard
                          key={key}
                          editable={false}
                          collapsed={collapsed}
                          onToggleCollapse={onToggleCollapse}
                          selector={row.selector ?? 'element.style'}
                          file={row.file}
                          line={row.line}
                          mediaLabel={media}
                          mediaText={row.mediaText}
                          layer={row.layer}
                          inactive={row.inactiveMedia}
                          overridden={
                            row.inactiveMedia ? new Map() : (overridden[key] ?? new Map())
                          }
                          readonlyReason={row.readonlyReason}
                          decls={row.declarations.map((d) => ({
                            prop: d.prop,
                            value: d.value,
                            important: d.important,
                          }))}
                        />
                      );
                    })}

                    {rows.length === 0 && (
                      <p className="ss-cascade-empty">No CSS rules match this element.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** "Add selector" affordance: a button that expands to a selector input with a
 *  live autocomplete of the project's class names (and a "new rule" row for free
 *  text), creating a new rule for the element. */
function AddSelectorBar({
  onAddSelector,
  suggestions,
  existing,
}: {
  onAddSelector: (selector: string) => void;
  suggestions: string[];
  /** Selectors that already have a rule — tagged "existing" and re-opened on pick. */
  existing: string[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const submit = (value: string) => {
    const v = value.trim();
    if (v) onAddSelector(v);
    setText('');
    setActive(0);
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="ss-cascade-add-selector" onClick={() => setOpen(true)}>
        <PlusIcon size={11} /> Add selector
      </button>
    );
  }

  const typed = text.trim();
  const existingSet = new Set(existing);
  // Typing `@` switches to CONDITIONS: create a new rule for this element scoped to a
  // breakpoint. Only `@media` is offered (a rule inside `@container`/`@supports` would
  // collide with the element's base rule on save); use the selector chip's `@`-wrap to
  // scope an existing rule under those. `@keyframes` isn't an element rule at all.
  let items: Suggestion[];
  if (typed.startsWith('@')) {
    const mediaItems = searchStructures(WRAP_ITEMS, typed).filter((w) =>
      w.insert.startsWith('@media')
    );
    const showFree = typed.length > 1 && !mediaItems.some((w) => w.insert === typed);
    items = [
      ...(showFree ? [{ value: typed, label: typed, hint: 'new condition' }] : []),
      ...mediaItems.map((w) => ({ value: w.insert, label: w.label, hint: w.hint })),
    ];
  } else {
    const selectorMatches = (
      typed ? suggestions.filter((s) => s.toLowerCase().includes(typed.toLowerCase())) : suggestions
    )
      .filter((s) => !s.trim().startsWith('@'))
      .slice(0, 10);
    const showCreate = typed.length > 0 && !selectorMatches.includes(typed);
    items = [
      ...(showCreate ? [{ value: typed, label: typed, hint: 'new rule' }] : []),
      // Existing rules are tagged so it's clear picking one re-opens it (no duplicate).
      ...selectorMatches.map((s) => ({
        value: s,
        label: s,
        hint: existingSet.has(s) ? 'existing' : undefined,
      })),
    ];
  }

  return (
    <div className="ss-cascade-add-selector__wrap">
      <input
        className="ss-cascade-add-selector__input"
        autoFocus
        value={text}
        spellCheck={false}
        autoComplete="off"
        placeholder="New selector (.card, h1.title) or @media (…)"
        onFocus={(e) => setAnchorEl(e.currentTarget)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(items[active]?.value ?? text);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText('');
            setOpen(false);
          }
        }}
        onBlur={() => setOpen(false)}
      />
      <SuggestionPopover
        anchor={anchorEl}
        items={items}
        active={active}
        onPick={submit}
        width={280}
      />
    </div>
  );
}
