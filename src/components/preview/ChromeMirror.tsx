/**
 * ChromeMirror — the Chromium preview engine surface.
 *
 * Renders a headless Chromium's screencast into a canvas and forwards input
 * back over the bridge (see `src/lib/chromeMirror.ts`). Drop-in replacement
 * for the preview iframe when the user picks the Chrome engine: real Blink
 * rendering where the app's own webview is WebKit.
 *
 * Latency notes: frames decode via `createImageBitmap` with a latest-wins
 * queue (a slow decode drops stale frames instead of lagging behind), pointer
 * moves are coalesced to one per animation frame, and everything else is sent
 * the moment it happens.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  cdpModifiers,
  connectChromeMirror,
  startChromePreview,
  stopChromePreview,
  type ChromeMirrorHandle,
} from '../../lib/chromeMirror';
import { logger } from '../../lib/logger';
import { Button } from '../primitives/Button';
import { Spinner } from '../primitives/Spinner';

/** Debounce for viewport resizes — Chromium restarts its screencast on each. */
const RESIZE_DEBOUNCE_MS = 150;

interface ChromeMirrorProps {
  /** Page to mirror (the preview proxy URL, so script injection applies). */
  url: string;
  /** Logical CSS width the page lays out at (breakpoint); null = fill container. */
  cssWidth: number | null;
  /** Visual scale (<1 when the breakpoint is wider than the pane). */
  scale: number;
  /** Bump to force a Page.reload in the mirrored Chromium. */
  reloadToken?: number;
}

type MirrorStatus = 'starting' | 'live' | 'error';

const BUTTON_NAMES = ['left', 'middle', 'right'] as const;

