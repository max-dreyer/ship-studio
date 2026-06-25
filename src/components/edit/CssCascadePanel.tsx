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
import { SuggestionPopover, type Suggestion } from './SuggestionPopover';
import { mediaChipLabel, rowKey, type CascadeRow } from '../../lib/cssCascade';
import type { RuleBody } from '../../lib/cssBody';
import type { CascadeSelection } from '../../hooks/useCssCascadeEditor';
import type { ElementSettings } from '../../hooks/useElementSettings';

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
  /** Project CSS variables (`--foo`) for `var(--…)` value autocomplete. */
  variables: string[];
  settings: ElementSettings;
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
  variables,
  settings,
  onClose,
  pinned,
  onTogglePin,
}: Props) {
  const [tab, setTab] = useState<'style' | 'settings'>('style');
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
  // the project's classes.
  const addSelectorOptions = [...new Set([...classes.map((c) => `.${c}`), ...selectorSuggestions])];

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
        {!selection ? (
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
                <AddSelectorBar onAddSelector={onAddSelector} suggestions={addSelectorOptions} />

                {loading ? (
                  <div className="ss-cascade-loading">
                    <Spinner size="sm" />
                  </div>
                ) : rows.length === 0 ? (
                  <p className="ss-cascade-empty">No CSS rules match this element.</p>
                ) : (
                  <div className="ss-cascade-cards">
                    {rows.map((row) => {
                      const key = rowKey(row);
                      const media = mediaChipLabel(row);
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
                            onChange={(b) => onChangeBody(key, b)}
                            onDelete={() => onDeleteRule(key)}
                            onWrap={(at) => onWrapRule(key, at)}
                            onRename={(s) => onRenameRule(key, s)}
                            onRenameAtRule={(m) => onRenameAtRule(key, m)}
                            selectorSuggestions={selectorSuggestions}
                            variables={variables}
                          />
                        );
                      }
                      return (
                        <CascadeRuleCard
                          key={key}
                          editable={false}
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
}: {
  onAddSelector: (selector: string) => void;
  suggestions: string[];
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
  const classMatches = (
    typed ? suggestions.filter((s) => s.toLowerCase().includes(typed.toLowerCase())) : suggestions
  ).slice(0, 8);
  const showCreate = typed.length > 0 && !classMatches.includes(typed);
  const items: Suggestion[] = [
    ...(showCreate ? [{ value: typed, label: typed, hint: 'new rule' }] : []),
    ...classMatches.map((s) => ({ value: s, label: s })),
  ];

  return (
    <div className="ss-cascade-add-selector__wrap">
      <input
        className="ss-cascade-add-selector__input"
        autoFocus
        value={text}
        spellCheck={false}
        autoComplete="off"
        placeholder="New selector, e.g. .card or h1.title"
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
