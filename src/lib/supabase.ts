/**
 * Supabase client initialization for the Ship Studio desktop app.
 *
 * Uses Supabase Auth for developer authentication (GitHub OAuth via Supabase)
 * and Realtime for live edit notifications.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// These should be set via environment variables at build time
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables');
    }

    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        storageKey: 'shipstudio-auth',
        flowType: 'pkce',
      },
    });
  }

  return supabase;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
