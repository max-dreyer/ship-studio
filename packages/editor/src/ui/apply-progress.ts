/**
 * Auto-apply progress overlay — shows real-time pipeline status to clients.
 *
 * Instead of its own Supabase subscription, this module exposes an
 * `onEditUpdate()` function that the existing realtime channel in boot.ts
 * calls whenever an edit update arrives. This avoids duplicate subscriptions
 * and ensures we get the same payload the rest of the editor sees.
 */

import { h } from '../utils/dom';

interface ApplyStep {
  key: string;
  message: string;
  status: 'running' | 'done' | 'error';
  detail?: string;
}

let overlayEl: HTMLElement | null = null;
let trackedEditIds: string[] = [];
/** When true, accept ALL edit updates (before we know the specific IDs) */
let acceptAll = false;

/** Simplified step labels for the client-facing UI */
const CLIENT_STEP_MAP: Record<string, string> = {
  start: 'Processing your edit',
  project: 'Loading project',
  github: 'Connecting to repository',
  files: 'Finding the right file',
  ai: 'Applying your change',
  branch: 'Preparing update',
  commit: 'Saving changes',
  pr: 'Creating review',
  merge: 'Publishing changes',
};

/** Steps we skip showing to clients (too technical) */
const HIDDEN_STEPS = new Set(['project', 'github']);

/**
 * Show the progress overlay immediately.
 * Call with no editIds initially (accepts all updates from this user),
 * then call setEditIds() once the submit response arrives.
 */
export function showApplyProgress(root: ShadowRoot, editIds?: string[]) {
  if (editIds && editIds.length > 0) {
    trackedEditIds = editIds;
    acceptAll = false;
  } else {
    trackedEditIds = [];
    acceptAll = true;
  }

  // Create the overlay container
  overlayEl = h('div', { className: 'ss-apply-progress' });

  overlayEl.innerHTML = `
    <div class="ss-apply-header">
      <span class="ss-apply-spinner"></span>
      <span class="ss-apply-title">Applying your changes...</span>
    </div>
    <div class="ss-apply-steps"></div>
  `;

  root.appendChild(overlayEl);
}

/** Narrow down which edit IDs to track (called when submit returns) */
export function setEditIds(editIds: string[]) {
  trackedEditIds = editIds;
  acceptAll = false;
}

/**
 * Called from the existing realtime subscription in boot.ts
 * whenever an inline_edits row is updated.
 */
export function onEditUpdate(edit: {
  id: string;
  status: string;
  apply_steps?: ApplyStep[];
}) {
  if (!overlayEl) return;
  if (!acceptAll && !trackedEditIds.includes(edit.id)) return;

  // If accepting all, remember this edit ID for future filtering
  if (acceptAll && !trackedEditIds.includes(edit.id)) {
    trackedEditIds.push(edit.id);
  }

  if (edit.apply_steps && edit.apply_steps.length > 0) {
    renderSteps(edit.apply_steps);
  }

  // Terminal states
  if (edit.status === 'applied') {
    finishProgress('Your changes are live!', 'success');
  } else if (edit.status === 'rejected' || edit.status === 'failed') {
    finishProgress('Could not apply changes. Your developer will review them.', 'info');
  }
}

function renderSteps(steps: ApplyStep[]) {
  if (!overlayEl) return;

  const stepsContainer = overlayEl.querySelector('.ss-apply-steps');
  if (!stepsContainer) return;

  const visibleSteps = steps.filter((s) => !HIDDEN_STEPS.has(s.key));

  stepsContainer.innerHTML = visibleSteps
    .map((step) => {
      const label = CLIENT_STEP_MAP[step.key] || step.message;
      const icon =
        step.status === 'done'
          ? '<span class="ss-step-icon ss-step-done">✓</span>'
          : step.status === 'error'
          ? '<span class="ss-step-icon ss-step-error">✕</span>'
          : '<span class="ss-step-icon ss-step-running"><span class="ss-apply-dot"></span></span>';

      return `<div class="ss-apply-step">${icon}<span class="ss-step-label">${label}</span></div>`;
    })
    .join('');

  const latestRunning = visibleSteps.filter((s) => s.status === 'running').pop();
  const title = overlayEl.querySelector('.ss-apply-title');
  if (title && latestRunning) {
    title.textContent = CLIENT_STEP_MAP[latestRunning.key] || latestRunning.message;
  }
}

function finishProgress(message: string, type: 'success' | 'info') {
  if (!overlayEl) return;

  const icon = type === 'success' ? '✓' : 'ℹ';
  const iconClass = type === 'success' ? 'ss-step-done' : 'ss-step-info';

  overlayEl.innerHTML = `
    <div class="ss-apply-header">
      <span class="ss-step-icon ${iconClass}">${icon}</span>
      <span class="ss-apply-title">${message}</span>
    </div>
  `;

  // Auto-dismiss after 8 seconds so the client can see the result
  setTimeout(() => {
    if (overlayEl) {
      overlayEl.style.opacity = '0';
      overlayEl.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        overlayEl?.remove();
        overlayEl = null;
        trackedEditIds = [];
      }, 300);
    }
  }, 8000);
}

export function hideApplyProgress() {
  if (overlayEl) {
    overlayEl.remove();
    overlayEl = null;
    trackedEditIds = [];
  }
}
