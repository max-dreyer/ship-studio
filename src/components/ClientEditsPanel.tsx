/**
 * Client Edits panel — "Edits" workspace tab content.
 * Shows pending/all edits with approve/reject/view actions.
 */

import { useState } from 'react';
import { EditCard } from './EditCard';
import { EditDetailModal } from './EditDetailModal';
import { AuthGate } from './AuthGate';
import type { InlineEdit, EditStatus } from '@shipstudio/shared';

interface ClientEditsPanelProps {
  edits: InlineEdit[];
  pendingCount: number;
  loading: boolean;
  filter: EditStatus | 'all';
  setFilter: (filter: EditStatus | 'all') => void;
  isAuthenticated: boolean;
  onLogin: () => void;
  onApprove: (editId: string) => Promise<void>;
  onReject: (editId: string, note?: string) => Promise<void>;
  onApplyWithClaude: (prompt: string) => void;
  onRefresh: () => void;
}

export function ClientEditsPanel({
  edits,
  pendingCount,
  loading,
  filter,
  setFilter,
  isAuthenticated,
  onLogin,
  onApprove,
  onReject,
  onApplyWithClaude,
  onRefresh,
}: ClientEditsPanelProps) {
  const [selectedEdit, setSelectedEdit] = useState<InlineEdit | null>(null);

  return (
    <AuthGate
      isAuthenticated={isAuthenticated}
      onLogin={onLogin}
      message="Sign in to view client edits"
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          minWidth: 0,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
              Client Edits
            </span>
            {pendingCount > 0 && (
              <span
                style={{
                  background: 'var(--action)',
                  color: 'var(--action-text)',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 10,
                }}
              >
                {pendingCount}
              </span>
            )}
          </div>
          <button
            className="btn-secondary"
            onClick={onRefresh}
            style={{ padding: '3px 10px', fontSize: 11 }}
          >
            Refresh
          </button>
        </div>

        {/* Filter bar */}
        <div
          style={{
            padding: '8px 16px',
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--border)',
            flexShrink: 0,
          }}
        >
          {(['all', 'pending', 'approved', 'rejected', 'applied'] as const).map((f) => (
            <button
              key={f}
              className={filter === f ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setFilter(f)}
              style={{ padding: '3px 10px', fontSize: 11, textTransform: 'capitalize' }}
            >
              {f}
            </button>
          ))}
        </div>

        {/* Edit list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: 16,
          }}
        >
          {loading && (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
                padding: 32,
              }}
            >
              Loading edits…
            </div>
          )}

          {!loading && edits.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-muted)',
                fontSize: 13,
                padding: 32,
              }}
            >
              {filter === 'all'
                ? 'No edits yet. Edits from clients will appear here in real-time.'
                : `No ${filter} edits.`}
            </div>
          )}

          {edits.map((edit) => (
            <EditCard
              key={edit.id}
              edit={edit}
              onApprove={(id) => void onApprove(id)}
              onReject={(id) => void onReject(id)}
              onView={setSelectedEdit}
            />
          ))}
        </div>

        {/* Detail modal */}
        {selectedEdit && (
          <EditDetailModal
            edit={selectedEdit}
            onClose={() => setSelectedEdit(null)}
            onApplyWithClaude={onApplyWithClaude}
            onApprove={(id) => {
              void onApprove(id);
              setSelectedEdit(null);
            }}
            onReject={(id) => {
              void onReject(id);
              setSelectedEdit(null);
            }}
          />
        )}
      </div>
    </AuthGate>
  );
}
