/**
 * API calls for fetching and managing inline edits — list, approve, reject,
 * and construct Claude prompts for applying edits.
 */

import { getSupabase } from './supabase';
import type { InlineEdit, EditStatus } from '@shipstudio/shared';

/** Fetch edits for a project */
export async function fetchEdits(projectId: string, status?: EditStatus): Promise<InlineEdit[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('inline_edits')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as InlineEdit[];
}

/** Count pending edits for a project */
export async function countPendingEdits(projectId: string): Promise<number> {
  const supabase = getSupabase();
  const { count, error } = await supabase
    .from('inline_edits')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'pending');

  if (error) throw error;
  return count || 0;
}

/** Approve an edit */
export async function approveEdit(editId: string, reviewedBy: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('inline_edits')
    .update({
      status: 'approved',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', editId);

  if (error) throw error;
}

/** Reject an edit */
export async function rejectEdit(
  editId: string,
  reviewedBy: string,
  reviewNote?: string
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('inline_edits')
    .update({
      status: 'rejected',
      reviewed_by: reviewedBy,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote || null,
    })
    .eq('id', editId);

  if (error) throw error;
}

/** Construct a Claude prompt for applying an edit */
export function buildApplyPrompt(edit: InlineEdit): string {
  const parts: string[] = [];

  parts.push(`The client requested the following change on page "${edit.page_url}":\n`);

  parts.push(
    `Element: ${edit.element_tag_name} at ${edit.element_css_selector || edit.element_fingerprint.cssSelector}`
  );
  if (edit.element_fingerprint.parentText) {
    parts.push(`Context: ${edit.element_fingerprint.parentText}`);
  }
  parts.push('');

  parts.push(`Change type: ${edit.edit_type}`);

  if (
    edit.edit_type === 'text_change' ||
    edit.edit_type === 'text_delete' ||
    edit.edit_type === 'text_add'
  ) {
    if (edit.original_text) parts.push(`Original: "${edit.original_text}"`);
    if (edit.new_text) parts.push(`New: "${edit.new_text}"`);
  }

  if (edit.edit_type === 'image_change' && edit.image_changes) {
    parts.push(`Original src: ${edit.image_changes.originalSrc}`);
    parts.push(`New src: ${edit.image_changes.newSrc}`);
    if (edit.image_changes.originalAlt !== edit.image_changes.newAlt) {
      parts.push(`Original alt: "${edit.image_changes.originalAlt}"`);
      parts.push(`New alt: "${edit.image_changes.newAlt}"`);
    }
  }

  if (edit.edit_type === 'style_change' && edit.style_changes) {
    parts.push('Style changes:');
    for (const change of edit.style_changes) {
      parts.push(`  ${change.property}: "${change.originalValue}" → "${change.newValue}"`);
    }
  }

  if (edit.edit_type === 'meta_change' && edit.meta_changes) {
    parts.push(`Meta field: ${edit.meta_changes.field}`);
    parts.push(`Original: "${edit.meta_changes.originalValue}"`);
    parts.push(`New: "${edit.meta_changes.newValue}"`);
  }

  parts.push('\nElement fingerprint:');
  const fp = edit.element_fingerprint;
  if (fp.nearestIdAncestor) parts.push(`- Nearest ID ancestor: #${fp.nearestIdAncestor}`);
  if (fp.classList.length > 0) parts.push(`- Classes: ${fp.classList.join(', ')}`);
  if (fp.previousSiblingText || fp.nextSiblingText) {
    parts.push(
      `- Siblings: ${fp.previousSiblingText || '(none)'} | [ELEMENT] | ${fp.nextSiblingText || '(none)'}`
    );
  }

  parts.push('\nPlease find this element in the codebase and make the requested change.');

  return parts.join('\n');
}
