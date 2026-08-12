/**
 * Webflow-style view of the cascade panel: sectioned controls instead of
 * declaration rows.
 *
 * The cascade cards show every rule that touches the element. This view picks
 * ONE of them — the winning editable rule — and offers the structured controls
 * for it. That's the trade Webflow makes: you lose sight of the cascade, and
 * gain controls that fit the property.
 *
 * Which rule is being edited stays visible in the header, because unlike
 * Webflow, the rule here isn't implied by a class chip: a vanilla-CSS project
 * can style the same element from several places.
 *
 * Writes go through `setBody`, which debounces both the in-iframe preview and
 * the source write, so a drag costs one save.
 *
 * @module components/edit/CssVisualView
 */

import { useState } from 'react';
import { CssControls } from './CssControls';
import { CSS_CATEGORIES } from '../../lib/cssControls';
import { declarations, type RuleBody } from '../../lib/cssBody';
import { setBodyProperties, setBodyProperty } from '../../lib/cssBodyEdit';
import type { CssDeclaration } from '../../lib/edit-css';

interface Props {
  /** The rule being edited, already resolved by the panel. */
  rule: { key: string; selector: string; file?: string | null; body: RuleBody } | null;
  onChangeBody: (key: string, body: RuleBody) => void;
}

/** Sections that start collapsed — the long tail, as in the cascade view. */
function defaultOpen(id: string): boolean {
  return !['child', 'position', 'transform', 'effects'].includes(id);
}

export function CssVisualView({ rule, onChangeBody }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});

  if (!rule) {
    return (
      <p className="ss-visual__empty">
        No editable rule for this element yet. Add one with “Add selector” above, then style it
        here.
      </p>
    );
  }

  // The controls speak CssDeclaration; the body speaks Decl.
  const decls: CssDeclaration[] = declarations(rule.body).map((d) => ({
    property: d.prop,
    value: d.value,
    important: d.important,
  }));

  const write = (property: string, value: string | null) =>
    onChangeBody(rule.key, setBodyProperty(rule.body, property, value));

  const writeMany = (changes: { property: string; value: string | null }[]) =>
    onChangeBody(rule.key, setBodyProperties(rule.body, changes));

  return (
    <div className="ss-visual">
      <div className="ss-visual__target">
        <code className="ss-css-selector">{rule.selector}</code>
        {rule.file && (
          <span className="ss-css-file" title={rule.file}>
            {rule.file.split('/').pop()}
          </span>
        )}
      </div>
      {CSS_CATEGORIES.filter((c) => c.id !== 'custom').map((cat) => (
        <details
          key={cat.id}
          className="ss-edit-panel__section"
          open={open[cat.id] ?? defaultOpen(cat.id)}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setOpen((o) => ({ ...o, [cat.id]: isOpen }));
          }}
        >
          <summary className="ss-edit-panel__section-head">
            <span className="ss-edit-panel__section-row">
              <span className="ss-edit-panel__section-title">{cat.label}</span>
            </span>
          </summary>
          <div className="ss-edit-panel__section-body">
            <CssControls
              category={cat.id}
              declarations={decls}
              onPreview={write}
              onSave={write}
              onSaveMany={writeMany}
            />
          </div>
        </details>
      ))}
    </div>
  );
}
