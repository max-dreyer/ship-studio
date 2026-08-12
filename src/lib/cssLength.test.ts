/**
 * Numeric behavior of the CSS length fields.
 *
 * Focus: a scrub or arrow key must never damage a value it doesn't understand,
 * and stepping must not leak float noise (0.1 + 0.2) into the user's source.
 */

import { describe, it, expect } from 'vitest';
import {
  parseLength,
  isScrubbable,
  formatLength,
  stepLength,
  withUnit,
  stepRuleFor,
  scrubSensitivity,
} from './cssLength';

describe('parseLength', () => {
  it('reads a number with its unit', () => {
    expect(parseLength('16px')).toEqual({ num: 16, unit: 'px' });
    expect(parseLength('1.5rem')).toEqual({ num: 1.5, unit: 'rem' });
    expect(parseLength('50%')).toEqual({ num: 50, unit: '%' });
    expect(parseLength('-4px')).toEqual({ num: -4, unit: 'px' });
    expect(parseLength('.5em')).toEqual({ num: 0.5, unit: 'em' });
  });

  it('reads a unitless number', () => {
    expect(parseLength('1.5')).toEqual({ num: 1.5, unit: '' });
    expect(parseLength('0')).toEqual({ num: 0, unit: '' });
  });

  it('refuses anything that is not a lone number', () => {
    expect(parseLength('auto')).toBeNull();
    expect(parseLength('calc(100% - 2rem)')).toBeNull();
    expect(parseLength('var(--gap)')).toBeNull();
    expect(parseLength('0 0 4px red')).toBeNull();
    expect(parseLength('')).toBeNull();
  });
});

describe('isScrubbable', () => {
  it('accepts numbers and empty fields, rejects expressions', () => {
    expect(isScrubbable('16px')).toBe(true);
    expect(isScrubbable('')).toBe(true);
    expect(isScrubbable('auto')).toBe(false);
    expect(isScrubbable('calc(100% - 2rem)')).toBe(false);
  });
});

describe('stepLength', () => {
  it('steps by the property default', () => {
    expect(stepLength('16px', 'width', 1)).toBe('17px');
    expect(stepLength('16px', 'width', -1)).toBe('15px');
  });

  it('uses the big step when shift is held', () => {
    expect(stepLength('16px', 'width', 1, true)).toBe('26px');
  });

  it('starts an empty field at the property unit', () => {
    expect(stepLength('', 'width', 1)).toBe('1px');
    expect(stepLength('', 'opacity', 1)).toBe('0.05');
  });

  it('keeps float arithmetic out of the source', () => {
    // 0.1 + 0.2 would otherwise write 0.30000000000000004.
    expect(stepLength('0.2', 'line-height', 1)).toBe('0.3');
    expect(stepLength('0.1', 'opacity', 1)).toBe('0.15');
  });

  it('honors per-property bounds', () => {
    expect(stepLength('1', 'opacity', 1)).toBe('1');
    expect(stepLength('0', 'opacity', -1)).toBe('0');
    expect(stepLength('900', 'font-weight', 1)).toBe('900');
  });

  it('leaves expressions and keywords untouched', () => {
    expect(stepLength('auto', 'width', 1)).toBe('auto');
    expect(stepLength('calc(100% - 2rem)', 'width', 1)).toBe('calc(100% - 2rem)');
    expect(stepLength('var(--gap)', 'gap', -3)).toBe('var(--gap)');
  });

  it('rounds integers-only properties', () => {
    expect(stepLength('3', 'z-index', 1)).toBe('4');
    expect(stepRuleFor('z-index').precision).toBe(0);
  });
});

describe('formatLength', () => {
  it('drops a unit from a bare zero but keeps percent', () => {
    expect(formatLength({ num: 0, unit: 'px' })).toBe('0');
    expect(formatLength({ num: 0, unit: '%' })).toBe('0%');
  });

  it('trims trailing zeros', () => {
    expect(formatLength({ num: 1.5, unit: 'rem' })).toBe('1.5rem');
    expect(formatLength({ num: 16.0, unit: 'px' })).toBe('16px');
  });
});

describe('withUnit', () => {
  it('keeps the number and swaps the unit', () => {
    expect(withUnit('16px', '%', 'width')).toBe('16%');
    expect(withUnit('1.5rem', 'px', 'width')).toBe('1.5px');
  });

  it('shows the unit even on zero', () => {
    expect(withUnit('0', 'px', 'width')).toBe('0px');
  });

  it('makes a value unitless', () => {
    expect(withUnit('1.5rem', '', 'line-height')).toBe('1.5');
  });

  it('leaves expressions untouched', () => {
    expect(withUnit('calc(100% - 2rem)', 'px', 'width')).toBe('calc(100% - 2rem)');
  });
});

describe('scrubSensitivity', () => {
  it('demands more travel the coarser the step', () => {
    expect(scrubSensitivity('font-weight')).toBeGreaterThan(scrubSensitivity('width'));
    expect(scrubSensitivity('width')).toBeGreaterThan(scrubSensitivity('opacity'));
  });
});
