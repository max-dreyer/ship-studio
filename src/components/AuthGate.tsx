/**
 * Wraps features that require Supabase authentication.
 * Shows a sign-in prompt when the user is not authenticated.
 */

import type { ReactNode } from 'react';

interface AuthGateProps {
  isAuthenticated: boolean;
  onLogin: () => void;
  children: ReactNode;
  message?: string;
}

export function AuthGate({
  isAuthenticated,
  onLogin,
  children,
  message = 'Sign in to access this feature',
}: AuthGateProps) {
  if (isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 16,
        padding: 32,
        color: 'var(--text-secondary)',
      }}
    >
      <p style={{ fontSize: 14, textAlign: 'center' }}>{message}</p>
      <button className="btn-primary" onClick={onLogin} style={{ padding: '8px 20px' }}>
        Sign In
      </button>
    </div>
  );
}
