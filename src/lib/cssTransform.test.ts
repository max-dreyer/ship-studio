/**
 * Transform parsing for the structured transform editor.
 *
 * Focus: the refusal cases. Transform functions don't commute, so a value
 * whose order differs from the one we emit must NOT be silently reordered —
 * that would move the element somewhere else on screen.
 */

import { describe, it, expect } from 'vitest';
import {
  parseTransform,
  formatTransform,
  EMPTY_TRANSFORM,
  type TransformParts,
} from './cssTransform';

const parts = (over: Partial<TransformParts> = {}): TransformParts => ({
  ...EMPTY_TRANSFORM,
  ...over,
});

describe('parseTransform', () => {
  it('treats none and empty as no transform', () => {
    expect(parseTransform('none')).toEqual(EMPTY_TRANSFORM);
    expect(parseTransform('')).toEqual(EMPTY_TRANSFORM);
  });

  it('splits a two-argument translate into both axes', () => {
    expect(parseTransform('translate(10px, 20px)')).toEqual(
      parts({ translateX: '10px', translateY: '20px' })
    );
  });

  it('reads the single-axis forms', () => {
    expect(parseTransform('translateX(10px)')).toEqual(parts({ translateX: '10px' }));
    expect(parseTransform('translateY(-4px)')).toEqual(parts({ translateY: '-4px' }));
  });

  it('expands a one-argument scale to both axes', () => {
    expect(parseTransform('scale(1.5)')).toEqual(parts({ scaleX: '1.5', scaleY: '1.5' }));
  });

  it('reads several functions in the written order', () => {
    expect(parseTransform('translate(1px, 2px) rotate(45deg) scale(2)')).toEqual(
      parts({
        translateX: '1px',
        translateY: '2px',
        rotate: '45deg',
        scaleX: '2',
        scaleY: '2',
      })
    );
  });

  it('refuses an order it would change on write', () => {
    // rotate-then-translate moves along the rotated axis; re-emitting it as
    // translate-then-rotate would put the element somewhere else.
    expect(parseTransform('rotate(45deg) translate(10px)')).toBeNull();
  });

  it('refuses a repeated group', () => {
    expect(parseTransform('translateX(1px) translateY(2px)')).toBeNull();
  });

  it('refuses functions it has no field for', () => {
    expect(parseTransform('matrix(1, 0, 0, 1, 0, 0)')).toBeNull();
    expect(parseTransform('perspective(500px)')).toBeNull();
    expect(parseTransform('translate3d(1px, 2px, 3px)')).toBeNull();
    expect(parseTransform('rotateX(45deg)')).toBeNull();
  });

  it('refuses a value that is not a function list', () => {
    expect(parseTransform('var(--transform)')).toBeNull();
    expect(parseTransform('10px')).toBeNull();
  });
});

describe('formatTransform', () => {
  it('clears with none', () => {
    expect(formatTransform(EMPTY_TRANSFORM)).toBe('none');
  });

  it('joins both axes into one function', () => {
    expect(formatTransform(parts({ translateX: '1px', translateY: '2px' }))).toBe(
      'translate(1px, 2px)'
    );
  });

  it('uses the single-axis form when only one is set', () => {
    expect(formatTransform(parts({ translateY: '2px' }))).toBe('translateY(2px)');
  });

  it('collapses equal scales back to one argument', () => {
    expect(formatTransform(parts({ scaleX: '2', scaleY: '2' }))).toBe('scale(2)');
    expect(formatTransform(parts({ scaleX: '2', scaleY: '3' }))).toBe('scale(2, 3)');
  });

  it('writes groups in the canonical order', () => {
    expect(
      formatTransform(parts({ rotate: '45deg', translateX: '1px', scaleX: '2', scaleY: '2' }))
    ).toBe('translateX(1px) rotate(45deg) scale(2)');
  });

  it('round-trips a full value', () => {
    const value = 'translate(1px, 2px) rotate(45deg) scale(2) skew(10deg, 5deg)';
    const parsed = parseTransform(value);
    expect(parsed).not.toBeNull();
    expect(formatTransform(parsed ?? EMPTY_TRANSFORM)).toBe(value);
  });
});
