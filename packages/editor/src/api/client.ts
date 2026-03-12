/**
 * API client for Ship Studio API and direct Supabase operations.
 */

import type { ValidateOriginResponse, EditSubmission, InlineEdit } from '@shipstudio/shared';
import { getSupabase } from './supabase';
import { EditorState } from '../core/state';

// @ts-expect-error — replaced at build time via Vite define
const API_BASE: string = __SHIPSTUDIO_API_BASE_URL__;

/** Validate that the current origin is allowed for this studio ID */
export async function validateOrigin(
  studioId: string,
  origin: string
): Promise<ValidateOriginResponse> {
  const resp = await fetch(`${API_BASE}/api/v1/edits/validate-origin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ studio_id: studioId, origin }),
  });

  if (!resp.ok) {
    throw new Error(`Origin validation failed: ${resp.status}`);
  }

  return resp.json();
}

export interface SubmitResult {
  edit_ids: string[];
  batch_id: string;
}

/** Submit a batch of edits via the Ship Studio API */
export async function submitEdits(edits: EditSubmission[]): Promise<SubmitResult> {
  const user = EditorState.getUser();
  const studioId = EditorState.getStudioId();

  if (!studioId) {
    throw new Error('No studio ID');
  }

  const resp = await fetch(`${API_BASE}/api/v1/edits/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studio_id: studioId,
      user_id: user?.id || null,
      edits,
    }),
  });

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || `Edit submission failed: ${resp.status}`);
  }

  const data = await resp.json();
  return { edit_ids: data.edit_ids ?? [], batch_id: data.batch_id ?? '' };
}

/** Upload an image to Supabase Storage */
export async function uploadImage(file: File): Promise<string> {
  const supabase = getSupabase();
  const projectId = EditorState.getProjectId();
  const batchId = crypto.randomUUID();

  const path = `${projectId}/${batchId}/${file.name}`;
  const { error } = await supabase.storage
    .from('edit-images')
    .upload(path, file);

  if (error) throw error;

  const { data } = supabase.storage.from('edit-images').getPublicUrl(path);
  return data.publicUrl;
}

/** Fetch the current user's pending/approved edits for a specific page */
export async function fetchMyEdits(
  projectId: string,
  pageUrl: string,
  userId: string | null
): Promise<InlineEdit[]> {
  const supabase = getSupabase();

  let query = supabase
    .from('inline_edits')
    .select('*')
    .eq('project_id', projectId)
    .eq('page_url', pageUrl)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  if (userId) {
    query = query.eq('submitted_by', userId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to fetch edits: ${error.message}`);
  }

  return (data ?? []) as InlineEdit[];
}
