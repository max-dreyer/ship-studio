/**
 * Module-level store for agent activity on the live preview.
 *
 * When the workspace agent uses a preview MCP tool (via the agent bridge),
 * this store drives the visual "the agent is doing this, not you" layer:
 * a glow around the preview edges, an action chip naming what the agent is
 * doing, and a big cursor / camera-flash effect for the spatial actions.
 *
 * Lives outside React (like inspectStore) so tool calls that land while the
 * overlay is unmounted or re-rendering are never dropped.
 */

export type AgentEffectKind = 'cursor' | 'flash';

export interface AgentActivityEffect {
  kind: AgentEffectKind;
  /** Position as fractions of the preview frame (0..1). */
  x: number;
  y: number;
  /** Bumped per effect so React re-runs the animation via `key`. */
  seq: number;
}

export interface AgentActivityState {
  /** Overlay should render (busy, or lingering just after an action). */
  visible: boolean;
  /** A tool call is in flight right now. */
  busy: boolean;
  /** Human-readable description of the current/last action. */
  label: string | null;
  /** Transient cursor/flash effect, cleared automatically. */
  effect: AgentActivityEffect | null;
}

/** How long the glow lingers after the last action finishes. */
const LINGER_MS = 2200;
/** How long a cursor/flash effect stays before clearing. */
const EFFECT_MS = 1600;

interface ToolMeta {
  label: (args: Record<string, unknown> | undefined) => string;
  effect?: { kind: AgentEffectKind; x: number; y: number };
}

const TOOL_META: Record<string, ToolMeta> = {
  preview_console: { label: () => 'Agent is reading the console' },
  preview_network: { label: () => 'Agent is checking network requests' },
  preview_dom: { label: () => 'Agent is inspecting the page structure' },
  preview_navigate: {
    label: (args) =>
      typeof args?.path === 'string'
        ? `Agent is opening ${args.path}`
        : 'Agent is navigating the preview',
    // The cursor lands where a person would click to navigate: up top.
    effect: { kind: 'cursor', x: 0.5, y: 0.16 },
  },
  preview_reload: {
    label: () => 'Agent is reloading the preview',
    effect: { kind: 'cursor', x: 0.5, y: 0.16 },
  },
  preview_screenshot: {
    label: () => 'Agent is taking a screenshot',
    effect: { kind: 'flash', x: 0.5, y: 0.5 },
  },
};

let activeCount = 0;
let label: string | null = null;
let effect: AgentActivityEffect | null = null;
let visible = false;
let effectSeq = 0;
let lingerTimer: ReturnType<typeof setTimeout> | null = null;
let effectTimer: ReturnType<typeof setTimeout> | null = null;

let state: AgentActivityState = { visible: false, busy: false, label: null, effect: null };

const listeners = new Set<() => void>();

const notify = () => {
  state = { visible, busy: activeCount > 0, label, effect };
  for (const l of Array.from(listeners)) l();
};

/**
 * Mark a tool call as started. Returns the matching `end` function — call it
 * when the tool finishes (success or error) so the glow can wind down.
 */
export function beginAgentActivity(
  tool: string,
  args: Record<string, unknown> | undefined
): () => void {
  const meta = TOOL_META[tool];
  activeCount += 1;
  visible = true;
  label = meta ? meta.label(args) : 'Agent is using the preview';
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
  if (meta?.effect) {
    effectSeq += 1;
    effect = { ...meta.effect, seq: effectSeq };
    if (effectTimer) clearTimeout(effectTimer);
    effectTimer = setTimeout(() => {
      effect = null;
      effectTimer = null;
      notify();
    }, EFFECT_MS);
  }
  notify();

  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount === 0) {
      // Keep the glow (and the last action's label) up briefly so fast reads
      // don't just blink.
      lingerTimer = setTimeout(() => {
        visible = false;
        label = null;
        lingerTimer = null;
        notify();
      }, LINGER_MS);
    }
    notify();
  };
}

export const agentActivityStore = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getState: (): AgentActivityState => state,
};
