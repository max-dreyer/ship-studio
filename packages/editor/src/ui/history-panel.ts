/**
 * Client's past edits history panel with status indicators.
 */

import { getSupabase } from '../api/supabase';
import { EditorState } from '../core/state';
import type { InlineEdit, EditStatus } from '@shipstudio/shared';
import { h } from '../utils/dom';
import { injectStyles } from './styles';

let currentPanel: HTMLElement | null = null;
let currentBackdrop: HTMLElement | null = null;

function statusLabel(status: EditStatus): string {
  const map: Record<EditStatus, string> = {
    pending: 'Pending',
    approved: 'Approved',
    applying: 'Applying',
    applied: 'Applied',
    rejected: 'Rejected',
    failed: 'Failed',
  };
  return map[status] || status;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export async function showHistoryPanel(shadow: ShadowRoot) {
  closeHistoryPanel();
  injectStyles(shadow);

  // Backdrop
  const backdrop = h('div', { className: 'ss-modal-backdrop' });
  backdrop.setAttribute('data-ss-editor', 'true');
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeHistoryPanel();
  });

  const panel = h('div', { className: 'ss-meta-panel' });
  panel.setAttribute('data-ss-editor', 'true');
  panel.addEventListener('click', (e) => e.stopPropagation());

  const titleEl = h('h3', {}, 'Edit History');
  const closeBtn = h('button', { className: 'ss-panel-close' }, '×');
  closeBtn.addEventListener('click', closeHistoryPanel);

  panel.append(titleEl, closeBtn);

  // Fetch edit history
  const supabase = getSupabase();
  const user = EditorState.getUser();

  if (!user) {
    const msg = h('p', {}, 'Not logged in');
    msg.style.cssText = 'color: #666; font-size: 13px; text-align: center; padding: 24px 0;';
    panel.appendChild(msg);
    backdrop.appendChild(panel);
    shadow.appendChild(backdrop);
    currentPanel = panel;
    currentBackdrop = backdrop;
    return;
  }

  const { data: edits, error } = await supabase
    .from('inline_edits')
    .select('*')
    .eq('submitted_by', user.id)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !edits || edits.length === 0) {
    const emptyMsg = h('p', {}, 'No edits yet');
    emptyMsg.style.cssText = 'color: #666; font-size: 13px; text-align: center; padding: 24px 0;';
    panel.appendChild(emptyMsg);
    backdrop.appendChild(panel);
    shadow.appendChild(backdrop);
    currentPanel = panel;
    currentBackdrop = backdrop;
    return;
  }

  for (const edit of edits as InlineEdit[]) {
    const item = h('div', { className: 'ss-history-item' });

    const statusBadge = h('span', {
      className: `ss-status ss-status-${edit.status}`,
    }, statusLabel(edit.status));

    const typeLabel = h('span', {}, ` ${edit.edit_type.replace('_', ' ')}`);
    typeLabel.style.color = '#999';

    const header = h('div', {}, statusBadge, typeLabel);
    header.style.marginBottom = '4px';

    item.appendChild(header);

    if (edit.original_text && edit.new_text) {
      const diff = h('div', {});
      diff.style.cssText = 'font-size: 11px; color: #999; line-height: 1.4;';
      diff.innerHTML = `<span style="color:#ef4444;text-decoration:line-through">${escapeHtml(truncate(edit.original_text, 80))}</span> → <span style="color:#6ee7b7">${escapeHtml(truncate(edit.new_text, 80))}</span>`;
      item.appendChild(diff);
    }

    const meta = h('div', {}, `${edit.page_url} · ${formatTime(edit.created_at)}`);
    meta.style.cssText = 'font-size: 10px; color: #666; margin-top: 4px;';
    item.appendChild(meta);

    if (edit.review_note) {
      const note = h('div', {}, `Note: ${edit.review_note}`);
      note.style.cssText = 'font-size: 10px; color: #fca5a5; margin-top: 4px;';
      item.appendChild(note);
    }

    panel.appendChild(item);
  }

  backdrop.appendChild(panel);
  shadow.appendChild(backdrop);
  currentPanel = panel;
  currentBackdrop = backdrop;
}

export function closeHistoryPanel() {
  currentBackdrop?.remove();
  currentBackdrop = null;
  currentPanel = null;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}
