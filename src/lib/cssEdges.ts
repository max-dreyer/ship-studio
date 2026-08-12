/**
 * Per-edge borders and per-corner radii.
 *
 * Like `cssBoxModel`, but for the properties whose longhands don't follow the
 * spacing pattern. Two things differ and both are easy to get wrong:
 *
 *   - Naming. Spacing is `padding-top`; borders put the side in the middle
 *     (`border-top-width`), and radii name a corner (`border-top-left-radius`).
 *   - Order. The spacing shorthand runs top, right, bottom, left. The radius
 *     shorthand runs top-left, top-right, bottom-right, bottom-left, so the
 *     2-value form pairs opposite CORNERS, not opposite sides.
 *
 * Elliptical radii (`border-radius: 10px / 20px`) have no per-corner field
 * here, so a value containing a slash is reported as unparsed.
 *
 * @module lib/cssEdges
 */

import { splitTopLevel } from './cssValue';
import type { CssDeclaration } from './edit-css';

export const EDGE_SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type EdgeSide = (typeof EDGE_SIDES)[number];

/** In shorthand order: TL, TR, BR, BL. */
export const RADIUS_CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const;
export type RadiusCorner = (typeof RADIUS_CORNERS)[number];

/** Which grouped property is being edited. */
export type EdgeKind = 'border-width' | 'border-style' | 'border-color' | 'border-radius';

export type EdgePart = EdgeSide | RadiusCorner;

export interface EdgeChange {
  property: string;
  value: string | null;
}

/** The parts a kind is split into, in that kind's shorthand order. */
export function partsOf(kind: EdgeKind): readonly EdgePart[] {
  return kind === 'border-radius' ? RADIUS_CORNERS : EDGE_SIDES;
}

/** The longhand property name for one part. */
export function longhandFor(kind: EdgeKind, part: EdgePart): string {
  if (kind === 'border-radius') return `border-${part}-radius`;
  const facet = kind.slice('border-'.length); // width | style | color
  return `border-${part}-${facet}`;
}

/**
 * Expand a shorthand into its parts using the CSS 1-to-4 rules. Returns null
 * for values this module can't represent (empty, too many parts, or an
 * elliptical radius).
 */
export function expandEdgeShorthand(kind: EdgeKind, value: string): Record<string, string> | null {
  if (kind === 'border-radius' && value.includes('/')) return null;
  const list = splitTopLevel(value, 'space');
  if (list.length === 0 || list.length > 4) return null;
  const [a, b = a, c = a, d = b] = list;
  const parts = partsOf(kind);
  return { [parts[0]]: a, [parts[1]]: b, [parts[2]]: c, [parts[3]]: d };
}

function lastDecl(decls: CssDeclaration[], property: string): CssDeclaration | undefined {
  let found: CssDeclaration | undefined;
  for (const d of decls) {
    if (d.property.toLowerCase() === property) found = d;
  }
  return found;
}

export function hasEdgeShorthand(decls: CssDeclaration[], kind: EdgeKind): boolean {
  return lastDecl(decls, kind) !== undefined;
}

/**
 * The effective value of each part. Longhands win over the shorthand, matching
 * how `setEdge` writes them back.
 */
export function readEdges(decls: CssDeclaration[], kind: EdgeKind): Record<string, string> {
  const shorthand = lastDecl(decls, kind);
  const fromShorthand = shorthand ? expandEdgeShorthand(kind, shorthand.value) : null;
  const out: Record<string, string> = {};
  for (const part of partsOf(kind)) {
    out[part] = lastDecl(decls, longhandFor(kind, part))?.value ?? fromShorthand?.[part] ?? '';
  }
  return out;
}

/** True when every part currently holds the same value (so "All" applies). */
export function isUniform(decls: CssDeclaration[], kind: EdgeKind): boolean {
  const values = Object.values(readEdges(decls, kind));
  return values.every((v) => v === values[0]);
}

/**
 * Change set for setting one part, or every part when `part` is null.
 *
 * Setting all parts collapses back to the shorthand and drops the longhands —
 * the tidiest result, and what Webflow's "all" control produces.
 */
export function setEdge(
  decls: CssDeclaration[],
  kind: EdgeKind,
  part: EdgePart | null,
  value: string | null
): EdgeChange[] {
  const next = value?.trim() ? value.trim() : null;

  if (part === null) {
    const changes: EdgeChange[] = [{ property: kind, value: next }];
    for (const p of partsOf(kind)) changes.push({ property: longhandFor(kind, p), value: null });
    return changes;
  }

  if (!hasEdgeShorthand(decls, kind)) {
    return [{ property: longhandFor(kind, part), value: next }];
  }

  // Expand the shorthand so it can't contradict the longhand we're writing.
  const current = readEdges(decls, kind);
  const changes: EdgeChange[] = [{ property: kind, value: null }];
  for (const p of partsOf(kind)) {
    const v = p === part ? next : (current[p] ?? '');
    changes.push({ property: longhandFor(kind, p), value: v === '' ? null : v });
  }
  return changes;
}
