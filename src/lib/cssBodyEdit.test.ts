/**
 * Property writes against a parsed rule body.
 *
 * Focus: the order guarantees. Editing must not reshuffle a hand-authored body,
 * must target the LAST occurrence of a repeated property (the one that wins),
 * and must leave `!important` and nested rules alone.
 */

import { describe, it, expect } from 'vitest';
import { parseRuleBody, serializeRuleBody, declarations } from './cssBody';
import { bodyProperty, setBodyProperty, setBodyProperties } from './cssBodyEdit';

const body = (src: string) => parseRuleBody(src);

describe('bodyProperty', () => {
  it('reads a value', () => {
    expect(bodyProperty(body('color: red; margin: 0;'), 'color')).toBe('red');
  });

  it('reads the last of a repeated property', () => {
    expect(bodyProperty(body('color: red; color: blue;'), 'color')).toBe('blue');
  });

  it('returns empty for an unset property', () => {
    expect(bodyProperty(body('color: red;'), 'padding')).toBe('');
  });
});

describe('setBodyProperty', () => {
  it('replaces in place, keeping source order', () => {
    const next = setBodyProperty(body('color: red; margin: 0;'), 'color', 'blue');
    const decls = declarations(next);
    expect(decls.map((d) => d.prop)).toEqual(['color', 'margin']);
    expect(decls[0].value).toBe('blue');
  });

  it('appends a new property', () => {
    const next = setBodyProperty(body('color: red;'), 'padding', '8px');
    expect(declarations(next).map((d) => d.prop)).toEqual(['color', 'padding']);
  });

  it('removes on a null value', () => {
    const next = setBodyProperty(body('color: red; margin: 0;'), 'color', null);
    expect(declarations(next).map((d) => d.prop)).toEqual(['margin']);
  });

  it('treats an empty string as removal', () => {
    const next = setBodyProperty(body('color: red;'), 'color', '   ');
    expect(declarations(next)).toHaveLength(0);
  });

  it('keeps !important on the declaration it replaces', () => {
    const next = setBodyProperty(body('color: red !important;'), 'color', 'blue');
    expect(declarations(next)[0].important).toBe(true);
  });

  it('edits the last occurrence, which is the one that wins', () => {
    const next = setBodyProperty(body('color: red; color: blue;'), 'color', 'green');
    const values = declarations(next).map((d) => d.value);
    expect(values).toEqual(['red', 'green']);
  });

  it('leaves nested rules untouched', () => {
    const next = setBodyProperty(body('color: red; &:hover { color: blue; }'), 'color', 'green');
    expect(serializeRuleBody(next)).toContain('&:hover');
  });

  it('is a no-op when removing something that was never set', () => {
    const src = body('color: red;');
    expect(setBodyProperty(src, 'padding', null)).toBe(src);
  });
});

describe('setBodyProperties', () => {
  it('applies changes in order', () => {
    const next = setBodyProperties(body('padding: 10px;'), [
      { property: 'padding', value: null },
      { property: 'padding-top', value: '4px' },
      { property: 'padding-right', value: '10px' },
    ]);
    const decls = declarations(next);
    expect(decls.map((d) => d.prop)).toEqual(['padding-top', 'padding-right']);
    expect(decls[0].value).toBe('4px');
  });
});
