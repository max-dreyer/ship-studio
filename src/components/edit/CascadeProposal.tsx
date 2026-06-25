/**
 * The "Send to agent" proposal editor shown inside a read-only cascade card. The
 * user tweaks the rule's declarations *visually* — preview-only, rendered as an
 * inline diff (old struck-through → new in accent) so it's unmistakably a proposal
 * and not a saved edit — then sends it to the agent to implement in real source.
 */

import { useState } from 'react';
import { EditPopover } from './EditPopover';
import { suggestValues } from '../../lib/cssProperties';
import type { CssProposal } from '../../hooks/useCssProposals';

interface Props {
  proposal: CssProposal;
  onEdit: (prop: string, to: string) => void;
  onSend: () => void;
  onDiscard: () => void;
}

export function CascadeProposal({ proposal, onEdit, onSend, onDiscard }: Props) {
  const [editing, setEditing] = useState<null | { prop: string; anchor: HTMLElement }>(null);
  const props = Object.keys(proposal.original);
  const count = Object.keys(proposal.edits).length;

  return (
    <div className="ss-proposal">
      {props.map((prop) => {
        const original = proposal.original[prop];
        const proposed = proposal.edits[prop];
        const changed = proposed !== undefined && proposed !== original;
        return (
          <div key={prop} className={`ss-proposal__row${changed ? ' is-changed' : ''}`}>
            <span className="ss-decl__prop">{prop}</span>
            <span className="ss-decl__colon">:</span>
            {changed && (
              <>
                <span className="ss-proposal__old">{original}</span>
                <span className="ss-proposal__arrow" aria-hidden="true">
                  →
                </span>
              </>
            )}
            <button
              type="button"
              className="ss-proposal__new ss-decl__edit"
              onClick={(e) => {
                const anchor = e.currentTarget;
                setEditing((cur) => (cur?.prop === prop ? null : { prop, anchor }));
              }}
            >
              {proposed ?? original}
            </button>
          </div>
        );
      })}

      <div className="ss-proposal__bar">
        <button type="button" className="ss-proposal__send" disabled={count === 0} onClick={onSend}>
          <BoltIcon /> Send to agent{count > 0 ? ` (${count})` : ''}
        </button>
        <button
          type="button"
          className="ss-proposal__discard"
          title="Discard proposal"
          aria-label="Discard proposal"
          onClick={onDiscard}
        >
          ✕
        </button>
      </div>

      {editing && (
        <EditPopover
          anchor={editing.anchor}
          initial={proposal.edits[editing.prop] ?? proposal.original[editing.prop]}
          options={suggestValues(editing.prop)}
          placeholder="value"
          onCommit={(value) => onEdit(editing.prop, value)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function BoltIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ flex: '0 0 auto' }}
    >
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}
