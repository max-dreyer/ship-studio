/**
 * Agent preview bridge — frontend half.
 *
 * The Rust side (`src-tauri/src/agent_bridge.rs`) runs a loopback MCP server
 * the workspace agent connects to. Every `tools/call` is forwarded to this
 * window as an `agent-bridge-request` event; `executeBridgeTool` produces the
 * MCP result (reading the inspect store, driving the preview, capturing
 * screenshots) and `respondToBridgeRequest` hands it back to Rust.
 *
 * The useAgentBridge hook (src/hooks/useAgentBridge.ts) owns the wiring.
 */

import { invoke } from '@tauri-apps/api/core';
import { inspectStore, type ConsoleEntry, type NetworkEntry } from './inspectStore';
import {
  formatConsoleForAgent,
  formatNetworkForAgent,
  formatElementsForAgent,
} from './inspectFormat';
import { addMcpServer, removeMcpServer } from './mcp';
import { logger } from './logger';

export interface AgentBridgeInfo {
  port: number;
  token: string;
  url: string;
}

/** Tool call forwarded from the Rust MCP server. */
export interface BridgeRequest {
  requestId: number;
  tool: string;
  arguments?: Record<string, unknown>;
}

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

/** MCP CallToolResult — passed back to the agent verbatim. */
export interface McpToolResult {
  content: McpContent[];
  isError?: boolean;
}

/** What the bridge needs from the preview to execute tools. */
export interface BridgeToolContext {
  projectPath: string;
  /** Full URL of the page the preview is showing, or null if not running. */
  getCurrentUrl: () => string | null;
  navigate: (route: string) => void;
  reload: () => void;
}

export const PREVIEW_MCP_SERVER_NAME = 'shipstudio-preview';

/** Base64 payloads above this are returned as a file path instead of inline
 *  image content — huge inline images blow up the agent's context. */
const MAX_INLINE_IMAGE_BASE64_CHARS = 2_000_000;

const DEFAULT_ENTRY_LIMIT = 50;

export async function startAgentBridge(windowLabel: string): Promise<AgentBridgeInfo> {
  return invoke<AgentBridgeInfo>('start_agent_bridge', { windowLabel });
}

export async function stopAgentBridge(windowLabel: string): Promise<void> {
  return invoke('stop_agent_bridge', { windowLabel });
}

export async function respondToBridgeRequest(
  requestId: number,
  result: McpToolResult
): Promise<void> {
  return invoke('agent_bridge_respond', { requestId, result });
}

/**
 * Register (or refresh) the bridge as an MCP server in the agent's config for
 * this project. The URL embeds a per-run token, so a stale registration from
 * a previous app run is removed first. Local scope: the config stays in the
 * user's own agent settings and never lands in the repo (the token must not
 * be committed).
 */
export async function registerPreviewMcpServer(url: string, projectPath: string): Promise<void> {
  const agentId = 'claude-code';
  try {
    await removeMcpServer(PREVIEW_MCP_SERVER_NAME, 'local', projectPath, agentId);
  } catch {
    // Not registered yet — the normal case on first run.
  }
  await addMcpServer(
    `--transport http ${PREVIEW_MCP_SERVER_NAME} ${url}`,
    'local',
    projectPath,
    agentId
  );
}

/** Text-only convenience result. */
const text = (t: string): McpToolResult => ({ content: [{ type: 'text', text: t }] });
const errorResult = (t: string): McpToolResult => ({
  content: [{ type: 'text', text: t }],
  isError: true,
});

function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_ENTRY_LIMIT;
  return Math.min(Math.max(n, 1), 500);
}

function filterConsole(entries: ConsoleEntry[], level: unknown): ConsoleEntry[] {
  if (level === 'error') return entries.filter((e) => e.level === 'error');
  if (level === 'warn') return entries.filter((e) => e.level === 'error' || e.level === 'warn');
  return entries;
}

