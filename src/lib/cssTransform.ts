/**
 * Reading and writing the `transform` shorthand as separate move, rotate,
 * scale and skew fields.
 *
 * `transform` is an ordered list of functions, and the same effect can be
 * written several ways: `translate(10px, 20px)` or `translateX(10px)
 * translateY(20px)`, `scale(2)` or `scale(2, 2)`. This flattens the forms we
 * can represent into one set of fields and writes them back in a fixed order.
 *
 * Transform functions do NOT commute — `rotate() translate()` moves along the
 * rotated axis, `translate() rotate()` does not. Since the editor always emits
 * the same order, a value whose functions appear in a different order can't be
 * round-tripped safely and is reported as unparsed. Same for functions with no
 * field to hold them (`matrix`, `perspective`, 3D variants).
 *
 * @module lib/cssTransform
 */

import { splitTopLevel } from './cssValue';

export interface TransformParts {
  translateX: string;
  translateY: string;
  rotate: string;
  scaleX: string;
  scaleY: string;
  skewX: string;
  skewY: string;
}

export const EMPTY_TRANSFORM: TransformParts = {
  translateX: '',
  translateY: '',
  rotate: '',
  scaleX: '',
  scaleY: '',
  skewX: '',
  skewY: '',
};

/** The order we always write, and the order an input must already be in. */
const WRITE_ORDER = ['translate', 'rotate', 'scale', 'skew'] as const;
type Group = (typeof WRITE_ORDER)[number];

/** Which group each supported function belongs to. */
const GROUP_OF: Record<string, Group> = {
  translate: 'translate',
  translatex: 'translate',
  translatey: 'translate',
  rotate: 'rotate',
  scale: 'scale',
  scalex: 'scale',
  scaley: 'scale',
  skew: 'skew',
  skewx: 'skew',
  skewy: 'skew',
};

const FUNC = /^([a-z]+)\((.*)\)$/i;

/** Parse into fields, or null when the value isn't safely representable. */
export function parseTransform(value: string): TransformParts | null {
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'none') return { ...EMPTY_TRANSFORM };

  const parts = { ...EMPTY_TRANSFORM };
  const seen: Group[] = [];

  for (const token of splitTopLevel(v, 'space')) {
    const m = FUNC.exec(token);
    if (!m) return null;
    const name = m[1].toLowerCase();
    const group = GROUP_OF[name];
    if (!group) return null;

    // Each group may appear once, and only in the order we write.
    if (seen.includes(group)) return null;
    if (seen.length && WRITE_ORDER.indexOf(group) < WRITE_ORDER.indexOf(seen[seen.length - 1])) {
      return null;
    }
    seen.push(group);

    const args = splitTopLevel(m[2], 'comma');
    if (args.length === 0 || args.length > 2) return null;

    switch (name) {
      case 'translate':
        parts.translateX = args[0];
        parts.translateY = args[1] ?? '';
        break;
      case 'translatex':
        if (args.length !== 1) return null;
        parts.translateX = args[0];
        break;
      case 'translatey':
        if (args.length !== 1) return null;
        parts.translateY = args[0];
        break;
      case 'rotate':
        if (args.length !== 1) return null;
        parts.rotate = args[0];
        break;
      case 'scale':
        parts.scaleX = args[0];
        // `scale(2)` means both axes; keep that explicit in the fields.
        parts.scaleY = args[1] ?? args[0];
        break;
      case 'scalex':
        if (args.length !== 1) return null;
        parts.scaleX = args[0];
        break;
      case 'scaley':
        if (args.length !== 1) return null;
        parts.scaleY = args[0];
        break;
      case 'skew':
        parts.skewX = args[0];
        parts.skewY = args[1] ?? '';
        break;
      case 'skewx':
        if (args.length !== 1) return null;
        parts.skewX = args[0];
        break;
      case 'skewy':
        if (args.length !== 1) return null;
        parts.skewY = args[0];
        break;
      default:
        return null;
    }
  }
  return parts;
}

/** Serialise the fields, omitting groups left empty. */
export function formatTransform(parts: TransformParts): string {
  const out: string[] = [];
  const tx = parts.translateX.trim();
  const ty = parts.translateY.trim();
  if (tx && ty) out.push(`translate(${tx}, ${ty})`);
  else if (tx) out.push(`translateX(${tx})`);
  else if (ty) out.push(`translateY(${ty})`);

  const rotate = parts.rotate.trim();
  if (rotate) out.push(`rotate(${rotate})`);

  const sx = parts.scaleX.trim();
  const sy = parts.scaleY.trim();
  if (sx && sy) out.push(sx === sy ? `scale(${sx})` : `scale(${sx}, ${sy})`);
  else if (sx) out.push(`scaleX(${sx})`);
  else if (sy) out.push(`scaleY(${sy})`);

  const kx = parts.skewX.trim();
  const ky = parts.skewY.trim();
  if (kx && ky) out.push(`skew(${kx}, ${ky})`);
  else if (kx) out.push(`skewX(${kx})`);
  else if (ky) out.push(`skewY(${ky})`);

  return out.length === 0 ? 'none' : out.join(' ');
}
