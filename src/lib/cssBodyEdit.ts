/**
 * Setting properties on a parsed rule body.
 *
 * The structured controls speak `(property, value)`; the cascade editor speaks
 * `RuleBody` (an ordered list of declarations and nested rules). This is the
 * adapter between them, and it is deliberately conservative about order:
 *
 *   - An existing declaration is replaced in place, so hand-authored ordering
 *     survives an edit. That matters for shorthand-then-longhand pairs, where
 *     order decides the winner.
 *   - A new declaration is appended.
 *   - Only the LAST occurrence of a repeated property is touched, since that's
 *     the one the cascade uses.
 *
 * Nested rules are never touched.
 *
 * @module lib/cssBodyEdit
 */

import { addDeclaration, declarations, removeItem, replaceItem, type RuleBody } from './cssBody';

/** One property change; a null value removes the declaration. */
export interface BodyPropertyChange {
  property: string;
  value: string | null;
}

/** Index of the last declaration for `property`, or -1. */
function lastIndexOfProp(body: RuleBody, property: string): number {
  const target = property.trim().toLowerCase();
  let found = -1;
  for (const decl of declarations(body)) {
    if (decl.prop.trim().toLowerCase() === target) found = decl.index;
  }
  return found;
}

/** Read a property's current value ('' when unset). */
export function bodyProperty(body: RuleBody, property: string): string {
  const index = lastIndexOfProp(body, property);
  if (index === -1) return '';
  return declarations(body).find((d) => d.index === index)?.value ?? '';
}

/** Set (or remove, with a null value) one property. */
export function setBodyProperty(body: RuleBody, property: string, value: string | null): RuleBody {
  const index = lastIndexOfProp(body, property);
  const prop = property.trim();

  if (value === null || value.trim() === '') {
    return index === -1 ? body : removeItem(body, index);
  }

  const next = value.trim();
  if (index === -1) {
    return addDeclaration(body, { prop, value: next, important: false });
  }
  // Keep the existing !important flag — the controls don't model it, and
  // silently dropping it would change which declaration wins.
  const existing = declarations(body).find((d) => d.index === index);
  return replaceItem(body, index, {
    kind: 'decl',
    prop,
    value: next,
    important: existing?.important ?? false,
  });
}

/**
 * Apply several changes in order. Used by the controls that span properties
 * (the spacing box and the per-edge control), where a shorthand is removed and
 * longhands written in one go.
 */
export function setBodyProperties(body: RuleBody, changes: BodyPropertyChange[]): RuleBody {
  return changes.reduce((acc, c) => setBodyProperty(acc, c.property, c.value), body);
}
