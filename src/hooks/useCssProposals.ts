/**
 * "Send to agent" proposals for the CSS cascade editor. When a rule can't be edited
 * deterministically (defined across multiple files, an inline style, a scoped
 * non-CSS block, …), the user can still tweak it *visually* — those edits are
 * preview-only (applied to the selected element in the iframe via `ss:mutate`, never
 * written to disk) and shown as an inline diff. "Send to agent" turns the proposal
 * into a precise prompt and injects it into the focused agent terminal to implement.
 *
 * State is keyed by the card's `rowKey`, so several read-only cards can each hold a
 * proposal. Nothing here touches source files — that's the whole point.
 */

import { useCallback, useState } from 'react';
import { useAgentBridge } from '../contexts/AgentBridgeContext';
import { useOptionalToast } from '../contexts/ToastContext';
import { buildCssChangePrompt, type ProposedCssChange } from '../lib/cssAgentPrompt';
import { trackEvent } from '../lib/analytics';

/** A live proposal for one rule: the element's current values plus the user's edits. */
export interface CssProposal {
  selector: string;
  readonlyReason?: string;
  files?: string[];
  /** Current value per property (for the `from` side of the diff). */
  original: Record<string, string>;
  /** Proposed value per property — only entries that differ from `original`. */
  edits: Record<string, string>;
}

/** The seed a card passes to `begin` — the rule's identity and its current decls. */
export interface ProposalSeed {
  selector: string;
  declarations: { prop: string; value: string }[];
  readonlyReason?: string;
  files?: string[];
}

interface Params {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** The selected element (for the agent prompt's "which element" context). */
  element: { tag: string; classes: string[] } | null;
  enabled: boolean;
}

export function useCssProposals({ iframeRef, element, enabled }: Params) {
  const { sendToAgent } = useAgentBridge();
  const { showToast } = useOptionalToast();
  const [proposals, setProposals] = useState<Record<string, CssProposal>>({});

  const post = useCallback(
    (msg: unknown) => iframeRef.current?.contentWindow?.postMessage(msg, '*'),
    [iframeRef]
  );

  /** Apply (or clear, with `null`) preview overrides on the selected element. */
  const preview = useCallback(
    (decls: Record<string, string | null>) => {
      if (!Object.keys(decls).length) return;
      post({ type: 'ss:mutate', rules: [{ minPx: 0, decls }] });
    },
    [post]
  );

  const isProposing = useCallback((key: string) => key in proposals, [proposals]);

  /** Start (or re-focus) a proposal for a card, seeding the current declarations. */
  const begin = useCallback(
    (key: string, seed: ProposalSeed) => {
      if (!enabled) return;
      const original: Record<string, string> = {};
      for (const d of seed.declarations) original[d.prop] = d.value;
      setProposals((p) => ({
        ...p,
        [key]: {
          selector: seed.selector,
          readonlyReason: seed.readonlyReason,
          files: seed.files,
          original,
          edits: {},
        },
      }));
    },
    [enabled]
  );

  /** Set a proposed value for one property (clears the edit if it matches original). */
  const edit = useCallback(
    (key: string, prop: string, to: string) => {
      setProposals((p) => {
        const cur = p[key];
        if (!cur) return p;
        const edits = { ...cur.edits };
        const original = cur.original[prop];
        if (to === original || to.trim() === '') {
          delete edits[prop];
          // Drop the override so the element falls back to its real value.
          preview({ [prop]: original ?? null });
        } else {
          edits[prop] = to;
          preview({ [prop]: to });
        }
        return { ...p, [key]: { ...cur, edits } };
      });
    },
    [preview]
  );

  /** Clear a card's preview overrides and drop the proposal. */
  const discard = useCallback(
    (key: string) => {
      setProposals((p) => {
        const cur = p[key];
        if (cur) {
          const cleared: Record<string, string | null> = {};
          for (const prop of Object.keys(cur.edits)) cleared[prop] = cur.original[prop] ?? null;
          if (Object.keys(cleared).length)
            post({ type: 'ss:mutate', rules: [{ minPx: 0, decls: cleared }] });
        }
        const next = { ...p };
        delete next[key];
        return next;
      });
    },
    [post]
  );

  /** Build the prompt, inject it into the focused agent, and clear the proposal. */
  const send = useCallback(
    (key: string) => {
      const cur = proposals[key];
      if (!cur) return;
      const edits = Object.entries(cur.edits).map(([prop, to]) => ({
        prop,
        to,
        from: cur.original[prop],
      }));
      if (!edits.length) {
        showToast('No changes to send', 'error');
        return;
      }
      const change: ProposedCssChange = {
        selector: cur.selector,
        element: element ?? undefined,
        edits,
        readonlyReason: cur.readonlyReason,
        files: cur.files,
      };
      const ok = sendToAgent(buildCssChangePrompt(change));
      if (!ok) {
        showToast('Open an agent terminal first, then Send to agent', 'error');
        return;
      }
      void trackEvent('css_send_to_agent', { selector: cur.selector, edits: edits.length });
      showToast(
        `Sent ${edits.length} change${edits.length > 1 ? 's' : ''} to the agent`,
        'success'
      );
      discard(key);
    },
    [proposals, element, sendToAgent, showToast, discard]
  );

  return { proposals, isProposing, begin, edit, discard, send };
}
