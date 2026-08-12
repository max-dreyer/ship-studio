/**
 * Reading and writing a single `linear-gradient()` / `radial-gradient()` as a
 * type, an angle and a list of colour stops.
 *
 * `background-image` holds far more than gradients (`url()`, several layers,
 * `none`), and even a gradient can carry syntax this editor has no field for
 * (colour hints, `at` positions, multiple layers). Anything beyond one plain
 * gradient is reported as unparsed so the panel keeps its text field instead
 * of dropping parts of the value on the next write.
 *
 * @module lib/cssGradient
 */

import { looksLikeColor, splitTopLevel } from './cssValue';

export type GradientType = 'linear' | 'radial';

export interface GradientStop {
  color: string;
  /** Empty when the stop has no explicit position. */
  position: string;
}

export interface Gradient {
  type: GradientType;
  /** Only meaningful for linear gradients; empty means the CSS default. */
  angle: string;
  stops: GradientStop[];
}

export const EMPTY_GRADIENT: Gradient = {
  type: 'linear',
  angle: '180deg',
  stops: [
    { color: '#000000', position: '0%' },
    { color: '#ffffff', position: '100%' },
  ],
};

const GRADIENT_FUNC = /^(linear|radial)-gradient\((.*)\)$/i;
/** An angle, or one of the `to <side>` forms. */
const ANGLE = /^(-?[\d.]+(?:deg|rad|grad|turn)|to\s+[a-z\s]+)$/i;

/** Parse one gradient, or null when it isn't a shape this editor can hold. */
export function parseGradient(value: string): Gradient | null {
  const v = value.trim();
  const m = GRADIENT_FUNC.exec(v);
  if (!m) return null;

  const type = m[1].toLowerCase() as GradientType;
  const args = splitTopLevel(m[2], 'comma');
  if (args.length < 2) return null;

  let angle = '';
  let rest = args;
  if (ANGLE.test(args[0])) {
    angle = args[0];
    rest = args.slice(1);
  } else if (/^(at|circle|ellipse|closest|farthest)/i.test(args[0])) {
    // Radial positioning has no field here — don't silently drop it.
    return null;
  }

  if (rest.length < 2) return null;

  const stops: GradientStop[] = [];
  for (const part of rest) {
    const tokens = splitTopLevel(part, 'space');
    // A bare position (a colour hint) has no field to hold it.
    if (tokens.length === 0 || tokens.length > 2) return null;
    if (!looksLikeColor(tokens[0])) return null;
    stops.push({ color: tokens[0], position: tokens[1] ?? '' });
  }

  return { type, angle, stops };
}

export function formatGradient(gradient: Gradient): string {
  const parts: string[] = [];
  // An angle is only valid on a linear gradient.
  if (gradient.type === 'linear' && gradient.angle.trim()) parts.push(gradient.angle.trim());
  for (const stop of gradient.stops) {
    const color = stop.color.trim();
    if (!color) continue;
    const position = stop.position.trim();
    parts.push(position ? `${color} ${position}` : color);
  }
  return `${gradient.type}-gradient(${parts.join(', ')})`;
}
