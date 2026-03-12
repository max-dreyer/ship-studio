/**
 * Editor toolbar — shows pending edit count and submit button.
 */

import { EditorState } from '../core/state';
import { submitEdits } from '../api/client';
import { showToast } from './toast';
import { showMetaPanel } from './meta-panel';
import { showHistoryPanel } from './history-panel';
import { showApplyProgress, setEditIds, hideApplyProgress } from './apply-progress';
import { h } from '../utils/dom';
import { injectStyles } from './styles';

let toolbarEl: HTMLElement | null = null;
let countEl: HTMLElement | null = null;

export function createToolbar(shadow: ShadowRoot) {
  injectStyles(shadow);

  const toolbar = h('div', { className: 'ss-toolbar' });

  // Pending count label
  const count = h('span', { className: 'ss-toolbar-count' }, '0 edits');

  // Meta edit button
  const metaBtn = h('button', { className: 'ss-btn ss-btn-ghost' }, 'SEO');
  metaBtn.title = 'Edit page metadata';
  metaBtn.addEventListener('click', () => showMetaPanel(shadow));

  // History button
  const historyBtn = h('button', { className: 'ss-btn ss-btn-ghost' }, 'History');
  historyBtn.addEventListener('click', () => showHistoryPanel(shadow));

  // Submit button
  const submitBtn = h('button', { className: 'ss-btn ss-btn-primary' }, 'Submit');
  (submitBtn as HTMLButtonElement).disabled = true;

  submitBtn.addEventListener('click', async () => {
    const edits = EditorState.getPendingEdits();
    if (edits.length === 0) return;

    EditorState.transition('submitting');
    submitBtn.textContent = 'Submitting…';
    (submitBtn as HTMLButtonElement).disabled = true;

    const config = EditorState.getConfig();
    const isAutoApply = !!config?.auto_apply;

    // Show progress overlay immediately for auto-apply (don't wait for API)
    if (isAutoApply) {
      showApplyProgress(shadow);
    }

    try {
      const result = await submitEdits(edits);
      EditorState.clearEdits();
      updateToolbar(shadow);

      if (isAutoApply && result.edit_ids.length > 0) {
        // Narrow tracking to the returned edit IDs
        setEditIds(result.edit_ids);
      } else if (!isAutoApply) {
        showToast(shadow, `${edits.length} edit${edits.length > 1 ? 's' : ''} submitted!`, 'success');
      }
    } catch (err) {
      hideApplyProgress();
      showToast(shadow, 'Failed to submit edits. Please try again.', 'error');
    } finally {
      EditorState.transition('active');
      submitBtn.textContent = 'Submit';
    }
  });

  toolbar.append(count, metaBtn, historyBtn, submitBtn);
  shadow.appendChild(toolbar);

  toolbarEl = toolbar;
  countEl = count;
}

export function destroyToolbar() {
  if (toolbarEl) {
    toolbarEl.remove();
    toolbarEl = null;
    countEl = null;
  }
}

export function updateToolbar(shadow: ShadowRoot) {
  const edits = EditorState.getPendingEdits();
  if (countEl) {
    countEl.textContent = `${edits.length} edit${edits.length !== 1 ? 's' : ''}`;
  }
  // Enable/disable submit button
  const submitBtn = toolbarEl?.querySelector('.ss-btn-primary') as HTMLButtonElement | null;
  if (submitBtn) {
    submitBtn.disabled = edits.length === 0;
  }
}
