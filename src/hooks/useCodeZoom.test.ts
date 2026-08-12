/**
 * Code editor font size.
 *
 * Focus: the bounds. A stale or hand-edited entry must never wedge the editor
 * at an unusable size, and the zoom keys must stop at the ends rather than
 * running away.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useCodeZoom,
  clampFontSize,
  DEFAULT_CODE_FONT,
  MIN_CODE_FONT,
  MAX_CODE_FONT,
} from './useCodeZoom';

/** In-memory store: independent of the runtime's own localStorage. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('clampFontSize', () => {
  it('holds the value inside the usable range', () => {
    expect(clampFontSize(2)).toBe(MIN_CODE_FONT);
    expect(clampFontSize(999)).toBe(MAX_CODE_FONT);
    expect(clampFontSize(14)).toBe(14);
  });

  it('rounds, and falls back on garbage', () => {
    expect(clampFontSize(14.6)).toBe(15);
    expect(clampFontSize(NaN)).toBe(DEFAULT_CODE_FONT);
  });
});

describe('useCodeZoom', () => {
  it('starts at the default and exposes it as a CSS variable', () => {
    const { result } = renderHook(() => useCodeZoom());
    expect(result.current.fontSize).toBe(DEFAULT_CODE_FONT);
    expect(result.current.style).toEqual({ '--code-font-size': `${DEFAULT_CODE_FONT}px` });
  });

  it('zooms in and out one step at a time', () => {
    const { result } = renderHook(() => useCodeZoom());
    act(() => result.current.zoomIn());
    expect(result.current.fontSize).toBe(DEFAULT_CODE_FONT + 1);
    act(() => result.current.zoomOut());
    expect(result.current.fontSize).toBe(DEFAULT_CODE_FONT);
  });

  it('stops at the ends instead of running away', () => {
    const { result } = renderHook(() => useCodeZoom());
    for (let i = 0; i < 40; i++) act(() => result.current.zoomIn());
    expect(result.current.fontSize).toBe(MAX_CODE_FONT);
    expect(result.current.canZoomIn).toBe(false);

    for (let i = 0; i < 40; i++) act(() => result.current.zoomOut());
    expect(result.current.fontSize).toBe(MIN_CODE_FONT);
    expect(result.current.canZoomOut).toBe(false);
  });

  it('resets to the default', () => {
    const { result } = renderHook(() => useCodeZoom());
    act(() => result.current.zoomIn());
    act(() => result.current.reset());
    expect(result.current.fontSize).toBe(DEFAULT_CODE_FONT);
  });

  it('persists across a remount', () => {
    const first = renderHook(() => useCodeZoom());
    act(() => first.result.current.zoomIn());
    first.unmount();
    expect(renderHook(() => useCodeZoom()).result.current.fontSize).toBe(DEFAULT_CODE_FONT + 1);
  });

  it('repairs an out-of-range stored value', () => {
    localStorage.setItem('ss:code:fontSize', '900');
    expect(renderHook(() => useCodeZoom()).result.current.fontSize).toBe(MAX_CODE_FONT);
  });

  it('zooms with the keyboard, accepting = as well as +', () => {
    const { result } = renderHook(() => useCodeZoom());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', metaKey: true }));
    });
    expect(result.current.fontSize).toBe(DEFAULT_CODE_FONT + 1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', metaKey: true }));
    });
    expect(result.current.fontSize).toBe(DEFAULT_CODE_FONT);
  });

  it('ignores the same keys without a modifier', () => {
    const { result } = renderHook(() => useCodeZoom());
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    });
    expect(result.current.fontSize).toBe(DEFAULT_CODE_FONT);
  });
});
