/**
 * Individual edit card — displays a single client edit with
 * approve/reject/view actions.
 */

import type { InlineEdit } from '@shipstudio/shared';

interface EditCardProps {
  edit: InlineEdit;
  onApprove: (editId: string) => void;
  onReject: (editId: string) => void;
  onView: (edit: InlineEdit) => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

function editTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    text_change: 'Text Change',
    text_delete: 'Text Delete',
    text_add: 'Text Add',
    style_change: 'Style Change',
    combined_change: 'Combined Change',
    image_change: 'Image Change',
    meta_change: 'Meta Change',
  };
  return labels[type] || type;
}

function statusBadge(status: string) {
  const styles: Record<string, { bg: string; color: string }> = {
    pending: { bg: '#854d0e', color: '#fde047' },
    approved: { bg: '#065f46', color: '#6ee7b7' },
    rejected: { bg: '#7f1d1d', color: '#fca5a5' },
    applied: { bg: '#1e3a5f', color: '#93c5fd' },
    applying: { bg: '#4a1d96', color: '#c4b5fd' },
    failed: { bg: '#7f1d1d', color: '#fca5a5' },
  };

  const style = styles[status] || styles.pending;

  return (
    <span
      style={{
        background: style.bg,
        color: style.color,
        fontSize: 10,
        fontWeight: 600,
        padding: '2px 6px',
        borderRadius: 4,
        textTransform: 'uppercase' as const,
      }}
    >
      {status}
    </span>
  );
}

export function EditCard({ edit, onApprove, onReject, onView }: EditCardProps) {
  return (
    <div
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        marginBottom: 8,
      }}
    >
      {/* Header: type + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          {editTypeLabel(edit.edit_type)}
        </span>
        {statusBadge(edit.status)}
      </div>

      {/* Content preview */}
      {(edit.edit_type === 'text_change' ||
        edit.edit_type === 'text_delete' ||
        edit.edit_type === 'text_add') && (
        <div style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text-secondary)' }}>
          {edit.original_text && (
            <span style={{ color: '#ef4444', textDecoration: 'line-through' }}>
              &quot;{truncate(edit.original_text, 60)}&quot;
            </span>
          )}
          {edit.original_text && edit.new_text && <span> → </span>}
          {edit.new_text && (
            <span style={{ color: '#6ee7b7' }}>&quot;{truncate(edit.new_text, 60)}&quot;</span>
          )}
        </div>
      )}

      {edit.edit_type === 'image_change' && edit.image_changes && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          Image replacement
          {edit.image_changes.originalAlt !== edit.image_changes.newAlt && (
            <span>
              {' '}
              · alt: &quot;{truncate(edit.image_changes.originalAlt, 20)}&quot; → &quot;
              {truncate(edit.image_changes.newAlt, 20)}&quot;
            </span>
          )}
        </div>
      )}

      {edit.edit_type === 'style_change' && edit.style_changes && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {edit.style_changes.length} property change
          {edit.style_changes.length > 1 ? 's' : ''}
        </div>
      )}

      {edit.edit_type === 'meta_change' && edit.meta_changes && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {edit.meta_changes.field}: &quot;{truncate(edit.meta_changes.originalValue, 30)}&quot; →
          &quot;{truncate(edit.meta_changes.newValue, 30)}&quot;
        </div>
      )}

      {/* Meta: page, time */}
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {edit.page_url} · {formatTime(edit.created_at)}
      </div>

      {/* Actions */}
      {edit.status === 'pending' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button
            className="btn-primary"
            onClick={() => onApprove(edit.id)}
            style={{ padding: '4px 12px', fontSize: 11 }}
          >
            Approve
          </button>
          <button
            className="btn-secondary"
            onClick={() => onReject(edit.id)}
            style={{ padding: '4px 12px', fontSize: 11 }}
          >
            Reject
          </button>
          <button
            className="btn-secondary"
            onClick={() => onView(edit)}
            style={{ padding: '4px 12px', fontSize: 11, marginLeft: 'auto' }}
          >
            View
          </button>
        </div>
      )}

      {edit.status !== 'pending' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
          <button
            className="btn-secondary"
            onClick={() => onView(edit)}
            style={{ padding: '4px 12px', fontSize: 11 }}
          >
            View Details
          </button>
          {edit.pr_url && (
            <a
              href={edit.pr_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 11,
                color: 'var(--accent)',
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                marginLeft: 'auto',
              }}
            >
              View PR →
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}
