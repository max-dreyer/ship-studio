/**
 * Preview transport — the routing point between the native iframe path and the
 * Chrome-engine bridge (see `previewTransport.ts`).
 *
 * Focus: registration/fallback (messages go to the iframe until a chrome
 * transport registers, then through it — tagged with the host channel),
 * stale-unregister safety, the dual-path message subscription (window guard
 * preserved verbatim + direct chrome dispatch), and dispatch ordering.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  PREVIEW_HOST_CHANNEL,
  dispatchChromePreviewMessage,
  dispatchPreviewLoad,
  postToPreview,
  postToPreviews,
  registerChromePreviewTransport,
  subscribePreviewLoad,
  subscribePreviewMessages,
} from './previewTransport';

/** Track registrations/subscriptions so module-level state never leaks. */
const cleanups: Array<() => void> = [];
const track = (off: () => void) => {
  cleanups.push(off);
  return off;
};
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function fakeIframe() {
  const postMessage = vi.fn();
  const iframe = { contentWindow: { postMessage } } as unknown as HTMLIFrameElement;
  return { iframe, postMessage };
}

describe('postToPreview routing', () => {
  it('falls back to the iframe contentWindow when no chrome transport is registered', () => {
    const { iframe, postMessage } = fakeIframe();
    postToPreview(iframe, { type: 'ss:activate' });
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'ss:activate' }, '*');
  });

  it('tolerates a missing iframe (unmounted preview)', () => {
    expect(() => postToPreview(null, { type: 'ss:activate' })).not.toThrow();
  });

  it('routes through a registered chrome transport instead, tagging the host channel', () => {
    const { iframe, postMessage } = fakeIframe();
    const send = vi.fn();
    track(registerChromePreviewTransport({ send }));
    postToPreview(iframe, { type: 'ss:mutate', className: 'p-4' });
    expect(postMessage).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledExactlyOnceWith({
      source: PREVIEW_HOST_CHANNEL,
      type: 'ss:mutate',
      className: 'p-4',
    });
  });

  it('lets a message that already carries a source keep its own', () => {
    const send = vi.fn();
    track(registerChromePreviewTransport({ send }));
    postToPreview(null, { source: 'custom-channel', type: 'subscribe-dom-tree' });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      source: 'custom-channel',
      type: 'subscribe-dom-tree',
    });
  });

  it('restores the iframe fallback after unregistering', () => {
    const { iframe, postMessage } = fakeIframe();
    const send = vi.fn();
    const off = track(registerChromePreviewTransport({ send }));
    off();
    postToPreview(iframe, { type: 'ss:deactivate' });
    expect(send).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'ss:deactivate' }, '*');
  });

  it('a stale unregister does not clobber a newer registration', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = track(registerChromePreviewTransport({ send: first }));
    track(registerChromePreviewTransport({ send: second }));
    offFirst(); // the old ChromeMirror unmounts after its successor registered
    postToPreview(null, { type: 'ss:activate' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

describe('postToPreviews broadcast', () => {
  it('posts to every document iframe when no transport is registered', () => {
    const a = document.createElement('iframe');
    const b = document.createElement('iframe');
    document.body.append(a, b);
    try {
      const spyA = vi.spyOn(a.contentWindow!, 'postMessage');
      const spyB = vi.spyOn(b.contentWindow!, 'postMessage');
      const msg = { source: PREVIEW_HOST_CHANNEL, type: 'request-dom-tree' };
      postToPreviews(msg);
      expect(spyA).toHaveBeenCalledExactlyOnceWith(msg, '*');
      expect(spyB).toHaveBeenCalledExactlyOnceWith(msg, '*');
    } finally {
      a.remove();
      b.remove();
    }
  });

  it('routes through the chrome transport when registered', () => {
    const send = vi.fn();
    track(registerChromePreviewTransport({ send }));
    postToPreviews({ source: PREVIEW_HOST_CHANNEL, type: 'subscribe-dom-tree' });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      source: PREVIEW_HOST_CHANNEL,
      type: 'subscribe-dom-tree',
    });
  });
});

describe('subscribePreviewMessages', () => {
  it('delivers window messages only when event.source is the preview iframe (guard preserved)', () => {
    const { iframe } = fakeIframe();
    const iframeRef = { current: iframe };
    const handler = vi.fn();
    track(subscribePreviewMessages(iframeRef, handler));

    // Wrong source (another window / forged message) — rejected.
    window.dispatchEvent(
      new MessageEvent('message', { source: window, data: { type: 'ss:textCommit', text: 'x' } })
    );
    expect(handler).not.toHaveBeenCalled();

    // The preview iframe's contentWindow — accepted, handler gets event.data.
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow as unknown as MessageEventSource,
        data: { type: 'ss:select', signature: { className: 'a' } },
      })
    );
    expect(handler).toHaveBeenCalledExactlyOnceWith({
      type: 'ss:select',
      signature: { className: 'a' },
    });
  });

  it('rejects all window messages while the iframe is unmounted (chrome engine)', () => {
    const handler = vi.fn();
    track(subscribePreviewMessages({ current: null }, handler));
    window.dispatchEvent(
      new MessageEvent('message', { source: window, data: { type: 'ss:select' } })
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers chrome-dispatched payloads directly, preserving order across handlers', () => {
    const seen: string[] = [];
    const first = (d: unknown) => seen.push(`first:${(d as { type: string }).type}`);
    const second = (d: unknown) => seen.push(`second:${(d as { type: string }).type}`);
    track(subscribePreviewMessages({ current: null }, first));
    track(subscribePreviewMessages({ current: null }, second));

    dispatchChromePreviewMessage({ type: 'ss:select' });
    dispatchChromePreviewMessage({ type: 'ss:cascade' });

    // Each message reaches every handler (subscription order) before the next.
    expect(seen).toEqual([
      'first:ss:select',
      'second:ss:select',
      'first:ss:cascade',
      'second:ss:cascade',
    ]);
  });

  it('stops delivering after unsubscribe (both paths)', () => {
    const { iframe } = fakeIframe();
    const handler = vi.fn();
    const off = track(subscribePreviewMessages({ current: iframe }, handler));
    off();
    dispatchChromePreviewMessage({ type: 'ss:select' });
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow as unknown as MessageEventSource,
        data: { type: 'ss:select' },
      })
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets a handler unsubscribe itself safely mid-dispatch', () => {
    const calls: string[] = [];
    const offA: { current: (() => void) | null } = { current: null };
    offA.current = track(
      subscribePreviewMessages({ current: null }, () => {
        calls.push('a');
        offA.current?.();
      })
    );
    track(subscribePreviewMessages({ current: null }, () => calls.push('b')));
    dispatchChromePreviewMessage({ type: 'ss:tree' });
    dispatchChromePreviewMessage({ type: 'ss:tree' });
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});

describe('preview load bus', () => {
  it('notifies subscribers on dispatch and stops after unsubscribe', () => {
    const handler = vi.fn();
    const off = track(subscribePreviewLoad(handler));
    dispatchPreviewLoad();
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    dispatchPreviewLoad();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
