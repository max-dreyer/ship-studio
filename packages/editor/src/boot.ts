/**
 * Full editor bootstrap — only loaded when ?editor=true is present.
 */

import { initSupabase, getSupabase } from './api/supabase';
import { validateOrigin } from './api/client';
import { EditorState } from './core/state';
import { createShadowContainer } from './utils/shadow';
import { showAuthModal } from './ui/auth-modal';
import { createToolbar, destroyToolbar } from './ui/toolbar';
import { initHighlighter, destroyHighlighter } from './core/highlighter';
import { initEditor, destroyEditor } from './core/editor';
import { showToast } from './ui/toast';
import { closeImagePanel } from './ui/image-panel';
import { closeMetaPanel } from './ui/meta-panel';
import { closeHistoryPanel } from './ui/history-panel';
import { injectStyles } from './ui/styles';
import { h } from './utils/dom';
import { applyPendingEdits, updateEditStatus, clearAllPatches } from './core/applicator';
import { onEditUpdate } from './ui/apply-progress';

export async function boot() {
  // 1. Read studio ID from script tag
  const scriptEl = document.querySelector(
    'script[data-studio-id]'
  ) as HTMLScriptElement | null;
  if (!scriptEl) {
    console.error('[ShipStudio] Missing data-studio-id on script tag');
    return;
  }
  const studioId = scriptEl.getAttribute('data-studio-id')!;

  // 2. Create Shadow DOM container for editor UI
  const shadow = createShadowContainer();

  // 3. Initialize Supabase
  initSupabase();
  const supabase = getSupabase();

  // 4. Validate origin
  try {
    const validation = await validateOrigin(studioId, window.location.origin);
    if (!validation.valid) {
      console.error('[ShipStudio] Origin not allowed');
      return;
    }
    EditorState.setConfig(validation.config);
    EditorState.setProjectId(validation.project_id);
    EditorState.setStudioId(studioId);
  } catch (err) {
    console.error('[ShipStudio] Origin validation failed:', err);
    return;
  }

  // 5. Check for auth tokens in URL hash (from invite callback redirect)
  let session = null;
  const hash = window.location.hash.substring(1);
  if (hash) {
    const hashParams = new URLSearchParams(hash);
    const accessToken = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (accessToken && refreshToken) {
      const { data, error: sessionErr } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (!sessionErr && data.session) {
        session = data.session;
        // Clean up the hash from URL
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    }
  }

  // 6. Check existing session if no hash tokens
  if (!session) {
    const { data } = await supabase.auth.getSession();
    session = data.session;
  }

  // TODO: Remove this bypass — for dev/testing only
  if (!session) {
    console.warn('[ShipStudio] No auth session — activating editor in anonymous mode (dev only)');
    showEditToggle(shadow, studioId);
    return;
  }

  EditorState.setUser(session.user);

  // Re-apply any pending/approved edits to the DOM so client sees their changes
  const patchCount = await applyPendingEdits();
  if (patchCount > 0) {
    console.log(`[ShipStudio] Re-applied ${patchCount} pending edit(s)`);
  }

  showEditToggle(shadow, studioId);
}

function showEditToggle(shadow: ShadowRoot, studioId: string) {
  injectStyles(shadow);

  const icon = h('span', { className: 'ss-edit-toggle-icon' }, '✎');
  const label = h('span', {}, 'Edit Mode');
  const toggle = h('div', { className: 'ss-edit-toggle' });
  toggle.setAttribute('data-ss-editor', '');
  toggle.append(icon, label);
  shadow.appendChild(toggle);

  toggle.addEventListener('click', () => {
    toggle.remove();
    activateEditor(shadow, studioId);
  });
}

async function activateEditor(shadow: ShadowRoot, studioId: string) {
  const supabase = getSupabase();

  // Subscribe to realtime updates for edit status
  const projectId = EditorState.getProjectId();
  if (projectId) {
    const channel = supabase
      .channel('my-edits')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'inline_edits',
          filter: `submitted_by=eq.${EditorState.getUser()?.id}`,
        },
        (payload) => {
          const edit = payload.new as { id: string; status: string; review_note?: string; apply_steps?: any[] };

          // Update the visual indicator on the patched DOM element
          updateEditStatus(edit.id, edit.status as any, edit.review_note);

          // Forward to apply-progress overlay (no-ops if not tracking this edit)
          onEditUpdate(edit);

          // Skip toasts for auto-apply edits — the progress overlay handles them
          const config = EditorState.getConfig();
          const isAutoApplied = config?.auto_apply && (edit.status === 'applied' || edit.status === 'failed');

          if (edit.status === 'approved') {
            showToast(shadow, 'Your edit was approved!', 'success');
          } else if (edit.status === 'rejected') {
            showToast(
              shadow,
              `Edit rejected${edit.review_note ? `: ${edit.review_note}` : ''}`,
              'error'
            );
          } else if (edit.status === 'applied' && !isAutoApplied) {
            showToast(shadow, 'Your edit has been applied!', 'success');
          }
        }
      )
      .subscribe();

    EditorState.setChannel(channel);
  }

  // Create toolbar
  createToolbar(shadow);

  // Add close button to toolbar
  const toolbar = shadow.querySelector('.ss-toolbar');
  if (toolbar) {
    const closeBtn = h('button', { className: 'ss-btn ss-btn-ghost' }, '✕');
    closeBtn.title = 'Exit edit mode';
    closeBtn.addEventListener('click', () => {
      deactivateEditor(shadow, studioId);
    });
    toolbar.appendChild(closeBtn);
  }

  // Init hover highlighting
  initHighlighter(shadow);

  // Init editor (contentEditable management)
  initEditor(shadow);

  EditorState.transition('active');
  showToast(shadow, 'Editor activated — click any element to edit', 'info');
}

function deactivateEditor(shadow: ShadowRoot, studioId: string) {
  destroyEditor();
  destroyHighlighter();
  destroyToolbar();
  closeImagePanel();
  closeMetaPanel();
  closeHistoryPanel();

  // Unsubscribe from realtime channel
  const channel = EditorState.getChannel();
  if (channel) {
    channel.unsubscribe();
    EditorState.setChannel(null);
  }

  EditorState.transition('idle');

  // Re-show the edit mode toggle
  showEditToggle(shadow, studioId);
}
