/**
 * The numbered pins drawn over the preview.
 *
 * Positions come from the iframe (only it can resolve a `dom_path`), so this
 * component just paints. A pin whose element the page no longer has is drawn
 * detached rather than hidden: the note still exists, and silently dropping
 * its marker would leave the user wondering where it went.
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
        if (!at) return null;
        return (
          <button
            key={comment.id}
            type="button"
            className={`ss-pin${comment.sent ? ' is-sent' : ''}${
              at.found ? '' : ' is-detached'
            }${selectedId === comment.id ? ' is-selected' : ''}`}
            style={{ left: at.x * factor, top: at.y * factor }}
            onClick={() => onSelect(comment.id)}
            title={
              at.found
                ? `${comment.label}: ${comment.text}`
                : `${comment.label} is no longer on the page — ${comment.text}`
            }
          >
            {index + 1}
          </button>
        );
      })}
    </div>
  );
}
