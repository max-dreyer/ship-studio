/**
 * Developer login modal — GitHub OAuth via Supabase.
 */

import { useState, useCallback } from 'react';
import '../styles/notifications.css';

interface LoginModalProps {
  onLogin: () => Promise<void>;
  onClose: () => void;
}

export function LoginModal({ onLogin, onClose }: LoginModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }, [onLogin]);

  return (
    <div className="notification-settings-modal" onClick={onClose}>
      <div className="notification-settings-content" onClick={(e) => e.stopPropagation()}>
        <div className="notification-settings-header">
          <h2>Sign in to Ship Studio</h2>
          <p>Connect your account to enable inline editing features.</p>
        </div>
        <div className="notification-settings-body">
          {error && (
            <div style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}
          <button
            className="btn-primary"
            onClick={() => void handleLogin()}
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {loading ? 'Opening browser…' : 'Sign in with GitHub'}
          </button>
        </div>
        <div className="notification-settings-footer">
          <button className="notification-settings-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
