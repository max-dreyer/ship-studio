/**
 * Resolving what a property is actually worth on the element.
 *
 * Focus: the cases where showing the wrong thing would mislead — a media query
 * that isn't currently applying must not count, inline styles must (they win
 * in the browser), and the edited rule's own values must be distinguishable
 * from everything else.
 */

import { describe, it, expect } from 'vitest';
import { effectiveValues, inheritedValue } from './cssEffective';
import type { CascadeRow } from './cssCascade';

type DeclInit = { prop: string; value: string; active?: boolean };

function row(selector: string, decls: DeclInit[], over: Partial<CascadeRow> = {}): CascadeRow {
  return {
    index: 0,
    selector,
    declarations: decls.map((d) => ({
      prop: d.prop,
      value: d.value,
      important: false,
      active: d.active ?? true,
    })),
    specificity: [0, 1, 0],
    mediaText: null,
    mediaMinPx: null,
    inactiveMedia: false,
    layer: null,
    origin: 'author',
    editable: true,
    ...over,
  };
}

/** Row identity for these tests: the selector is unique enough. */
const keyOf = (r: CascadeRow) => r.selector ?? '';

describe('effectiveValues', () => {
  it('reports the winning declaration per property', () => {
    const rows = [
      row('.a', [{ prop: 'color', value: 'red' }]),
      row('.b', [{ prop: 'display', value: 'block' }]),
    ];
    const eff = effectiveValues(rows, keyOf, null);
    expect(eff.get('color')?.value).toBe('red');
    expect(eff.get('display')?.value).toBe('block');
  });

  it('ignores declarations the cascade marked as overridden', () => {
    const rows = [
      row('.loser', [{ prop: 'color', value: 'red', active: false }]),
      row('.winner', [{ prop: 'color', value: 'blue' }]),
    ];
    expect(effectiveValues(rows, keyOf, null).get('color')?.value).toBe('blue');
  });

  it('skips a media query that is not currently applying', () => {
    const rows = [
      row('.base', [{ prop: 'font-size', value: '16px' }]),
      row('.wide', [{ prop: 'font-size', value: '24px' }], {
        mediaText: '(min-width: 1200px)',
        inactiveMedia: true,
      }),
    ];
    expect(effectiveValues(rows, keyOf, null).get('font-size')?.value).toBe('16px');
  });

  it('counts inline styles and names them', () => {
    const rows = [
      row('.a', [{ prop: 'color', value: 'red', active: false }]),
      row(null as unknown as string, [{ prop: 'color', value: 'green' }], { origin: 'inline' }),
    ];
    const hit = effectiveValues(rows, keyOf, null).get('color');
    expect(hit?.value).toBe('green');
    expect(hit?.source).toBe('element.style');
  });

  it('marks the edited rule as own', () => {
    const rows = [
      row('.mine', [{ prop: 'color', value: 'red' }]),
      row('.other', [{ prop: 'display', value: 'flex' }]),
    ];
    const eff = effectiveValues(rows, keyOf, '.mine');
    expect(eff.get('color')?.own).toBe(true);
    expect(eff.get('display')?.own).toBe(false);
  });

  it('is case-insensitive on property names', () => {
    const rows = [row('.a', [{ prop: 'Color', value: 'red' }])];
    expect(effectiveValues(rows, keyOf, null).get('color')?.value).toBe('red');
  });
});

describe('inheritedValue', () => {
  const rows = [
    row('.mine', [{ prop: 'color', value: 'red' }]),
    row('.other', [{ prop: 'display', value: 'flex' }]),
  ];
  const eff = effectiveValues(rows, keyOf, '.mine');

  it('returns the value when it comes from elsewhere', () => {
    expect(inheritedValue(eff, 'display')?.value).toBe('flex');
  });

  it('returns null for a property the edited rule owns', () => {
    // The field shows the real value there — a placeholder would duplicate it.
    expect(inheritedValue(eff, 'color')).toBeNull();
  });

  it('returns null for a property nothing sets', () => {
    expect(inheritedValue(eff, 'margin')).toBeNull();
    expect(inheritedValue(undefined, 'margin')).toBeNull();
  });
});
