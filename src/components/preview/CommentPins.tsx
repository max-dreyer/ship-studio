/**
 * The numbered pins drawn over the preview.
 *
 * Positions come from the iframe (only it can resolve a `dom_path`), so this
 * component just paints.
 *
 * Two cases get no pin at all.
 *
 * A note whose element the page no longer has: it used to get one at (0, 0) —
 * the iframe's placeholder for "not found" — which put a pin in the corner
 * that stayed there while the page scrolled, looking like a real marker on the
 * wrong element. An invented position is worse than no position.
 *
 * And an element that exists but is covered by something else. A sticky footer
 * revealed from behind the page content is the case that surfaced this: it
 * holds one spot the whole time, hidden under the content, so its pin floated
 * in the middle of blank space and never moved. The pin comes back when you
 * scroll far enough for the element to actually be there.
 *
 * The notes list is where a note nobody can point at stays visible.
 *
 * @module components/preview/CommentPins
 */

import type { PinPosition } from '../../hooks/usePreviewComments';
import type { PreviewComment } from '../../lib/comments';

interface Props {
  comments: PreviewComment[];
  positions: PinPosition[];
  /** Scale-to-fit factor of the canvas. Positions arrive in the iframe's own
   *  pixels, so they need the same factor to land on the shrunk rendering. */
  scale?: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function CommentPins({ comments, positions, scale = 1, selectedId, onSelect }: Props) {
  const byId = new Map(positions.map((p) => [p.id, p]));
  // Guard against a zero or missing factor putting every pin in the corner.
  const factor = scale > 0 ? scale : 1;

  return (
    <div className="ss-pins" aria-hidden={comments.length === 0}>
      {comments.map((comment, index) => {
        const at = byId.get(comment.id);
        // No position yet, no element, or the element is behind something.
        if (!at || !at.found || at.visible === false) return null;
        return (
          <button
            key={comment.id}
            type="button"
            className={`ss-pin${comment.sent ? ' is-sent' : ''}${
              selectedId === comment.id ? ' is-selected' : ''
            }`}
            style={{ left: at.x * factor, top: at.y * factor }}
            onClick={() => onSelect(comment.id)}
            title={`${comment.label}: ${comment.text}`}
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
}
