/**
 * Gradient parsing for the structured gradient editor.
 *
 * Focus: refusing everything that has no field here. `background-image` can
 * hold URLs, several layers and gradient syntax this editor doesn't model —
 * parsing those loosely would drop parts of the value on the next write.
 */

import { describe, it, expect } from 'vitest';
import { parseGradient, formatGradient, EMPTY_GRADIENT } from './cssGradient';

describe('parseGradient', () => {
  it('reads angle and stops', () => {
    expect(parseGradient('linear-gradient(90deg, red 0%, blue 100%)')).toEqual({
      type: 'linear',
      angle: '90deg',
      stops: [
        { color: 'red', position: '0%' },
        { color: 'blue', position: '100%' },
      ],
    });
  });

  it('accepts a gradient without an angle', () => {
    const g = parseGradient('linear-gradient(red, blue)');
    expect(g?.angle).toBe('');
    expect(g?.stops).toHaveLength(2);
  });

  it('accepts the to-side form', () => {
    expect(parseGradient('linear-gradient(to right, red, blue)')?.angle).toBe('to right');
  });

  it('keeps a function colour with its own commas intact', () => {
    const g = parseGradient('linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, #fff 100%)');
    expect(g?.stops[0]).toEqual({ color: 'rgba(0, 0, 0, 0.5)', position: '0%' });
  });

  it('reads a radial gradient', () => {
    expect(parseGradient('radial-gradient(red, blue)')?.type).toBe('radial');
  });

  it('refuses anything that is not a lone gradient', () => {
    expect(parseGradient('none')).toBeNull();
    expect(parseGradient('url(bg.png)')).toBeNull();
    expect(parseGradient('var(--bg)')).toBeNull();
    // Two layers — writing back would keep only the first.
    expect(parseGradient('linear-gradient(red, blue), url(x.png)')).toBeNull();
  });

  it('refuses radial positioning it has no field for', () => {
    expect(parseGradient('radial-gradient(circle at center, red, blue)')).toBeNull();
  });

  it('refuses a colour hint', () => {
    // The bare 50% between two stops is a hint, not a stop.
    expect(parseGradient('linear-gradient(red, 50%, blue)')).toBeNull();
  });

  it('refuses a single stop', () => {
    expect(parseGradient('linear-gradient(red)')).toBeNull();
  });
});

describe('formatGradient', () => {
  it('writes angle and stops', () => {
    expect(formatGradient(EMPTY_GRADIENT)).toBe(
      'linear-gradient(180deg, #000000 0%, #ffffff 100%)'
    );
  });

  it('drops the angle on a radial gradient, where it is invalid', () => {
    expect(formatGradient({ ...EMPTY_GRADIENT, type: 'radial' })).toBe(
      'radial-gradient(#000000 0%, #ffffff 100%)'
    );
  });

  it('omits an empty position', () => {
    expect(
      formatGradient({
        type: 'linear',
        angle: '',
        stops: [
          { color: 'red', position: '' },
          { color: 'blue', position: '' },
        ],
      })
    ).toBe('linear-gradient(red, blue)');
  });

  it('round-trips', () => {
    const value = 'linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, #fff 100%)';
    const parsed = parseGradient(value);
    expect(parsed).not.toBeNull();
    expect(formatGradient(parsed ?? EMPTY_GRADIENT)).toBe(value);
  });
});
