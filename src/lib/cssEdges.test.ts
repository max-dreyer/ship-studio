/**
 * Per-edge border and per-corner radius resolution.
 *
 * Focus: the two ways this differs from the spacing box and would otherwise be
 * wrong by analogy — longhand naming (`border-top-width`, not
 * `border-width-top`) and the radius shorthand's corner order, whose 2-value
 * form pairs opposite corners rather than opposite sides.
 */

import { describe, it, expect } from 'vitest';
import {
  longhandFor,
  expandEdgeShorthand,
  readEdges,
  setEdge,
  isUniform,
  partsOf,
} from './cssEdges';
import type { CssDeclaration } from './edit-css';

const decl = (property: string, value: string): CssDeclaration => ({
  property,
  value,
  important: false,
});

describe('longhandFor', () => {
  it('puts the side in the middle for borders', () => {
    expect(longhandFor('border-width', 'top')).toBe('border-top-width');
    expect(longhandFor('border-style', 'left')).toBe('border-left-style');
    expect(longhandFor('border-color', 'right')).toBe('border-right-color');
  });

  it('names a corner for radii', () => {
    expect(longhandFor('border-radius', 'top-left')).toBe('border-top-left-radius');
    expect(longhandFor('border-radius', 'bottom-right')).toBe('border-bottom-right-radius');
  });
});

describe('partsOf', () => {
  it('uses corners for radius and sides for borders', () => {
    expect(partsOf('border-radius')).toEqual([
      'top-left',
      'top-right',
      'bottom-right',
      'bottom-left',
    ]);
    expect(partsOf('border-width')).toEqual(['top', 'right', 'bottom', 'left']);
  });
});

describe('expandEdgeShorthand', () => {
  it('pairs opposite sides for borders', () => {
    expect(expandEdgeShorthand('border-width', '1px 2px')).toEqual({
      top: '1px',
      right: '2px',
      bottom: '1px',
      left: '2px',
    });
  });

  it('pairs opposite corners for radii', () => {
    // 2-value radius is TL+BR, then TR+BL — not top/bottom like spacing.
    expect(expandEdgeShorthand('border-radius', '10px 0')).toEqual({
      'top-left': '10px',
      'top-right': '0',
      'bottom-right': '10px',
      'bottom-left': '0',
    });
  });

  it('refuses an elliptical radius', () => {
    expect(expandEdgeShorthand('border-radius', '10px / 20px')).toBeNull();
  });

  it('refuses more parts than CSS allows', () => {
    expect(expandEdgeShorthand('border-width', '1px 2px 3px 4px 5px')).toBeNull();
  });
});

describe('readEdges', () => {
  it('fills parts from the shorthand', () => {
    expect(readEdges([decl('border-width', '2px')], 'border-width').left).toBe('2px');
  });

  it('lets a longhand win', () => {
    const decls = [decl('border-radius', '4px'), decl('border-top-left-radius', '12px')];
    const edges = readEdges(decls, 'border-radius');
    expect(edges['top-left']).toBe('12px');
    expect(edges['bottom-right']).toBe('4px');
  });

  it('reports empty parts when nothing is set', () => {
    expect(readEdges([], 'border-width').top).toBe('');
  });
});

describe('isUniform', () => {
  it('is true for a single shorthand value', () => {
    expect(isUniform([decl('border-width', '1px')], 'border-width')).toBe(true);
  });

  it('is false once one side differs', () => {
    expect(
      isUniform([decl('border-width', '1px'), decl('border-top-width', '4px')], 'border-width')
    ).toBe(false);
  });
});

describe('setEdge', () => {
  it('writes the shorthand and clears longhands when setting all', () => {
    const changes = setEdge([decl('border-top-width', '4px')], 'border-width', null, '2px');
    expect(changes[0]).toEqual({ property: 'border-width', value: '2px' });
    expect(changes).toContainEqual({ property: 'border-top-width', value: null });
    expect(changes).toContainEqual({ property: 'border-left-width', value: null });
  });

  it('writes a single longhand when no shorthand is present', () => {
    expect(setEdge([], 'border-width', 'top', '3px')).toEqual([
      { property: 'border-top-width', value: '3px' },
    ]);
  });

  it('expands the shorthand before writing one part', () => {
    const changes = setEdge([decl('border-radius', '8px')], 'border-radius', 'top-left', '0');
    expect(changes[0]).toEqual({ property: 'border-radius', value: null });
    expect(changes).toContainEqual({ property: 'border-top-left-radius', value: '0' });
    expect(changes).toContainEqual({ property: 'border-bottom-right-radius', value: '8px' });
  });

  it('clears with null', () => {
    expect(setEdge([], 'border-width', 'top', null)).toEqual([
      { property: 'border-top-width', value: null },
    ]);
  });
});
