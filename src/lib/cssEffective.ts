/**
 * What a property is actually worth on the selected element.
 *
 * The Visual view edits one rule, but a control that shows nothing whenever
 * that rule is silent is misleading: the element may well be `display: block`
 * from a rule further down the cascade. This resolves the winning declaration
 * per property across every matched rule, and says where it came from.
 *
 * The cascade walker already marks the winner (`active`), so this is a fold
 * over the rows rather than a re-implementation of the cascade. Inline styles
 * count — they win in the browser, so hiding them would be a lie — and are
 * labelled as such.
 *
 * @module lib/cssEffective
 */

import type { CascadeRow } from './cssCascade';

export interface EffectiveValue {
  value: string;
  /** Where it comes from: a selector, or `element.style` for inline. */
  source: string;
  /** True when it's set by the rule the panel is currently editing. */
  own: boolean;
}

/**
 * Resolve every property the element gets, keyed by lowercase property name.
 *
 * `ownKey` names the rule being edited (its `rowKey`), so each entry can say
 * whether the value is the user's own or comes from elsewhere.
 */
export function effectiveValues(
  rows: CascadeRow[],
  keyOf: (row: CascadeRow) => string,
  ownKey: string | null
): Map<string, EffectiveValue> {
  const out = new Map<string, EffectiveValue>();

  for (const row of rows) {
    // A rule inside a media query that doesn't currently apply isn't part of
    // what the user sees, so it must not be reported as the current state.
    if (row.inactiveMedia) continue;

    const source = row.origin === 'inline' ? 'element.style' : (row.selector ?? '');
    const own = ownKey !== null && keyOf(row) === ownKey;

    for (const decl of row.declarations) {
      // `active` is the walker's verdict on which declaration wins.
      if (!decl.active) continue;
      out.set(decl.prop.trim().toLowerCase(), { value: decl.value, source, own });
    }
  }
  return out;
}

/**
 * Fill the gaps with what the browser actually renders.
 *
 * The cascade only carries properties some rule declares. Most of an element's
 * appearance comes from inheritance or the UA default, and those left every
 * control blank — a panel claiming the element has no font size when it plainly
 * has one. Declared values still win: this only adds what the cascade is
 * silent about.
 */
export function withComputedFallback(
  effective: Map<string, EffectiveValue>,
  computed: Record<string, string> | undefined
): Map<string, EffectiveValue> {
  if (!computed) return effective;
  const out = new Map(effective);
  for (const [prop, value] of Object.entries(computed)) {
    const key = prop.trim().toLowerCase();
    if (!value || out.has(key)) continue;
    out.set(key, { value, source: 'computed', own: false });
  }
  return out;
}

/**
 * The value a control should display as a placeholder: what the element has
 * now, when the edited rule doesn't set it itself. Returns null when the rule
 * owns the property (the field shows the real value) or nothing sets it.
 */
export function inheritedValue(
  effective: Map<string, EffectiveValue> | undefined,
  property: string
): EffectiveValue | null {
  const hit = effective?.get(property.trim().toLowerCase());
  if (!hit || hit.own) return null;
  return hit;
}
