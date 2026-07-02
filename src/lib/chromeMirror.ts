/**
 * Client for the Chromium preview bridge (see `src-tauri/src/chrome_preview/`).
 *
 * The backend drives a headless Chromium over CDP and exposes a local
 * WebSocket per window: binary JPEG screencast frames flow down, JSON
 * input/control messages flow up. This module owns the socket lifecycle and
 * the message vocabulary; rendering lives in `ChromeMirror.tsx`.
 */

import { invoke } from '@tauri-apps/api/core';
import { getWindowLabel } from './window';

/** Start (or restart) the Chromium preview for this window. Returns the bridge port. */
export async function startChromePreview(params: {
  url: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
}): Promise<number> {
  return invoke<number>('start_chrome_preview', {
    windowLabel: getWindowLabel(),
    url: params.url,
    width: Math.max(1, Math.round(params.width)),
    height: Math.max(1, Math.round(params.height)),
    deviceScaleFactor: params.deviceScaleFactor,
  });
}

/**
 * Stop the Chromium preview for this window. Pass the bridge port you were
 * given so a stale unmount can't kill a newer instance (StrictMode double
 * mounts, rapid engine toggles); omit to force-stop.
 */
export async function stopChromePreview(bridgePort?: number): Promise<void> {
  await invoke('stop_chrome_preview', {
    windowLabel: getWindowLabel(),
    bridgePort: bridgePort ?? null,
  });
}

/** CDP modifier bitmask (Alt=1, Ctrl=2, Meta=4, Shift=8). */
export function cdpModifiers(e: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
}

export type ChromeMirrorMessage =
  | {
      type: 'mouse';
      kind: 'move' | 'down' | 'up' | 'wheel';
      x: number;
      y: number;
      button?: 'left' | 'middle' | 'right';
      buttons?: number;
      clickCount?: number;
      deltaX?: number;
      deltaY?: number;
      modifiers?: number;
    }
  | {
      type: 'key';
      kind: 'down' | 'up';
      key: string;
      code: string;
      keyCode: number;
      text?: string;
      modifiers?: number;
      repeat?: boolean;
    }
  | { type: 'insertText'; text: string }
  | { type: 'navigate'; url: string }
  | { type: 'reload' }
  | { type: 'resize'; width: number; height: number; deviceScaleFactor: number };

export interface ChromeMirrorHandle {
  send: (msg: ChromeMirrorMessage) => void;
  close: () => void;
}

/**
 * Connect to the bridge. Frames arrive as ArrayBuffers (JPEG); a `status`
 * text message with `state: 'dead'` means Chromium is gone.
 */
export function connectChromeMirror(
  port: number,
  callbacks: {
    onFrame: (frame: ArrayBuffer) => void;
    onDead: (reason: string) => void;
    onClose?: () => void;
  }
): ChromeMirrorHandle {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.binaryType = 'arraybuffer';

  ws.onmessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      callbacks.onFrame(event.data);
      return;
    }
    if (typeof event.data === 'string') {
      try {
        const msg = JSON.parse(event.data) as { type?: string; state?: string; reason?: string };
        if (msg.type === 'status' && msg.state === 'dead') {
          callbacks.onDead(msg.reason ?? 'Chromium exited');
        }
      } catch {
        // Ignore malformed control messages.
      }
    }
  };
  ws.onclose = () => callbacks.onClose?.();

  return {
    send: (msg: ChromeMirrorMessage) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    close: () => {
      ws.onmessage = null;
      ws.onclose = null;
      ws.close();
    },
  };
}