function filterNetwork(entries: NetworkEntry[], failedOnly: unknown): NetworkEntry[] {
  if (failedOnly !== true) return entries;
  return entries.filter(
    (e) =>
      !e.pending && (e.error != null || e.ok === false || (e.status != null && e.status >= 400))
  );
}

/**
 * Ask the preview for a fresh DOM tree and wait for it to arrive. Falls back
 * to whatever snapshot exists (possibly null) after the timeout — the shim
 * only answers while a preview document is actually loaded.
 */
function freshDomSnapshot(
  timeoutMs = 3000
): Promise<ReturnType<typeof inspectStore.getDomSnapshot>> {
  return new Promise((resolve) => {
    const before = inspectStore.getDomSnapshot();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsubscribe();
      clearTimeout(timer);
      resolve(inspectStore.getDomSnapshot());
    };
    const unsubscribe = inspectStore.subscribe(() => {
      const now = inspectStore.getDomSnapshot();
      if (now && now !== before) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
    inspectStore.refreshDom();
  });
}

/** Validate a preview_navigate path: in-app absolute path, not a full URL. */
export function isValidPreviewPath(path: unknown): path is string {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('://')
  );
}

async function captureScreenshot(
  ctx: BridgeToolContext,
  fullPage: boolean
): Promise<McpToolResult> {
  const url = ctx.getCurrentUrl();
  if (!url) {
    return errorResult(
      'The preview is not running yet (no dev server URL). Ask the user to open the preview panel, or start the dev server first.'
    );
  }
  const command = fullPage ? 'capture_fullpage_playwright' : 'capture_viewport_playwright';
  const path = await invoke<string>(command, { projectPath: ctx.projectPath, url });
  const dataUrl = await invoke<string>('get_screenshot_base64', { filePath: path });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  if (base64.length > MAX_INLINE_IMAGE_BASE64_CHARS) {
    return text(
      `Screenshot captured but too large to return inline. It was saved to: ${path} — read that file to view it.`
    );
  }
  return {
    content: [
      { type: 'image', data: base64, mimeType: 'image/png' },
      { type: 'text', text: `Screenshot of ${url} (saved to ${path}).` },
    ],
  };
}

/**
 * Execute one bridge tool call. Never throws — failures come back as
 * `isError` results so the agent can read what went wrong.
 */
export async function executeBridgeTool(
  request: BridgeRequest,
  ctx: BridgeToolContext
): Promise<McpToolResult> {
  const args = request.arguments ?? {};
  try {
    switch (request.tool) {
      case 'preview_console': {
        const filtered = filterConsole(inspectStore.getConsoleEntries(), args.level);
        return text(formatConsoleForAgent(filtered.slice(-clampLimit(args.limit))));
      }
      case 'preview_network': {
        const filtered = filterNetwork(inspectStore.getNetworkEntries(), args.failed_only);
        return text(formatNetworkForAgent(filtered.slice(-clampLimit(args.limit))));
      }
      case 'preview_dom': {
        return text(formatElementsForAgent(await freshDomSnapshot()));
      }
      case 'preview_navigate': {
        if (!isValidPreviewPath(args.path)) {
          return errorResult(
            `Invalid path: ${JSON.stringify(args.path)}. Pass an in-app absolute path starting with '/', e.g. '/about' — not a full URL.`
          );
        }
        ctx.navigate(args.path);
        return text(`Preview navigated to ${args.path}. The user can see this change.`);
      }
      case 'preview_reload': {
        ctx.reload();
        return text('Preview reloaded.');
      }
      case 'preview_screenshot': {
        return await captureScreenshot(ctx, args.full_page === true);
      }
      default:
        return errorResult(`Unknown tool: ${request.tool}`);
    }
  } catch (err) {
    logger.error('[AgentBridge] Tool execution failed', {
      tool: request.tool,
      error: String(err),
    });
    return errorResult(`Tool '${request.tool}' failed: ${String(err)}`);
  }
}
