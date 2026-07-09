/**
 * Live verification checklist beside the guided agent terminal.
 *
 * The source of truth for "done" — rows tick green as the app's own
 * `get_full_setup_status` checks pass, never on the agent's say-so.
 */

import { SetupItem, SETUP_FRIENDLY_NAMES } from '../../../lib/setup';
import { AGENT_LED_REQUIRED_ITEM_IDS } from '../../../lib/agentOnboarding';

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="var(--success)" />
      <path
        d="M6 10l3 3 5-6"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface ChecklistRow {
  id: string;
  label: string;
  ready: boolean;
}

interface SetupChecklistProps {
  items: SetupItem[];
  /** Binary id of the agent chosen in Phase 0 (ready by construction). */
  agentBinaryId: string;
  /** Display name of the chosen agent. */
  agentDisplayName: string;
}

export function SetupChecklist({ items, agentBinaryId, agentDisplayName }: SetupChecklistProps) {
  const rows: ChecklistRow[] = [
    {
      id: agentBinaryId,
      label: agentDisplayName,
      ready:
        items.find((i) => i.id === agentBinaryId)?.status === 'ready' &&
        items.find((i) => i.id === `${agentBinaryId}_auth`)?.status === 'ready',
    },
    // Required items, in install order. Absent items (e.g. npm_fix once
    // permissions are fine) simply don't get a row.
    ...AGENT_LED_REQUIRED_ITEM_IDS.map((id) => items.find((i) => i.id === id))
      .filter((item): item is SetupItem => item !== undefined)
      .map((item) => ({
        id: item.id,
        label: SETUP_FRIENDLY_NAMES[item.id] ?? item.friendlyName,
        ready: item.status === 'ready',
      })),
  ];

  return (
    <div className="agent-setup-checklist" aria-label="Setup progress">
      <h3 className="agent-setup-checklist-title">Setup checklist</h3>
      <p className="agent-setup-checklist-hint">
        Ship Studio verifies each item itself — they turn green as real checks pass.
      </p>
      <ul className="agent-setup-checklist-items">
        {rows.map((row) => (
          <li
            key={row.id}
            className={`agent-setup-checklist-item ${row.ready ? 'ready' : ''}`}
            aria-label={`${row.label}: ${row.ready ? 'ready' : 'pending'}`}
          >
            {row.ready ? <CheckIcon /> : <span className="agent-setup-checklist-dot" />}
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
