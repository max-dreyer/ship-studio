/**
 * Reading and writing the `transition` shorthand as structured entries.
 *
 * One entry is `<property> <duration> <timing-function> <delay>`, and a value
 * may hold several separated by commas. The order of the two time values is
 * what makes this worth parsing carefully: CSS reads the FIRST time as the
 * duration and the SECOND as the delay, regardless of where they sit relative
 * to the other parts.
 *
 * As with shadows, a value we can't decompose is reported as null so the
 * editor can fall back to plain text instead of rewriting it.
 *
 * @module lib/cssTransition
 */

import { splitTopLevel } from './cssValue';

export interface TransitionEntry {
  property: string;
  duration: string;
  timing: string;
  delay: string;
}

export const EMPTY_TRANSITION: TransitionEntry = {
  property: 'all',
  duration: '0.2s',
  timing: 'ease',
  delay: '',
};

/** Timing functions offered in the dropdown. */
export const TIMING_FUNCTIONS = [
  'ease',
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'step-start',
  'step-end',
] as const;

/** A time is a number with s or ms. */
const TIME = /^-?(?:\d+\.?\d*|\.\d+)m?s$/i;

function isTime(token: string): boolean {
  return TIME.test(token.trim());
}

function isTiming(token: string): boolean {
  const t = token.trim().toLowerCase();
  return (
    (TIMING_FUNCTIONS as readonly string[]).includes(t) ||
    t.startsWith('cubic-bezier(') ||
    t.startsWith('steps(')
  );
}

/** Parse one entry, or null when it holds more parts than CSS allows. */
export function parseTransitionEntry(part: string): TransitionEntry | null {
  const tokens = splitTopLevel(part, 'space');
  if (tokens.length === 0) return null;

  const times: string[] = [];
  let timing = '';
  let property = '';

  for (const token of tokens) {
    if (isTime(token)) {
      times.push(token);
    } else if (isTiming(token)) {
      if (timing) return null;
      timing = token;
    } else {
      if (property) return null;
      property = token;
    }
  }

  if (times.length > 2) return null;
  // CSS takes the first time as duration, the second as delay.
  const [duration = '', delay = ''] = times;
  return { property, duration, timing, delay };
}

/** Parse a full value into entries, or null if any entry is unrecognisable. */
export function parseTransition(value: string): TransitionEntry[] | null {
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'none') return [];
  const entries: TransitionEntry[] = [];
  for (const part of splitTopLevel(v, 'comma')) {
    const entry = parseTransitionEntry(part);
    if (!entry) return null;
    entries.push(entry);
  }
  return entries;
}

/** Serialise one entry in CSS order, omitting the parts left blank. */
export function formatTransitionEntry(entry: TransitionEntry): string {
  const parts: string[] = [];
  if (entry.property.trim()) parts.push(entry.property.trim());
  // A delay without a duration would be read AS the duration, so pin it to 0s.
  const duration = entry.duration.trim();
  const delay = entry.delay.trim();
  if (duration || delay) parts.push(duration || '0s');
  if (entry.timing.trim()) parts.push(entry.timing.trim());
  if (delay) parts.push(delay);
  return parts.join(' ');
}

export function formatTransition(entries: TransitionEntry[]): string {
  if (entries.length === 0) return 'none';
  return entries.map(formatTransitionEntry).join(', ');
}
