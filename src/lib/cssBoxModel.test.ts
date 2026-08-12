/**
 * Box-model resolution for the spacing box.
 *
 * Focus: the shorthand cases that silently show wrong numbers if mishandled
 * (`padding: 10px 20px` fills four sides, not two), and the write path that
 * must not leave a rule where the shorthand and a longhand disagree.
 */

import { describe, it, expect } from 'vitest';
import {
  splitTopLevel,
  expandBoxShorthand,
  readBoxSides,
  setBoxSide,
  hasShorthand,
} from './cssBoxModel';
import type { CssDeclaration } from './edit-css';

const decl = (property: string, value: string): CssDeclaration => ({
  property,
  value,
  important: false,
});

describe('splitTopLevel', () => {
  it('splits on whitespace', () => {
    expect(splitTopLevel('10px 20px')).toEqual(['10px', '20px']);
    expect(splitTopLevel('  1px   2px  ')).toEqual(['1px', '2px']);
  });

  it('keeps function arguments together', () => {
    expect(splitTopLevel('calc(1px + 2px) 3px')).toEqual(['calc(1px + 2px)', '3px']);
    expect(splitTopLevel('var(--a) var(--b)')).toEqual(['var(--a)', 'var(--b)']);
    expect(splitTopLevel('clamp(1rem, 2vw, 3rem)')).toEqual(['clamp(1rem, 2vw, 3rem)']);
  });
});

describe('expandBoxShorthand', () => {
  it('follows the CSS 1-to-4 value rules', () => {
    expect(expandBoxShorthand('10px')).toEqual({
      top: '10px',
      right: '10px',
      bottom: '10px',
      left: '10px',
    });
    expect(expandBoxShorthand('10px 20px')).toEqual({
      top: '10px',
      right: '20px',
      bottom: '10px',
      left: '20px',
    });
    expect(expandBoxShorthand('1px 2px 3px')).toEqual({
      top: '1px',
      right: '2px',
      bottom: '3px',
      left: '2px',
    });
    expect(expandBoxShorthand('1px 2px 3px 4px')).toEqual({
      top: '1px',
      right: '2px',
      bottom: '3px',
      left: '4px',
    });
  });

  it('rejects an empty or over-long value', () => {
    expect(expandBoxShorthand('')).toBeNull();
    expect(expandBoxShorthand('1px 2px 3px 4px 5px')).toBeNull();
  });
});

describe('readBoxSides', () => {
  it('fills all four sides from a shorthand', () => {
    const sides = readBoxSides([decl('padding', '10px 20px')], 'padding');
    expect(sides).toEqual({ top: '10px', right: '20px', bottom: '10px', left: '20px' });
  });

  it('lets a longhand win over the shorthand', () => {
    const sides = readBoxSides([decl('padding', '10px'), decl('padding-top', '4px')], 'padding');
    expect(sides.top).toBe('4px');
    expect(sides.bottom).toBe('10px');
  });

  it('takes the last declaration when a property repeats', () => {
    const sides = readBoxSides([decl('margin-top', '1px'), decl('margin-top', '9px')], 'margin');
    expect(sides.top).toBe('9px');
  });

  it('reads margin and padding independently', () => {
    const decls = [decl('padding', '10px'), decl('margin', '2rem')];
    expect(readBoxSides(decls, 'padding').top).toBe('10px');
    expect(readBoxSides(decls, 'margin').top).toBe('2rem');
  });

  it('reports empty sides when nothing is set', () => {
    expect(readBoxSides([], 'padding')).toEqual({ top: '', right: '', bottom: '', left: '' });
  });
});

describe('setBoxSide', () => {
  it('writes a single longhand when there is no shorthand', () => {
    expect(setBoxSide([], 'padding', 'top', '8px')).toEqual([
      { property: 'padding-top', value: '8px' },
    ]);
  });

  it('expands the shorthand so the rule cannot contradict itself', () => {
    const changes = setBoxSide([decl('padding', '10px 20px')], 'padding', 'top', '4px');
    expect(changes).toEqual([
      { property: 'padding', value: null },
      { property: 'padding-top', value: '4px' },
      { property: 'padding-right', value: '20px' },
      { property: 'padding-bottom', value: '10px' },
      { property: 'padding-left', value: '20px' },
    ]);
  });

  it('clears a side with null', () => {
    expect(setBoxSide([decl('margin-top', '4px')], 'margin', 'top', null)).toEqual([
      { property: 'margin-top', value: null },
    ]);
  });

  it('treats whitespace as clearing', () => {
    expect(setBoxSide([], 'padding', 'left', '   ')).toEqual([
      { property: 'padding-left', value: null },
    ]);
  });

  it('preserves expressions from the shorthand it expands', () => {
    const changes = setBoxSide([decl('padding', 'calc(1rem + 2px) 8px')], 'padding', 'bottom', '0');
    expect(changes).toContainEqual({ property: 'padding-top', value: 'calc(1rem + 2px)' });
    expect(changes).toContainEqual({ property: 'padding-bottom', value: '0' });
  });
});

describe('hasShorthand', () => {
  it('detects the shorthand only for its own base', () => {
    const decls = [decl('padding', '10px')];
    expect(hasShorthand(decls, 'padding')).toBe(true);
    expect(hasShorthand(decls, 'margin')).toBe(false);
  });
});
