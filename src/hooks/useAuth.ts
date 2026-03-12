/**
 * Auth state hook — manages Supabase authentication for the desktop app.
 *
 * Listens for the `oauth-callback` Tauri event emitted by the Rust-side
 * localhost HTTP server after OAuth completes, then exchanges the PKCE
 * auth code for a session.
 */

import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  getAuthSession,
  signInWithGitHub,
  exchangeCodeForSession,
  signOut,
  type AuthState,
} from '../lib/auth';
import { isSupabaseConfigured } from '../lib/supabase';
import { logger } from '../lib/logger';

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    isAuthenticated: false,
    user: null,
    session: null,
    loading: true,
  });

  // Check existing session on mount
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setAuthState((prev) => ({ ...prev, loading: false })); // eslint-disable-line react-hooks/set-state-in-effect -- intentional: early return for unconfigured state
      return;
    }

    void getAuthSession()
      .then((session) => {
        setAuthState({
          isAuthenticated: !!session,
          user: session?.user ?? null,
          session,
          loading: false,
        });
      })
      .catch((err) => {
        logger.error('Failed to get auth session', { error: err });
        setAuthState((prev) => ({ ...prev, loading: false }));
      });
  }, []);

  // Listen for OAuth callback from the localhost server (PKCE code)
  useEffect(() => {
    const unlisten = listen<string>('oauth-callback', (event) => {
      const code = event.payload;
      logger.info('Received OAuth callback code, exchanging for session');

      exchangeCodeForSession(code)
        .then((session) => {
          if (session) {
            setAuthState({
              isAuthenticated: true,
              user: session.user,
              session,
              loading: false,
            });
            logger.info('OAuth session established');
          }
        })
        .catch((err) => {
          logger.error('Failed to exchange OAuth code for session', { error: err });
        });
    });

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  const login = useCallback(async () => {
    try {
      await signInWithGitHub();
    } catch (err) {
      logger.error('Login failed', { error: err });
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await signOut();
      setAuthState({
        isAuthenticated: false,
        user: null,
        session: null,
        loading: false,
      });
    } catch (err) {
      logger.error('Logout failed', { error: err });
      throw err;
    }
  }, []);

  return {
    ...authState,
    login,
    logout,
  };
}