export function ChromeMirror({ url, cssWidth, scale, reloadToken = 0 }: ChromeMirrorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<ChromeMirrorHandle | null>(null);
  const [status, setStatus] = useState<MirrorStatus>('starting');
  const statusRef = useRef<MirrorStatus>('starting');
  const [errorMessage, setErrorMessage] = useState('');
  const [restartNonce, setRestartNonce] = useState(0);

  // Props mirrored into refs so the start effect only runs on restart — URL
  // and geometry changes are handled live over the socket, not by relaunching
  // Chromium. (Mirrored in an effect, declared before the consumers below so
  // it commits first.)
  const urlRef = useRef(url);
  const geometryRef = useRef({ cssWidth, scale });
  useEffect(() => {
    urlRef.current = url;
    geometryRef.current = { cssWidth, scale };
  });

  /** Logical viewport (CSS px in the mirrored page) — input mapping needs it. */
  const viewportRef = useRef({ width: 1, height: 1 });

  const setStatusTracked = useCallback((next: MirrorStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const computeViewport = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    const visualW = rect && rect.width > 0 ? rect.width : 800;
    const visualH = rect && rect.height > 0 ? rect.height : 600;
    const { cssWidth: logical, scale: s } = geometryRef.current;
    const width = Math.round(logical ?? visualW);
    const height = Math.round(visualH / s);
    // Fractional DSF keeps scaled breakpoints crisp: layout at the true CSS
    // width, rasterize exactly at the canvas's device-pixel size.
    const deviceScaleFactor = window.devicePixelRatio * s;
    return { width, height, deviceScaleFactor };
  }, []);

  // ---- Frame pipeline (latest-wins decode) --------------------------------
  const decodingRef = useRef(false);
  const pendingFrameRef = useRef<ArrayBuffer | null>(null);

  const drawBitmap = useCallback(
    (bitmap: ImageBitmap) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
      if (statusRef.current !== 'live') setStatusTracked('live');
    },
    [setStatusTracked]
  );

  const handleFrame = useCallback(
    (frame: ArrayBuffer) => {
      if (decodingRef.current) {
        pendingFrameRef.current = frame;
        return;
      }
      decodingRef.current = true;
      void (async () => {
        let next: ArrayBuffer | null = frame;
        while (next) {
          const current = next;
          next = null;
          try {
            const bitmap = await createImageBitmap(new Blob([current], { type: 'image/jpeg' }));
            drawBitmap(bitmap);
            bitmap.close();
          } catch {
            // Corrupt/partial frame — skip it, the next one repaints fully.
          }
          next = pendingFrameRef.current;
          pendingFrameRef.current = null;
        }
        decodingRef.current = false;
      })();
    },
    [drawBitmap]
  );

  // ---- Lifecycle: launch Chromium + connect the bridge --------------------
  useEffect(() => {
    let cancelled = false;
    // The port identifies OUR instance — cleanup passes it so a stale stop
    // (this effect's, after a newer mount already started its own Chromium)
    // no-ops instead of killing the successor.
    let ownedPort: number | null = null;

    void (async () => {
      const viewport = computeViewport();
      viewportRef.current = { width: viewport.width, height: viewport.height };
      try {
        const port = await startChromePreview({ url: urlRef.current, ...viewport });
        ownedPort = port;
        if (cancelled) {
          void stopChromePreview(port);
          return;
        }
        handleRef.current = connectChromeMirror(port, {
          onFrame: handleFrame,
          onDead: (reason) => {
            logger.warn('[ChromeMirror] Chromium died', { reason });
            setErrorMessage(reason);
            setStatusTracked('error');
          },
        });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        logger.error('[ChromeMirror] Failed to start Chrome preview', { error: message });
        setErrorMessage(message);
        setStatusTracked('error');
      }
    })();

    return () => {
      cancelled = true;
      handleRef.current?.close();
      handleRef.current = null;
      if (ownedPort !== null) void stopChromePreview(ownedPort);
    };
  }, [restartNonce, computeViewport, handleFrame, setStatusTracked]);

  // Navigate in place on URL changes (page selector, proxy port arriving).
  const lastUrlRef = useRef(url);
  useEffect(() => {
    if (url !== lastUrlRef.current) {
      lastUrlRef.current = url;
      handleRef.current?.send({ type: 'navigate', url });
    }
  }, [url]);

  // Reload requests (toolbar refresh, static-file changes).
  const lastReloadRef = useRef(reloadToken);
  useEffect(() => {
    if (reloadToken !== lastReloadRef.current) {
      lastReloadRef.current = reloadToken;
      if (reloadToken !== 0) handleRef.current?.send({ type: 'reload' });
    }
  }, [reloadToken]);

  // Keep the Chromium viewport in sync with the pane and breakpoint.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sync = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const viewport = computeViewport();
        viewportRef.current = { width: viewport.width, height: viewport.height };
        handleRef.current?.send({ type: 'resize', ...viewport });
      }, RESIZE_DEBOUNCE_MS);
    };
    const observer = new ResizeObserver(sync);
    observer.observe(container);
    sync();
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [cssWidth, scale, computeViewport]);

  // ---- Input forwarding ----------------------------------------------------
  const toLogical = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: (e.clientX - rect.left) * (viewportRef.current.width / rect.width),
      y: (e.clientY - rect.top) * (viewportRef.current.height / rect.height),
    };
  }, []);

  // Coalesce pointer moves to one per animation frame.
  const moveRafRef = useRef<number | null>(null);
  const lastMoveRef = useRef<{ x: number; y: number; buttons: number; modifiers: number } | null>(
    null
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      lastMoveRef.current = { ...toLogical(e), buttons: e.buttons, modifiers: cdpModifiers(e) };
      if (moveRafRef.current !== null) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null;
        const move = lastMoveRef.current;
        if (move) {
          handleRef.current?.send({
            type: 'mouse',
            kind: 'move',
            x: move.x,
            y: move.y,
            buttons: move.buttons,
            modifiers: move.modifiers,
          });
        }
      });
    },
    [toLogical]
  );
  useEffect(() => {
    return () => {
      if (moveRafRef.current !== null) cancelAnimationFrame(moveRafRef.current);
    };
  }, []);

  const sendButton = useCallback(
    (kind: 'down' | 'up', e: React.PointerEvent) => {
      handleRef.current?.send({
        type: 'mouse',
        kind,
        ...toLogical(e),
        button: BUTTON_NAMES[e.button] ?? 'left',
        buttons: e.buttons,
        clickCount: e.detail || 1,
        modifiers: cdpModifiers(e),
      });
    },
    [toLogical]
  );

  const onKey = useCallback((kind: 'down' | 'up', e: React.KeyboardEvent) => {
    // Leave app-level shortcuts (Cmd+K palette etc.) to the app.
    if (e.metaKey && e.key !== 'Meta') return;
    e.preventDefault();
    e.stopPropagation();
    handleRef.current?.send({
      type: 'key',
      kind,
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      // `text` is what makes Chromium synthesize keypress/input events.
      // Enter maps to \r by CDP convention.
      text:
        kind === 'down'
          ? e.key.length === 1
            ? e.key
            : e.key === 'Enter'
              ? '\r'
              : undefined
          : undefined,
      modifiers: cdpModifiers(e),
      repeat: e.repeat,
    });
  }, []);

  // Wheel needs a non-passive native listener to preventDefault (React
  // registers wheel passively).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      handleRef.current?.send({
        type: 'mouse',
        kind: 'wheel',
        ...toLogical(e),
        // CDP follows DOM wheel semantics (positive deltaY scrolls down),
        // matching Puppeteer's Mouse.wheel.
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        modifiers: cdpModifiers(e),
      });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [toLogical]);

  return (
    <div ref={containerRef} className="chrome-mirror">
      <canvas
        ref={canvasRef}
        className="chrome-mirror__canvas"
        tabIndex={0}
        aria-label="Chrome preview"
        onPointerMove={onPointerMove}
        onPointerDown={(e) => {
          canvasRef.current?.focus();
          canvasRef.current?.setPointerCapture(e.pointerId);
          sendButton('down', e);
        }}
        onPointerUp={(e) => {
          canvasRef.current?.releasePointerCapture(e.pointerId);
          sendButton('up', e);
        }}
        onKeyDown={(e) => onKey('down', e)}
        onKeyUp={(e) => onKey('up', e)}
        onContextMenu={(e) => e.preventDefault()}
      />
      {status === 'starting' && (
        <div className="chrome-mirror__overlay">
          <Spinner size="lg" style={{ color: 'var(--accent)' }} />
          <span>Starting Chrome…</span>
        </div>
      )}
      {status === 'error' && (
        <div className="chrome-mirror__overlay">
          <span className="chrome-mirror__error">{errorMessage || 'Chrome preview failed'}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setErrorMessage('');
              setStatusTracked('starting');
              setRestartNonce((n) => n + 1);
            }}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
