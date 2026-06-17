import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClassBar } from './ClassBar';
import type { CustomClass } from '../../lib/customClasses';
import type { EditTarget } from '../../hooks/useVisualEditor';

const CLASSES: CustomClass[] = [
  { name: 'btn', tokens: ['px-4', 'py-2'], editable: true },
  { name: 'card', tokens: ['rounded'], editable: true },
];

function renderBar(over: Partial<Parameters<typeof ClassBar>[0]> = {}) {
  const props = {
    customClasses: CLASSES,
    // `btn` is applied to the element; `card` is available; `p-3` is a utility.
    elementClass: 'btn p-3',
    editTarget: { kind: 'element' } as EditTarget,
    onEditElement: vi.fn(),
    onEditClass: vi.fn(),
    onApplyExisting: vi.fn(),
    onUnapply: vi.fn(),
    onCreate: vi.fn(),
    ...over,
  };
  render(<ClassBar {...props} />);
  return props;
}

describe('ClassBar', () => {
  it('labels the trigger with the active target', () => {
    renderBar();
    expect(screen.getByRole('button', { name: /this element/i })).toBeInTheDocument();
  });

  it('shows the class name in the trigger while editing a class', () => {
    renderBar({ editTarget: { kind: 'class', name: 'btn', baseline: 'px-4 py-2' } });
    expect(screen.getByRole('button', { name: '.btn' })).toBeInTheDocument();
  });

  it('menu lists the element, applied classes, available classes, and create', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: 'This element' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '.btn' })).toBeInTheDocument(); // applied
    expect(screen.getByRole('menuitem', { name: 'Apply .card' })).toBeInTheDocument(); // available
    expect(screen.getByRole('menuitem', { name: /new class from styles/i })).toBeInTheDocument();
  });

  it('edits an applied class and applies an available one', () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: '.btn' }));
    expect(props.onEditClass).toHaveBeenCalledWith('btn', ['px-4', 'py-2']);

    fireEvent.click(screen.getByRole('button')); // reopen
    fireEvent.click(screen.getByRole('menuitem', { name: 'Apply .card' }));
    expect(props.onApplyExisting).toHaveBeenCalledWith('card');
  });

  it('disables "create from styles" when the element has no utilities to extract', () => {
    renderBar({ elementClass: 'btn card' }); // only custom classes
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: /new class from styles/i })).toBeDisabled();
  });
});
