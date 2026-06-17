import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
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

  it('menu lists the element, applied classes, and available classes', () => {
    renderBar();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: 'This element' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '.btn' })).toBeInTheDocument(); // applied
    expect(screen.getByRole('menuitem', { name: '.card' })).toBeInTheDocument(); // available (add)
  });

  it('edits an applied class and applies an available one (apply keeps the menu open)', () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: '.btn' }));
    expect(props.onEditClass).toHaveBeenCalledWith('btn', ['px-4', 'py-2']);

    fireEvent.click(screen.getByRole('button')); // reopen (editing a target closes the menu)
    // Apply runs through an async serializer (busy state), so flush under act.
    act(() => {
      fireEvent.click(screen.getByRole('menuitem', { name: '.card' }));
    });
    expect(props.onApplyExisting).toHaveBeenCalledWith('card');
    // Applying keeps the menu open — the search field is still there.
    expect(screen.getByPlaceholderText(/search or name a new class/i)).toBeInTheDocument();
  });

  it('filters the list by the search query', () => {
    renderBar({
      customClasses: [
        { name: 'btn-primary', tokens: ['px-4'], editable: true },
        { name: 'hero-heading', tokens: ['text-5xl'], editable: true },
      ],
      elementClass: 'p-3', // nothing applied → both available
    });
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText(/search or name a new class/i), {
      target: { value: 'hero' },
    });
    expect(screen.getByRole('menuitem', { name: '.hero-heading' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '.btn-primary' })).not.toBeInTheDocument();
  });

  it('offers "create from styles" when the query is a new class name and there are utilities', () => {
    renderBar({ elementClass: 'p-3 flex' });
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText(/search or name a new class/i), {
      target: { value: 'fresh-name' },
    });
    expect(
      screen.getByRole('menuitem', { name: /create .*fresh-name.* from styles/i })
    ).toBeEnabled();
  });

  it('disables create when the project has no writable Tailwind stylesheet', () => {
    renderBar({ elementClass: 'p-3 flex', canCreate: false });
    fireEvent.click(screen.getByRole('button'));
    fireEvent.change(screen.getByPlaceholderText(/search or name a new class/i), {
      target: { value: 'fresh-name' },
    });
    expect(
      screen.getByRole('menuitem', { name: /create .*fresh-name.* from styles/i })
    ).toBeDisabled();
  });
});
