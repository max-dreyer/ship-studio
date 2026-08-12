/**
 * Shadow parsing for the structured shadow editor.
 *
 * Focus: values whose own punctuation breaks naive parsers (`rgba(0, 0, 0, .5)`
 * has commas that are not layer separators), and the refusal path — a value we
 * can't read must be reported as unparsed, never silently rewritten.
 */

import { describe, it, expect } from 'vitest';
import {
  parseShadow,
  parseShadowLayer,
  formatShadow,
  formatShadowLayer,
  type ShadowLayer,
} from './cssShadow';

const layer = (over: Partial<ShadowLayer> = {}): ShadowLayer => ({
  offsetX: '0',
  offsetY: '2px',
  blur: '',
  spread: '',
  color: '',
  inset: false,
  ...over,
});

describe('parseShadowLayer', () => {
  it('reads the two required offsets', () => {
    expect(parseShadowLayer('2px 4px')).toEqual(layer({ offsetX: '2px', offsetY: '4px' }));
  });

  it('reads blur and spread', () => {
    expect(parseShadowLayer('1px 2px 3px 4px')).toEqual(
      layer({ offsetX: '1px', offsetY: '2px', blur: '3px', spread: '4px' })
    );
  });

  it('reads the colour wherever it sits', () => {
    expect(parseShadowLayer('red 1px 2px')?.color).toBe('red');
    expect(parseShadowLayer('1px 2px red')?.color).toBe('red');
  });

  it('keeps a function colour intact', () => {
    const parsed = parseShadowLayer('0 2px 4px rgba(0, 0, 0, 0.25)');
    expect(parsed?.color).toBe('rgba(0, 0, 0, 0.25)');
    expect(parsed?.blur).toBe('4px');
  });

  it('reads inset', () => {
    expect(parseShadowLayer('inset 0 1px 2px')?.inset).toBe(true);
  });

  it('refuses a layer without both offsets', () => {
    expect(parseShadowLayer('2px')).toBeNull();
    expect(parseShadowLayer('red')).toBeNull();
  });

  it('refuses more lengths than CSS allows', () => {
    expect(parseShadowLayer('1px 2px 3px 4px 5px')).toBeNull();
  });

  it('refuses two colours in one layer', () => {
    expect(parseShadowLayer('1px 2px red blue')).toBeNull();
  });
});

describe('parseShadow', () => {
  it('treats none and empty as no layers', () => {
    expect(parseShadow('none')).toEqual([]);
    expect(parseShadow('')).toEqual([]);
  });

  it('splits layers on top-level commas only', () => {
    const layers = parseShadow('0 1px 2px rgba(0, 0, 0, 0.3), inset 0 0 4px red');
    expect(layers).toHaveLength(2);
    expect(layers?.[0].color).toBe('rgba(0, 0, 0, 0.3)');
    expect(layers?.[1].inset).toBe(true);
  });

  it('reports the whole value as unparsed when one layer fails', () => {
    expect(parseShadow('0 1px 2px, var(--shadow)')).toBeNull();
  });
});

describe('formatShadowLayer', () => {
  it('writes the canonical order', () => {
    expect(
      formatShadowLayer(layer({ offsetX: '1px', offsetY: '2px', blur: '3px', color: 'red' }))
    ).toBe('1px 2px 3px red');
  });

  it('puts inset first', () => {
    expect(formatShadowLayer(layer({ inset: true, offsetX: '0', offsetY: '0' }))).toBe('inset 0 0');
  });

  it('fills in a zero blur when only spread is set', () => {
    // `0 0 4px` would otherwise read as a blur, not a spread.
    expect(formatShadowLayer(layer({ offsetX: '0', offsetY: '0', spread: '4px' }))).toBe(
      '0 0 0 4px'
    );
  });

  it('defaults empty offsets to zero', () => {
    expect(formatShadowLayer(layer({ offsetX: '', offsetY: '' }))).toBe('0 0');
  });
});

describe('formatShadow', () => {
  it('clears with none when there are no layers', () => {
    expect(formatShadow([])).toBe('none');
  });

  it('round-trips a multi-layer value', () => {
    const value = '0 1px 2px rgba(0, 0, 0, 0.3), inset 0 0 4px 1px red';
    const parsed = parseShadow(value);
    expect(parsed).not.toBeNull();
    expect(formatShadow(parsed ?? [])).toBe(value);
  });
});
