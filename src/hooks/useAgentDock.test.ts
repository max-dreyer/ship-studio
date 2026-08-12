/**
 * Docking behavior for the agent panel.
 *
 * Focus: the two things that can strand a user. The mode and geometry must
 * survive a reload, and a floating panel must never end up outside the
 * viewport — whether because the saved rect is stale, the window shrank, or
 * the stored entry is garbage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentDock } from './useAgentDock';

/** jsdom's default viewport is 1024x768; resize it for the clamp tests. */
function setViewport(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}

/**
 * An in-memory store standing in for `localStorage`.
 *
 * Node 26 defines a global `localStorage` that throws unless the runtime was
 * started with `--localstorage-file`, and it shadows jsdom's implementation.
 * Stubbing keeps this suite deterministic on any Node version, and isolates it
 * from whatever else shares the real store.
 */
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

describe('useAgentDock', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    setViewport(1400, 900);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts docked and floats on toggle', () => {
    const { result } = renderHook(() => useAgentDock());
    expect(result.current.mode).toBe('docked');
    // Docked positioning is pure CSS — no inline box.
    expect(result.current.floatStyle).toBeUndefined();

    act(() => result.current.toggleMode());
    expect(result.current.mode).toBe('floating');
    expect(typeof result.current.floatStyle?.top).toBe('number');
  });

  it('persists the mode across a remount', () => {
    const first = renderHook(() => useAgentDock());
    act(() => first.result.current.toggleMode());
    first.unmount();

    const second = renderHook(() => useAgentDock());
    expect(second.result.current.mode).toBe('floating');
  });

  it('restores a saved rect', () => {
    localStorage.setItem(
      'ss:agentDock:rect',
      JSON.stringify({ top: 120, left: 200, width: 500, height: 400 })
    );
    const { result } = renderHook(() => useAgentDock());
    expect(result.current.rect).toEqual({ top: 120, left: 200, width: 500, height: 400 });
  });

  it('falls back to a default rect when the saved entry is unreadable', () => {
    localStorage.setItem('ss:agentDock:rect', '{ not json');
    const { result } = renderHook(() => useAgentDock());
    expect(result.current.rect.width).toBeGreaterThan(0);
    expect(result.current.rect.height).toBeGreaterThan(0);
  });

  it('pulls an off-screen saved rect back into view', () => {
    localStorage.setItem(
      'ss:agentDock:rect',
      JSON.stringify({ top: 5000, left: 9000, width: 500, height: 400 })
    );
    const { result } = renderHook(() => useAgentDock());
    const { top, left, width, height } = result.current.rect;
    expect(left + width).toBeLessThanOrEqual(1400);
    expect(top + height).toBeLessThanOrEqual(900);
  });

  it('clamps a rect that is larger than the window', () => {
    localStorage.setItem(
      'ss:agentDock:rect',
      JSON.stringify({ top: 0, left: 0, width: 99999, height: 99999 })
    );
    const { result } = renderHook(() => useAgentDock());
    expect(result.current.rect.width).toBeLessThanOrEqual(1400);
    expect(result.current.rect.height).toBeLessThanOrEqual(900);
  });

  it('re-clamps when the window shrinks under a floating panel', () => {
    localStorage.setItem(
      'ss:agentDock:rect',
      JSON.stringify({ top: 400, left: 800, width: 500, height: 400 })
    );
    localStorage.setItem('ss:agentDock:mode', 'floating');
    const { result } = renderHook(() => useAgentDock());

    act(() => {
      setViewport(700, 500);
      window.dispatchEvent(new Event('resize'));
    });

    const { top, left, width, height } = result.current.rect;
    expect(left + width).toBeLessThanOrEqual(700);
    expect(top + height).toBeLessThanOrEqual(500);
  });

  it('only wires drag handlers while floating', () => {
    const { result } = renderHook(() => useAgentDock());
    expect(result.current.headerDragProps).toEqual({});

    act(() => result.current.toggleMode());
    expect(result.current.headerDragProps.onPointerDown).toBeTypeOf('function');
  });
});
