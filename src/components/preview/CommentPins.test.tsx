/**
 * Pins are only drawn where the iframe actually found the element.
 *
 * The iframe reports `{x: 0, y: 0, found: false}` for a note it can't place.
 * Painting that verbatim put a pin in the top-left corner of the canvas, where
 * it sat over whatever happened to be there and stayed put while the page
 * scrolled — indistinguishable from a correctly placed pin on the wrong
 * element. Drawing nothing is the honest answer; the notes list carries the
 * explanation.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentPins } from './CommentPins';
import type { PreviewComment } from '../../lib/comments';

function note(id: string, overrides: Partial<PreviewComment> = {}): PreviewComment {
  return {
    id,
    dom_path: `body > div:nth-of-type(${id})`,
    url: '/',
    label: `div.card-${id}`,
    text: `Notiz ${id}`,
    added_at: 1,
    sent: false,
    ...overrides,
  };
}

describe('CommentPins', () => {
  it('draws a pin where the element was found', () => {
    render(
      <CommentPins
        comments={[note('1')]}
        positions={[{ id: '1', x: 120, y: 40, found: true }]}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    const pin = screen.getByRole('button', { name: '1' });
    expect(pin).toHaveStyle({ left: '120px', top: '40px' });
  });

  it('draws nothing for a note the page has no element for', () => {
    render(
      <CommentPins
        comments={[note('1')]}
        // What the iframe sends when querySelector comes up empty.
        positions={[{ id: '1', x: 0, y: 40, found: false }]}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws nothing while the element is hidden behind other content', () => {
    // The sticky-footer case: found, but covered, so its pin would sit in
    // blank space and stay there while the page scrolls past.
    render(
      <CommentPins
        comments={[note('1')]}
        positions={[{ id: '1', x: 200, y: 400, found: true, visible: false }]}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('draws a pin when the iframe says nothing about visibility', () => {
    // Absent means visible — an older script build must not blank every pin.
    render(
      <CommentPins
        comments={[note('1')]}
        positions={[{ id: '1', x: 200, y: 400, found: true }]}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '1' })).toBeTruthy();
  });

  it('keeps the numbering aligned with the notes list', () => {
    // Note 2 can't be placed. The others keep their own numbers, so a pin and
    // its row in the list still agree.
    render(
      <CommentPins
        comments={[note('1'), note('2'), note('3')]}
        positions={[
          { id: '1', x: 10, y: 10, found: true },
          { id: '2', x: 0, y: 0, found: false },
          { id: '3', x: 30, y: 30, found: true },
        ]}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual(['1', '3']);
  });

  it('scales positions onto a shrunk canvas', () => {
    render(
      <CommentPins
        comments={[note('1')]}
        positions={[{ id: '1', x: 200, y: 100, found: true }]}
        scale={0.5}
        selectedId={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: '1' })).toHaveStyle({
      left: '100px',
      top: '50px',
    });
  });
});
