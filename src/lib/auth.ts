/**
 * Auth helpers for developer authentication via Supabase OAuth.
 *
 * Uses PKCE flow with a localhost HTTP callback server. The Rust backend starts
 * a one-shot server, the browser redirects there after OAuth, and the server
 * emits the auth code back to the frontend via a Tauri event.
 */

import { invoke } from '@tauri-apps/api/core';
import { getSupabase, isSupabaseConfigured } from './supabase';
import type { Session, User } from '@supabase/supabase-js';

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  session: Session | null;
  loading: boolean;
}

/** Get the current auth session */
export async function getAuthSession(): Promise<Session | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session;
}

/**
 * Start GitHub OAuth via Supabase PKCE flow.
 *
 * 1. Starts a one-shot HTTP server on localhost (Rust backend)
 * 2. Opens the OAuth URL in the system browser
 * 3. After auth, the browser redirects to localhost with ?code=...
 * 4. The Rust server emits an `oauth-callback` event with the code
 * 5. The useAuth hook exchanges the code for a session
 */
export async function signInWithGitHub(): Promise<void> {
  // Start the localhost callback server
  const port = await invoke<number>('start_oauth_server');
  const redirectTo = `http://127.0.0.1:${String(port)}/callback`;

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;

  if (data.url) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(data.url);
  }
}

/** Exchange a PKCE auth code for a session */
export async function exchangeCodeForSession(code: string): Promise<Session | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) throw error;
  return data.session;
}

/** Sign out */
export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/** Get the current authenticated user */
export async function getCurrentUser(): Promise<User | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
