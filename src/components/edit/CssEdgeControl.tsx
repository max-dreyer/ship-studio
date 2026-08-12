/**
 * Per-edge / per-corner control for borders and radii.
 *
 * A row of targets (All, then each side or corner) picks what the field below
 * edits, the way Webflow's border and radius controls work. Picking "All"
 * writes the shorthand and clears the longhands; picking one part expands the
 * shorthand first so the rule can't contradict itself.
 *
 * The target selection is local UI state — it says which part you're editing,
 * not what the CSS says.
 *
 * @module components/edit/CssEdgeControl
 */

import { useState } from 'react';
import { CssLengthField } from './CssLengthField';
import { ICONS } from './CssControlIcons';
import {
  isUniform,
  longhandFor,
  partsOf,
  readEdges,
  setEdge,
  type EdgeChange,
  type EdgeKind,
  type EdgePart,
} from '../../lib/cssEdges';
import type { CssDeclaration } from '../../lib/edit-css';

interface Props {
  kind: EdgeKind;
  declarations: CssDeclaration[];
  onPreview: (property: string, value: string | null) => void;
  onSaveMany: (changes: EdgeChange[]) => void;
  isValid: (value: string) => boolean;
}

/** Icon per target: the box with that side (or corner) drawn solid, so the row
 *  reads at a glance the way Webflow's edge picker does. */
const ICON_OF: Record<string, string> = {
  top: 'edge-top',
  right: 'edge-right',
  bottom: 'edge-bottom',
  left: 'edge-left',
  'top-left': 'corner-tl',
  'top-right': 'corner-tr',
  'bottom-right': 'corner-br',
  'bottom-left': 'corner-bl',
};

export function CssEdgeControl({ kind, declarations, onPreview, onSaveMany, isValid }: Props) {
  const [target, setTarget] = useState<EdgePart | null>(null);
  const parts = partsOf(kind);
  const edges = readEdges(declarations, kind);
  const uniform = isUniform(declarations, kind);

  // "All" shows the shared value; a specific target shows its own.
  const value = target === null ? (uniform ? (edges[parts[0]] ?? '') : '') : (edges[target] ?? '');
  const placeholder = target === null && !uniform ? 'Mixed' : '0';
  const prop = target === null ? kind : longhandFor(kind, target);

  const write = (next: string | null, commit: boolean) => {
    onPreview(prop, next);
    if (commit) onSaveMany(setEdge(declarations, kind, target, next));
  };

  return (
    <div className="ss-edge">
      <div className="ss-edge__targets" role="group" aria-label={`${kind} target`}>
        <button
          type="button"
          className={`ss-edge__target${target === null ? ' is-active' : ''}`}
          onClick={() => setTarget(null)}
          aria-pressed={target === null}
          title="All"
          aria-label="All"
        >
          {ICONS[kind === 'border-radius' ? 'radius-all' : 'edge-all']}
        </button>
        {parts.map((part) => (
          <button
            key={part}
            type="button"
            className={`ss-edge__target${target === part ? ' is-active' : ''}`}
            onClick={() => setTarget(part)}
            aria-pressed={target === part}
            aria-label={part}
            title={part}
          >
            {ICONS[ICON_OF[part]] ?? part}
          </button>
        ))}
      </div>
      <CssLengthField
        prop={kind === 'border-radius' ? 'border-radius' : 'border-width'}
        value={value}
        placeholder={placeholder}
        onPreview={(_p, v) => write(v, false)}
        onSave={(_p, v) => write(v, true)}
        isValid={isValid}
      />
    </div>
  );
}
