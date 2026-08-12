/**
 * Box-model reading and writing for the CSS editor's spacing box.
 *
 * The box shows four editable sides for padding and margin, but a rule may
 * express those as a shorthand (`padding: 10px 20px`), as longhands
 * (`padding-top: 10px`), or as both. This module resolves what each side is
 * actually worth, and turns a single-side edit into a change set that leaves
 * the rule unambiguous.
 *
 * Writing strategy: when a shorthand is present, editing one side expands it
 * into four longhands and drops the shorthand. That costs one extra
 * declaration but removes the ordering trap — a longhand only beats a
 * shorthand if it comes later in the rule, and we don't control where the
 * writer inserts it.
 *
 * @module lib/cssBoxModel
 */

import { splitTopLevel } from './cssValue';
import type { CssDeclaration } from './edit-css';

export { splitTopLevel };

export const BOX_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type BoxSide = (typeof BOX_SIDES)[number];
export type BoxBase = 'padding' | 'margin';

export type BoxSides = Record<BoxSide, string>;

/** A property to write (or remove, when value is null). */
export interface BoxChange {
  property: string;
  value: string | null;
}

/**
 * Expand a box shorthand to its four sides, following the CSS 1-to-4 value
 * rules. Returns null when the value isn't a usable shorthand (empty, or more
 * than four parts).
 */
export function expandBoxShorthand(value: string): BoxSides | null {
  const parts = splitTopLevel(value);
  if (parts.length === 0 || parts.length > 4) return null;
  const [a, b = a, c = a, d = b] = parts;
  return { top: a, right: b, bottom: c, left: d };
}

/** Find a declaration by property name, last one winning (CSS order). */
function lastDecl(decls: CssDeclaration[], property: string): CssDeclaration | undefined {
  let found: CssDeclaration | undefined;
  for (const d of decls) {
    if (d.property.toLowerCase() === property) found = d;
  }
  return found;
}

/** Whether the rule states this box as a shorthand. */
export function hasShorthand(decls: CssDeclaration[], base: BoxBase): boolean {
  return lastDecl(decls, base) !== undefined;
}

/**
 * The effective value of each side, as the box should display it. Longhands
 * win over the shorthand, matching how the declarations are written back
 * (longhands are always emitted after the shorthand is removed).
 */
export function readBoxSides(decls: CssDeclaration[], base: BoxBase): BoxSides {
  const shorthand = lastDecl(decls, base);
  const fromShorthand = shorthand ? expandBoxShorthand(shorthand.value) : null;
  const sides: BoxSides = { top: '', right: '', bottom: '', left: '' };

  for (const side of BOX_SIDES) {
    const longhand = lastDecl(decls, `${base}-${side}`);
    sides[side] = longhand?.value ?? fromShorthand?.[side] ?? '';
  }
  return sides;
}

/**
 * Change set for setting one side. Pass null to clear it.
 *
 * With a shorthand present, all four sides are written out and the shorthand
 * removed. Without one, only the touched side changes.
 */
export function setBoxSide(
  decls: CssDeclaration[],
  base: BoxBase,
  side: BoxSide,
  value: string | null
): BoxChange[] {
  const trimmed = value?.trim() ?? '';
  const next = trimmed === '' ? null : trimmed;

  if (!hasShorthand(decls, base)) {
    return [{ property: `${base}-${side}`, value: next }];
  }

  const current = readBoxSides(decls, base);
  const changes: BoxChange[] = [{ property: base, value: null }];
  for (const s of BOX_SIDES) {
    const v = s === side ? next : current[s];
    changes.push({ property: `${base}-${s}`, value: v === '' ? null : v });
  }
  return changes;
}
