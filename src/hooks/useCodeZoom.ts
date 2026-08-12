/**
 * Font size for the Code tab's editor and viewer.
 *
 * Editors are read for hours, and the right size depends on the display and
 * the eyes in front of it — so it's a preference, not a constant. Exposes the
 * chosen size as a CSS variable (`--code-font-size`) that the CodeMirror theme
 * and the viewer both read, plus the usual zoom keys.
 *
 * The value persists app-wide rather than per project: it's about the person,
 * not the codebase.
 *
 * @module hooks/useCodeZoom
 */

import { useCallback, useEffect, useState } from 'react';

const KEY = 'ss:code:fontSize';

/** Bounds keep the editor usable: below 10 the gutter crowds, above 24 very
 *  little code fits beside the preview. */
export const MIN_CODE_FONT = 10;
export const MAX_CODE_FONT = 24;
export const DEFAULT_CODE_FONT = 16;

/** Clamp and round, so a stale or hand-edited entry can't wedge the editor. */
export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_CODE_FONT;
  return Math.min(MAX_CODE_FONT, Math.max(MIN_CODE_FONT, Math.round(size)));
}

function read(): number {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? DEFAULT_CODE_FONT : clampFontSize(Number(raw));
  } catch {
    return DEFAULT_CODE_FONT;
  }
}

export function useCodeZoom() {
  const [fontSize, setFontSize] = useState(read);

  const apply = useCallback((next: number) => {
    const clamped = clampFontSize(next);
    setFontSize(clamped);
    try {
      localStorage.setItem(KEY, String(clamped));
    } catch {
      // A blocked store costs the preference, not the feature.
    }
  }, []);

  const zoomIn = useCallback(() => apply(read() + 1), [apply]);
  const zoomOut = useCallback(() => apply(read() - 1), [apply]);
  const reset = useCallback(() => apply(DEFAULT_CODE_FONT), [apply]);

  // Cmd/Ctrl +, -, 0 while the Code tab is on screen. `=` is the unshifted key
  // most keyboards put "+" on, so both must be accepted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      if (e.key === '+' || e.key === '=') zoomIn();
      else if (e.key === '-') zoomOut();
      else if (e.key === '0') reset();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomIn, zoomOut, reset]);

  return {
    fontSize,
    zoomIn,
    zoomOut,
    reset,
    canZoomIn: fontSize < MAX_CODE_FONT,
    canZoomOut: fontSize > MIN_CODE_FONT,
    /** Spread onto the Code tab's root so the theme picks the size up. */
    style: { '--code-font-size': `${fontSize}px` } as React.CSSProperties,
  };
}
