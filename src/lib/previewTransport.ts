/**
 * Preview transport — the single routing point for every host ↔ page editor
 * message (the `ss:*` protocol spoken by `src-tauri/src/proxy/select_script.html`).
 *
 * Two engines render the preview:
 * - **Native (default)**: the page lives in a WebKit iframe. Outbound messages
 *   go to `iframe.contentWindow.postMessage`, inbound ones arrive as `window`
 *   message events whose `event.source` is that contentWindow — exactly the
 *   pre-transport behavior, byte for byte.
 * - **Chrome**: the page lives in a mirrored headless Chromium (`ChromeMirror`).
 *   There is no iframe; messages travel over the local bridge WebSocket and a
 *   CDP relay (see `src-tauri/src/chrome_preview/mod.rs`). ChromeMirror
 *   registers a transport here on connect; while one is registered, outbound
 *   messages route through it INSTEAD of the iframe, and inbound bridge
 *   messages are dispatched directly to the same handlers the window listener
 *   feeds (no re-posting into the app window — the native listeners' strict
 *   `event.source` guards stay untouched).
 *
 * Outbound chrome messages are tagged with the host channel (`source:
 * 'shipstudio-inspect-host'`): in the mirrored Chromium the page is top-level
 * (parent === window), so host-injected and page-emitted messages land on the
 * SAME window — the in-page relay forwards only messages with no `source`,
 * and the tag is what keeps host messages from echoing back to the app.
 */

/** Host channel marker on app→page messages (mirrors HOST_CHANNEL in
 *  `inspectStore.ts`; `select_script.html` ignores unknown fields). */
export const PREVIEW_HOST_CHANNEL = 'shipstudio-inspect-host';

/** An app→page editor message (all senders post plain JSON-safe objects). */
export type PreviewOutboundMessage = Record<string, unknown>;

export interface ChromePreviewTransport {
  /** Deliver one message into the mirrored page (bridge → CDP → postMessage). */
  send: (payload: PreviewOutboundMessage) => void;
}

let chromeTransport: ChromePreviewTransport | null = null;

/** Handlers fed by BOTH paths: window messages (guarded) and chrome dispatch. */
const messageListeners = new Set<(data: unknown) => void>();

/** Handlers for "the preview document (re)loaded" — the signal edit mode uses
 *  to re-arm the in-page script (it re-initializes inert on every new doc). */
const loadListeners = new Set<() => void>();

/**
 * Route host→page messages through the given chrome transport until the
 * returned unregister runs. Latest registration wins; a stale unregister
 * (an unmounted ChromeMirror cleaning up after its successor registered)
 * no-ops instead of clobbering the newer transport.
 */
export function registerChromePreviewTransport(transport: ChromePreviewTransport): () => void {
  chromeTransport = transport;
  return () => {
    if (chromeTransport === transport) chromeTransport = null;
  };
}

const sendViaChrome = (transport: ChromePreviewTransport, msg: object) => {
  // Tag with the host channel so the in-page relay never echoes host messages
  // back (page→app messages carry no `source`). A message that already has a
  // source (inspectStore's) keeps its own — the spread lets it win.
  transport.send({ source: PREVIEW_HOST_CHANNEL, ...(msg as PreviewOutboundMessage) });
};

/**
 * Post one host→page editor message. `iframe` is the native fallback target
 * (the caller's preview iframe, may be null while unmounted); when a chrome
 * transport is registered the message routes through it instead.
 */
export function postToPreview(iframe: HTMLIFrameElement | null | undefined, msg: unknown): void {
  const transport = chromeTransport;
  if (transport && msg && typeof msg === 'object') {
    sendViaChrome(transport, msg);
    return;
  }
  iframe?.contentWindow?.postMessage(msg, '*');
}

/**
 * Broadcast a host message to every preview surface: the chrome transport when
 * registered, else all iframes in the document (inspectStore's historic
 * behavior — plugin iframes may also be listening on the host channel).
 */
export function postToPreviews(msg: unknown): void {
  const transport = chromeTransport;
  if (transport && msg && typeof msg === 'object') {
    sendViaChrome(transport, msg);
    return;
  }
  if (typeof document === 'undefined') return;
  document.querySelectorAll('iframe').forEach((iframe) => {
    try {
      iframe.contentWindow?.postMessage(msg, '*');
    } catch {
      // ignore — cross-origin frames may not allow postMessage in some setups
    }
  });
}

/**
 * Subscribe to page→app editor messages from BOTH engines.
 *
 * Native path: a `window` message listener with the exact security guard the
 * hooks always had — only messages whose `event.source` is the preview
 * iframe's contentWindow are trusted (the iframe hosts untrusted project
 * content; a forged `ss:textCommit` would otherwise write to source files).
 *
 * Chrome path: payloads dispatched by ChromeMirror from the bridge (already
 * origin-checked on the WebSocket and filtered to page-channel `ss:*`
 * messages by the backend relay).
 */
export function subscribePreviewMessages(
  iframeRef: { current: HTMLIFrameElement | null },
  handler: (data: unknown) => void
): () => void {
  const onWindowMessage = (e: MessageEvent) => {
    // SECURITY: only trust messages from the actual preview iframe.
    if (e.source !== iframeRef.current?.contentWindow) return;
    handler(e.data);
  };
  window.addEventListener('message', onWindowMessage);
  messageListeners.add(handler);
  return () => {
    window.removeEventListener('message', onWindowMessage);
    messageListeners.delete(handler);
  };
}

/** Feed a chrome-bridge page message to every subscribed handler (in
 *  subscription order). Called by ChromeMirror only. */
export function dispatchChromePreviewMessage(data: unknown): void {
  // Iterate over a snapshot so a handler can unsubscribe itself safely.
  for (const listener of Array.from(messageListeners)) listener(data);
}

/**
 * Subscribe to "the preview document (re)loaded". Fired by the native iframe's
 * `load` event (Preview.tsx dispatches it) and by the chrome engine's
 * `Page.loadEventFired` / bridge (re)connect — both mean the in-page script
 * reset to inert and edit mode must re-activate.
 */
export function subscribePreviewLoad(handler: () => void): () => void {
  loadListeners.add(handler);
  return () => {
    loadListeners.delete(handler);
  };
}

/** Announce a preview document load to every subscriber. */
export function dispatchPreviewLoad(): void {
  for (const listener of Array.from(loadListeners)) listener();
}
