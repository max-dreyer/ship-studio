/**
 * Interaction behavior of the CSS numeric field.
 *
 * Focus: the two things a scrub gets wrong if unwatched. A drag must produce
 * ONE source write at the end (not one per pointer move), and a value the
 * stepper doesn't understand — calc(), var(), a keyword — must survive every
 * gesture untouched. The arithmetic itself is covered in lib/cssLength.test.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CssLengthField } from './CssLengthField';

/** jsdom has no PointerEvent; a MouseEvent carries the same clientX. */
function pointer(type: string, x: number): PointerEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: 0 });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e as unknown as PointerEvent;
}

function setup(value: string, prop = 'width') {
  const onPreview = vi.fn();
  const onSave = vi.fn();
  const utils = render(
    <CssLengthField
      prop={prop}
      value={value}
      onPreview={onPreview}
      onSave={onSave}
      isValid={() => true}
    />
  );
  const input = screen.getByRole<HTMLInputElement>('textbox');
  const scrub = utils.container.querySelector('.ss-cc-scrub') as HTMLElement;
  return { onPreview, onSave, input, scrub };
}

beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CssLengthField scrubbing', () => {
  it('previews continuously but saves once, at the end of the drag', () => {
    const { onPreview, onSave, input, scrub } = setup('16px');

    fireEvent(scrub, pointer('pointerdown', 100));
    fireEvent(scrub, pointer('pointermove', 112));
    fireEvent(scrub, pointer('pointermove', 130));

    expect(onPreview).toHaveBeenCalled();
    // Still nothing written to source mid-drag.
    expect(onSave).not.toHaveBeenCalled();
    expect(input.value).toBe('26px');

    fireEvent(scrub, pointer('pointerup', 130));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('width', '26px');
  });

  it('scrubs left to decrease', () => {
    const { onSave, scrub } = setup('16px');
    fireEvent(scrub, pointer('pointerdown', 100));
    fireEvent(scrub, pointer('pointermove', 82));
    fireEvent(scrub, pointer('pointerup', 82));
    expect(onSave).toHaveBeenCalledWith('width', '10px');
  });

  it('returns to the original value when the drag comes back to its origin', () => {
    const { onSave, input, scrub } = setup('16px');
    fireEvent(scrub, pointer('pointerdown', 100));
    fireEvent(scrub, pointer('pointermove', 130));
    fireEvent(scrub, pointer('pointermove', 100));
    expect(input.value).toBe('16px');
    fireEvent(scrub, pointer('pointerup', 100));
    // Nothing actually changed, so nothing is written.
    expect(onSave).not.toHaveBeenCalled();
  });

  it('leaves an expression alone and offers no grip for it', () => {
    const { onSave, input, scrub } = setup('calc(100% - 2rem)');
    fireEvent(scrub, pointer('pointerdown', 100));
    fireEvent(scrub, pointer('pointermove', 160));
    fireEvent(scrub, pointer('pointerup', 160));
    expect(input.value).toBe('calc(100% - 2rem)');
    expect(onSave).not.toHaveBeenCalled();
    expect(scrub.className).toContain('is-disabled');
  });
});

describe('CssLengthField keyboard', () => {
  it('nudges with arrow keys and saves on key-up', () => {
    const { onSave, input } = setup('16px');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('17px');
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.keyUp(input, { key: 'ArrowUp' });
    expect(onSave).toHaveBeenCalledWith('width', '17px');
  });

  it('takes a bigger step with shift', () => {
    const { input } = setup('16px');
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(input.value).toBe('6px');
  });

  it('ignores arrow keys on an expression', () => {
    const { input } = setup('var(--gap)', 'gap');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('var(--gap)');
  });

  it('reverts on Escape', () => {
    const { input } = setup('16px');
    fireEvent.change(input, { target: { value: '99px' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('16px');
  });
});

describe('CssLengthField unit menu', () => {
  it('swaps the unit and keeps the number', () => {
    const { onSave } = setup('16px');
    fireEvent.click(screen.getByRole('button', { name: /unit for width/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: '%' }));
    expect(onSave).toHaveBeenCalledWith('width', '16%');
  });

  it('offers no unit button for a value that has no number', () => {
    setup('auto');
    expect(screen.queryByRole('button', { name: /unit for/i })).toBeNull();
  });
});
