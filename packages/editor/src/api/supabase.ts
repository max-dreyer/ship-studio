/**
 * Supabase client initialization for the inline editor script.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let supabase: SupabaseClient | null = null;

// @ts-expect-error — replaced at build time via Vite define
const SUPABASE_URL: string = __SHIPSTUDIO_SUPABASE_URL__;
// @ts-expect-error — replaced at build time via Vite define
const SUPABASE_ANON_KEY: string = __SHIPSTUDIO_SUPABASE_ANON_KEY__;

export function initSupabase() {
  if (supabase) return;

  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      storageKey: 'ss-editor-auth',
    },
  });
}

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('[ShipStudio] Supabase not initialized');
  }
  return supabase;
}
