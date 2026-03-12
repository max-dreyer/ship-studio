/**
 * Expanded edit view with full context and "Apply with Claude" button.
 */

import type { InlineEdit } from '@shipstudio/shared';
import { buildApplyPrompt } from '../lib/inline-edits';
import '../styles/notifications.css';

interface EditDetailModalProps {
  edit: InlineEdit;
  onClose: () => void;
  onApplyWithClaude: (prompt: string) => void;
  onApprove: (editId: string) => void;
  onReject: (editId: string) => void;
}

export function EditDetailModal({
  edit,
  onClose,
  onApplyWithClaude,
  onApprove,
  onReject,
}: EditDetailModalProps) {
  const prompt = buildApplyPrompt(edit);

  return (
    <div className="notification-settings-modal" onClick={onClose}>
      <div
        className="notification-settings-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 560, maxHeight: '80vh', overflow: 'auto' }}
      >
        <div className="notification-settings-header">
          <h2>Edit Detail</h2>
          <p>
            {edit.edit_type.replace('_', ' ')} on {edit.page_url}
          </p>
        </div>

        <div
          className="notification-settings-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {/* Change content */}
          {edit.original_text && (
            <Section label="Original Text">
              <Pre>{edit.original_text}</Pre>
            </Section>
          )}
          {edit.new_text && (
            <Section label="New Text">
              <Pre style={{ color: '#6ee7b7' }}>{edit.new_text}</Pre>
            </Section>
          )}

          {edit.style_changes && (
            <Section label="Style Changes">
              {edit.style_changes.map((c, i) => (
                <div
                  key={i}
                  style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}
                >
                  <code style={{ color: 'var(--text-primary)' }}>{c.property}</code>:{' '}
                  <span style={{ color: '#ef4444' }}>{c.originalValue}</span> →{' '}
                  <span style={{ color: '#6ee7b7' }}>{c.newValue}</span>
                </div>
              ))}
            </Section>
          )}

          {edit.image_changes && (
            <Section label="Image Change">
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                <div>Original: {edit.image_changes.originalSrc}</div>
                <div>New: {edit.image_changes.newSrc}</div>
                {edit.image_changes.originalAlt !== edit.image_changes.newAlt && (
                  <div>
                    Alt: &quot;{edit.image_changes.originalAlt}&quot; → &quot;
                    {edit.image_changes.newAlt}&quot;
                  </div>
                )}
              </div>
            </Section>
          )}

          {edit.meta_changes && (
            <Section label="Meta Change">
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {edit.meta_changes.field}: &quot;{edit.meta_changes.originalValue}&quot; → &quot;
                {edit.meta_changes.newValue}&quot;
              </div>
            </Section>
          )}

          {/* Element fingerprint */}
          <Section label="Element Fingerprint">
            <Pre style={{ fontSize: 11 }}>{JSON.stringify(edit.element_fingerprint, null, 2)}</Pre>
          </Section>

          {/* Claude prompt */}
          <Section label="Claude Prompt">
            <Pre style={{ fontSize: 11, maxHeight: 200, overflow: 'auto' }}>{prompt}</Pre>
          </Section>
        </div>

        <div className="notification-settings-footer" style={{ gap: 6 }}>
          {edit.status === 'pending' && (
            <>
              <button className="notification-settings-cancel" onClick={() => onReject(edit.id)}>
                Reject
              </button>
              <button className="notification-settings-save" onClick={() => onApprove(edit.id)}>
                Approve
              </button>
            </>
          )}
          <button
            className="btn-primary"
            onClick={() => {
              onApplyWithClaude(prompt);
              onClose();
            }}
            style={{ padding: '6px 16px' }}
          >
            Apply with Claude
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'block' }}
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Pre({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <pre
      style={{
        background: 'var(--bg-primary)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: 8,
        fontSize: 12,
        fontFamily: 'var(--font-mono, monospace)',
        color: 'var(--text-secondary)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        margin: 0,
        ...style,
      }}
    >
      {children}
    </pre>
  );
}
