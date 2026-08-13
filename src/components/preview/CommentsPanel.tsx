/**
 * The list of notes beside the preview, and the one button that hands them to
 * the agent.
 *
 * Notes are grouped by page, because a review session wanders across a site
 * and "which page was that on" is the first thing you ask when reading them
 * back. Sent notes stay visible but muted until cleared: they're the record of
 * what the agent was already told.
 *
 * @module components/preview/CommentsPanel
 */

import { useState } from 'react';
import { groupByPage, type PreviewComment } from '../../lib/comments';

interface Props {
  comments: PreviewComment[];
  /** Notes whose element the current page doesn't have. They get no pin on the
   *  canvas, so the list is the only place their state can be seen. */
  unplaceableIds?: ReadonlySet<string>;
  /** The page the preview is showing, so its group can say so. */
  currentUrl?: string;
  /** Jump the preview to another page. Without it, notes left elsewhere are
   *  readable but not reachable. */
  onNavigate?: (url: string) => void;
  unsentCount: number;
  sending: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string) => void;
  onSend: () => void;
  onClearSent: () => void;
  onClose: () => void;
}

export function CommentsPanel({
  comments,
  unplaceableIds,
  currentUrl,
  onNavigate,
  unsentCount,
  sending,
  selectedId,
  onSelect,
  onEdit,
  onRemove,
  onMove,
  onSend,
  onClearSent,
  onClose,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const hasSent = comments.some((c) => c.sent);

  const beginEdit = (comment: PreviewComment) => {
    setEditingId(comment.id);
    setDraft(comment.text);
  };

  const commitEdit = () => {
    if (editingId && draft.trim()) onEdit(editingId, draft);
    setEditingId(null);
  };

  return (
    <aside className="ss-notes">
      <header className="ss-notes__head">
        <span className="ss-notes__title">Notes</span>
        {comments.length > 0 && <span className="ss-notes__count">{comments.length}</span>}
        <button
          type="button"
          className="ss-notes__close"
          onClick={onClose}
          aria-label="Exit comment mode"
        >
          ×
        </button>
      </header>

      {comments.length === 0 ? (
        <div className="ss-notes__empty">
          <p className="ss-notes__empty-lead">No notes yet.</p>
          <p className="ss-notes__empty-hint">
            Click anything in the preview to leave one, then send them all to the agent at once.
          </p>
        </div>
      ) : (
        <div className="ss-notes__list">
          {groupByPage(comments).map((group) => {
            const isCurrent = (group.url || '/') === (currentUrl || '/');
            return (
              <section className="ss-notes__group" key={group.url}>
                {/* Notes on another page have no pin here, and without a way to
                  get there they quietly rot. The heading is the way there. */}
                <h3 className={`ss-notes__page${isCurrent ? ' is-current' : ''}`}>
                  {isCurrent || !onNavigate ? (
                    <span>{group.url}</span>
                  ) : (
                    <button
                      type="button"
                      className="ss-notes__page-link"
                      onClick={() => onNavigate(group.url)}
                      title={`Show ${group.url} in the preview`}
                    >
                      {group.url}
                      <span className="ss-notes__page-count">{group.comments.length}</span>
                    </button>
                  )}
                </h3>
                {group.comments.map((comment) => (
                  <article
                    key={comment.id}
                    className={`ss-note${comment.sent ? ' is-sent' : ''}${
                      selectedId === comment.id ? ' is-selected' : ''
                    }`}
                    onClick={() => onSelect(comment.id)}
                  >
                    <div className="ss-note__head">
                      <code className="ss-note__label">{comment.label}</code>
                      {comment.sent && <span className="ss-note__badge">sent</span>}
                      {unplaceableIds?.has(comment.id) && (
                        <span
                          className="ss-note__badge ss-note__badge--orphan"
                          title="This element isn't on the page right now, so the note has no pin. It may be on another page, or it may have changed."
                        >
                          no pin
                        </span>
                      )}
                    </div>

                    {editingId === comment.id ? (
                      <textarea
                        className="ss-note__edit"
                        value={draft}
                        autoFocus
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingId(null);
                          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit();
                        }}
                      />
                    ) : (
                      <p className="ss-note__text">{comment.text}</p>
                    )}

                    <div className="ss-note__actions">
                      {!comment.sent && (
                        <>
                          <button type="button" onClick={() => beginEdit(comment)}>
                            Edit
                          </button>
                          <button type="button" onClick={() => onMove(comment.id)}>
                            Move
                          </button>
                        </>
                      )}
                      <button type="button" onClick={() => onRemove(comment.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}

      <footer className="ss-notes__foot">
        <button
          type="button"
          className="ss-notes__send"
          onClick={onSend}
          disabled={unsentCount === 0 || sending}
        >
          {sending
            ? 'Sending…'
            : unsentCount === 0
              ? 'Nothing to send'
              : `Send ${unsentCount} to agent`}
        </button>
        {hasSent && (
          <button type="button" className="ss-notes__clear" onClick={onClearSent}>
            Clear sent
          </button>
        )}
      </footer>
    </aside>
  );
}
