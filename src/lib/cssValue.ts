/**
 * Splitting CSS values without tripping over their own punctuation.
 *
 * Every structured editor in the panel (shadows, transforms, transitions, box
 * shorthands) has to break a value into parts, and every one of them meets the
 * same trap: `rgba(0, 0, 0, .5)` contains commas, `calc(1px + 2px)` contains
 * spaces, and a naive split shreds both. This does the depth-aware split once.
 *
 * @module lib/cssValue
 */

/** What separates the parts: top-level whitespace, or top-level commas. */
export type ValueSeparator = 'space' | 'comma';

/**
 * Split a value at its top-level separators, ignoring anything inside
 * parentheses. Empty parts are dropped, and each part is trimmed.
 */
export function splitTopLevel(value: string, separator: ValueSeparator = 'space'): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';

  const flush = () => {
    const part = current.trim();
    if (part) out.push(part);
    current = '';
  };

  for (const ch of value.trim()) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);

    if (depth === 0) {
      if (separator === 'comma' && ch === ',') {
        flush();
        continue;
      }
      if (separator === 'space' && /\s/.test(ch)) {
        flush();
        continue;
      }
    }
    current += ch;
  }
  flush();
  return out;
}

/** True when the part looks like a colour rather than a length or keyword. */
export function looksLikeColor(part: string): boolean {
  const p = part.trim().toLowerCase();
  if (p.startsWith('#')) return true;
  if (/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/.test(p)) return true;
  if (p === 'transparent' || p === 'currentcolor') return true;
  // A bare word that isn't a length and isn't a known keyword is most likely a
  // named colour (red, rebeccapurple). Lengths always carry a digit.
  return /^[a-z]+$/.test(p) && !['inset', 'none', 'initial', 'inherit', 'unset'].includes(p);
}
