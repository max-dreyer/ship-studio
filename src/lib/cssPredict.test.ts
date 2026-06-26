import { describe, expect, it } from 'vitest';
import { predictNextDeclaration } from './cssPredict';

const d = (prop: string, value: string) => ({ prop, value });

describe('predictNextDeclaration', () => {
  it('returns null for an empty rule', () => {
    expect(predictNextDeclaration([])).toBeNull();
  });

  it('suggests flex companions in order, skipping ones already present', () => {
    expect(predictNextDeclaration([d('display', 'flex')])).toMatchObject({ prop: 'align-items' });
    expect(predictNextDeclaration([d('display', 'flex'), d('align-items', 'start')])).toMatchObject(
      { prop: 'justify-content' }
    );
    expect(
      predictNextDeclaration([
        d('display', 'flex'),
        d('align-items', 'start'),
        d('justify-content', 'start'),
      ])
    ).toMatchObject({ prop: 'gap' });
  });

  it('also fires for grid', () => {
    expect(predictNextDeclaration([d('display', 'grid')])).toMatchObject({ prop: 'align-items' });
  });

  it('does not suggest flex companions without a flex/grid display', () => {
    expect(predictNextDeclaration([d('display', 'block')])).toBeNull();
  });

  it('suggests an inset for positioned elements, not for static', () => {
    expect(predictNextDeclaration([d('position', 'absolute')])).toMatchObject({ prop: 'inset' });
    expect(predictNextDeclaration([d('position', 'relative')])).toBeNull();
    // Already has an offset → nothing.
    expect(predictNextDeclaration([d('position', 'fixed'), d('top', '0')])).toBeNull();
  });

  it('respects the exclude set (just-dismissed props)', () => {
    expect(predictNextDeclaration([d('display', 'flex')], new Set(['align-items']))).toMatchObject({
      prop: 'justify-content',
    });
  });
});
