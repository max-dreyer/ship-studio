/**
 * Transition parsing for the structured transition editor.
 *
 * Focus: the duration-versus-delay ordering rule, which is the one thing a
 * transition editor cannot get wrong without silently changing timing, and
 * `cubic-bezier(...)` whose commas are not entry separators.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTransition,
  parseTransitionEntry,
  formatTransition,
  formatTransitionEntry,
  type TransitionEntry,
} from './cssTransition';

const entry = (over: Partial<TransitionEntry> = {}): TransitionEntry => ({
  property: '',
  duration: '',
  timing: '',
  delay: '',
  ...over,
});

describe('parseTransitionEntry', () => {
  it('reads all four parts', () => {
    expect(parseTransitionEntry('opacity 0.3s ease-in 0.1s')).toEqual(
      entry({ property: 'opacity', duration: '0.3s', timing: 'ease-in', delay: '0.1s' })
    );
  });

  it('takes the first time as duration and the second as delay', () => {
    const parsed = parseTransitionEntry('0.5s 2s color');
    expect(parsed?.duration).toBe('0.5s');
    expect(parsed?.delay).toBe('2s');
    expect(parsed?.property).toBe('color');
  });

  it('accepts milliseconds', () => {
    expect(parseTransitionEntry('all 200ms')?.duration).toBe('200ms');
  });

  it('keeps a cubic-bezier intact', () => {
    const parsed = parseTransitionEntry('transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)');
    expect(parsed?.timing).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
    expect(parsed?.duration).toBe('0.4s');
  });

  it('refuses more than two times', () => {
    expect(parseTransitionEntry('all 1s 2s 3s')).toBeNull();
  });

  it('refuses two properties', () => {
    expect(parseTransitionEntry('opacity color 1s')).toBeNull();
  });
});

describe('parseTransition', () => {
  it('treats none and empty as no entries', () => {
    expect(parseTransition('none')).toEqual([]);
    expect(parseTransition('')).toEqual([]);
  });

  it('splits entries on top-level commas only', () => {
    const entries = parseTransition('opacity 0.2s, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1)');
    expect(entries).toHaveLength(2);
    expect(entries?.[1].timing).toBe('cubic-bezier(0.4, 0, 0.2, 1)');
  });
});

describe('formatTransitionEntry', () => {
  it('writes the canonical order', () => {
    expect(
      formatTransitionEntry(
        entry({ property: 'opacity', duration: '0.3s', timing: 'ease', delay: '0.1s' })
      )
    ).toBe('opacity 0.3s ease 0.1s');
  });

  it('pins a zero duration when only a delay is set', () => {
    // Otherwise the delay would be read as the duration.
    expect(formatTransitionEntry(entry({ property: 'opacity', delay: '1s' }))).toBe(
      'opacity 0s 1s'
    );
  });

  it('omits parts left blank', () => {
    expect(formatTransitionEntry(entry({ property: 'all', duration: '0.2s' }))).toBe('all 0.2s');
  });
});

describe('formatTransition', () => {
  it('clears with none', () => {
    expect(formatTransition([])).toBe('none');
  });

  it('round-trips a multi-entry value', () => {
    const value = 'opacity 0.2s ease, transform 0.4s cubic-bezier(0.4, 0, 0.2, 1) 0.1s';
    const parsed = parseTransition(value);
    expect(parsed).not.toBeNull();
    expect(formatTransition(parsed ?? [])).toBe(value);
  });
});
