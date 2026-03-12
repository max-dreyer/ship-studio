/**
 * Invite client modal — email input to send an invitation.
 */

import { useState, useCallback } from 'react';
import '../styles/notifications.css';

const API_BASE = import.meta.env.VITE_SHIPSTUDIO_API_URL as string;

interface InviteClientModalProps {
  projectId: string;
  accessToken: string;
  onClose: () => void;
  onInvited: () => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}

export function InviteClientModal({
  projectId,
  accessToken,
  onClose,
  onInvited,
  onToast,
}: InviteClientModalProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInvite = useCallback(async () => {
    if (!email.trim()) return;

    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/api/v1/clients/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ project_id: projectId, email: email.trim() }),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(err);
      }

      onToast(`Invitation sent to ${email}`, 'success');
      onInvited();
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to send invite', 'error');
    } finally {
      setLoading(false);
    }
  }, [email, projectId, accessToken, onInvited, onToast]);

  return (
    <div className="notification-settings-modal" onClick={onClose}>
      <div className="notification-settings-content" onClick={(e) => e.stopPropagation()}>
        <div className="notification-settings-header">
          <h2>Invite Client</h2>
          <p>Send an invitation to a client so they can edit your site.</p>
        </div>
        <div className="notification-settings-body">
          <div className="notification-setting-section">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="client@example.com"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && email.trim()) void handleInvite();
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                They&apos;ll receive an email with a link to set up their password and start
                editing.
              </span>
            </div>
          </div>
        </div>
        <div className="notification-settings-footer">
          <button className="notification-settings-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="notification-settings-save"
            onClick={() => void handleInvite()}
            disabled={!email.trim() || loading}
          >
            {loading ? 'Sending…' : 'Send Invite'}
          </button>
        </div>
      </div>
    </div>
  );
}
