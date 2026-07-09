/**
 * Wires the agent preview bridge into the preview: starts the per-window MCP
 * server, registers it in the agent's config for this project, and answers
 * the tool calls Rust forwards as `agent-bridge-request` events.
 *
 * Mounted from Preview (which owns the connection state the tools need).
 * Context values go through refs so the event listener binds once.
 */

import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  executeBridgeTool,
  registerPreviewMcpServer,
  respondToBridgeRequest,
  startAgentBridge,
  type BridgeRequest,
} from '../lib/agentBridge';
import { getWindowLabel } from '../lib/window';
import { logger } from '../lib/logger';
import { trackEvent } from '../lib/analytics';

interface UseAgentBridgeParams {
  projectPath: string;
  /** Full URL of the page the preview is currently showing (null = not running). */
  currentUrl: string | null;
  navigate: (route: string) => void;
  reload: () => void;
}

export function useAgentBridge({
  projectPath,
  currentUrl,
  navigate,
  reload,
}: UseAgentBridgeParams) {
  // Live values for the long-lived listener — rebinding the Tauri listener on
  // every URL change would race in-flight requests.
  const ctxRef = useRef({ projectPath, currentUrl, navigate, reload });
  useEffect(() => {
    ctxRef.current = { projectPath, currentUrl, navigate, reload };
  });

  // One registration per project+URL: the token rotates per app run, so a
  // fresh run re-registers, but re-renders and reconnects don't.
  const registeredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!projectPath) return;
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setUp = async () => {
      let url: string;
      try {
        const info = await startAgentBridge(getWindowLabel());
        url = info.url;
      } catch (err) {
        logger.error('[AgentBridge] Failed to start bridge server', { error: String(err) });
        return;
      }
      if (cancelled) return;

      // Register with the agent CLI (best-effort: the agent may not be
      // installed, and the preview works fine without the bridge).
      const key = `${projectPath}|${url}`;
      if (registeredKeyRef.current !== key) {
        registeredKeyRef.current = key;
        registerPreviewMcpServer(url, projectPath).then(
          () => logger.info('[AgentBridge] Registered preview MCP server', { projectPath }),
          (err) => {
            registeredKeyRef.current = null;
            logger.warn('[AgentBridge] Could not register preview MCP server', {
              error: String(err),
            });
          }
        );
      }

      unlisten = await listen<BridgeRequest>('agent-bridge-request', (event) => {
        const request = event.payload;
        void (async () => {
          const {
            projectPath: path,
            currentUrl: liveUrl,
            navigate: nav,
            reload: rel,
          } = ctxRef.current;
          const result = await executeBridgeTool(request, {
            projectPath: path,
            getCurrentUrl: () => liveUrl,
            navigate: nav,
            reload: rel,
          });
          void trackEvent('agent_bridge_tool_used', {
            tool: request.tool,
            is_error: result.isError === true,
          });
          try {
            await respondToBridgeRequest(request.requestId, result);
          } catch (err) {
            logger.error('[AgentBridge] Failed to deliver tool response', {
              error: String(err),
            });
          }
        })();
      });
      // The effect was cleaned up while `listen` was in flight.
      if (cancelled) {
        unlisten();
        unlisten = null;
      }
    };

    void setUp();

    return () => {
      cancelled = true;
      unlisten?.();
      // The bridge server itself stays up for the window's lifetime (Rust
      // stops it on window destroy) — tool calls without a listener time out
      // with a "preview not open" message, which is the honest answer.
    };
  }, [projectPath]);
}
