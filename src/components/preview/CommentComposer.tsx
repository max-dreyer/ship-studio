/**
 * The little box that opens where you clicked, to write a note.
 *
 * Draggable, because it opens next to the element you picked and would
 * otherwise cover the very thing you're describing. It stays inside the
 * preview: a composer dragged half off-screen can't be finished or dismissed.
 *
 * Enter inserts a newline. Sending is Cmd-Enter, because notes are prose and
 * the far more common mistake is losing a half-written sentence to a stray
 * Return than having to reach for a modifier.
 *
 * @module components/preview/CommentComposer
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PendingNote } from '../../hooks/usePreviewComments';

interface Props {
  pending: PendingNote;
  /** Size of the area the composer must stay inside. */
  bounds: { width: number; height: number };
  /** Scale-to-fit factor of the canvas — the click arrives in the iframe's
   *  own pixels, so the box needs the same factor to open at the element. */
  scale?: number;
  onCommit: (text: string) => void;
  onCancel: () => void;
}

const WIDTH = 260;
/** Enough for the textarea plus its footer; used to keep the box in view. */
const HEIGHT = 132;
const MARGIN = 8;

function clamp(value: number, max: number): number {
  return Math.max(MARGIN, Math.min(value, Math.max(MARGIN, max)));
}

export function CommentComposer({ pending, bounds, scale = 1, onCommit, onCancel }: Props) {
  const [text, setText] = useState('');
  const [pos, setPos] = useState(() => {
    const factor = scale > 0 ? scale : 1;
    return {
      left: clamp(pending.x * factor + 12, bounds.width - WIDTH - MARGIN),
      top: clamp(pending.y * factor + 12, bounds.height - HEIGHT - MARGIN),
    };
  });
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    areaRef.current?.focus();
  }, []);

  const onHeaderDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // Let the close button keep its click.
      if ((e.target as HTMLElement).closest('button')) return;
      dragRef.current = { dx: e.clientX - pos.left, dy: e.clientY - pos.top };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pos.left, pos.top]
  );

  const onHeaderMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      setPos({
        left: clamp(e.clientX - d.dx, bounds.width - WIDTH - MARGIN),
        top: clamp(e.clientY - d.dy, bounds.height - HEIGHT - MARGIN),
      });
    },
    [bounds.height, bounds.width]
  );

  const onHeaderUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  }, []);

  return (
    <div className="ss-composer" style={{ left: pos.left, top: pos.top, width: WIDTH }}>
      <div
        className="ss-composer__head"
        onPointerDown={onHeaderDown}
        onPointerMove={onHeaderMove}
        onPointerUp={onHeaderUp}
        onPointerCancel={onHeaderUp}
      >
        <span className="ss-composer__target" title={pending.domPath}>
          {pending.movingId ? 'Move to ' : ''}
          {pending.label}
        </span>
        <button type="button" className="ss-composer__close" onClick={onCancel} aria-label="Cancel">
          ×
        </button>
      </div>

      {pending.ambiguous && (
        // Honest rather than reassuring: several elements match this path, so
        // the pin may land on a sibling after the page changes.
        <p className="ss-composer__warn">
          This element looks like its siblings, so the note may drift if the page changes.
        </p>
      )}

      <textarea
        ref={areaRef}
        className="ss-composer__text"
        value={text}
        placeholder="What should change here?"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
            return;
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onCommit(text);
          }
        }}
      />

      <div className="ss-composer__foot">
        <span className="ss-composer__hint">⌘↵ to save</span>
        <button
          type="button"
          className="ss-composer__save"
          onClick={() => onCommit(text)}
          disabled={text.trim() === ''}
        >
          Save
        </button>
      </div>
    </div>
  );
}
