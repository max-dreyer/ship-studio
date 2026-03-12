/**
 * Content editing — manages contentEditable, captures text changes,
 * and handles image click-to-edit.
 */

import { EditorState } from './state';
import { buildTextDiff, buildImageDiff } from './differ';
import { showImagePanel } from '../ui/image-panel';
import { updateToolbar } from '../ui/toolbar';
import { showToast } from '../ui/toast';

interface EditingSession {
  element: HTMLElement;
  originalText: string;
  originalHTML: string;
}

let activeSession: EditingSession | null = null;
let shadowRef: ShadowRoot | null = null;
let hintEl: HTMLElement | null = null;

function handleClick(e: MouseEvent) {
  if (EditorState.getPhase() === 'submitting') return;

  const target = e.target as HTMLElement;
  if (!target || target.closest('[data-ss-editor]')) return;

  // Image click → image panel
  if (target.tagName === 'IMG') {
    e.preventDefault();
    e.stopPropagation();
    showImagePanel(shadowRef!, target as HTMLImageElement);
    return;
  }

  // Text click → contentEditable
  if (target.textContent?.trim()) {
    e.preventDefault();
    e.stopPropagation();
    startTextEditing(target);
  }
}

function startTextEditing(el: HTMLElement) {
  // End any existing session
  endTextEditing();

  activeSession = {
    element: el,
    originalText: el.textContent || '',
    originalHTML: el.innerHTML,
  };

  el.contentEditable = 'true';
  el.focus();
  el.style.outline = '2px solid #3b82f6';
  el.style.outlineOffset = '2px';
  el.style.borderRadius = '2px';

  showEditHint(el);
  EditorState.transition('editing');
}

function endTextEditing() {
  if (!activeSession) return;
  removeEditHint();

  const { element, originalText } = activeSession;
  const newText = element.textContent || '';

  element.contentEditable = 'false';
  element.style.outline = '';
  element.style.outlineOffset = '';
  element.style.borderRadius = '';

  // Check if text actually changed
  if (newText !== originalText) {
    const diff = buildTextDiff(element, originalText, newText);
    EditorState.addEdit(diff);
    updateToolbar(shadowRef!);
    showToast(shadowRef!, 'Edit captured', 'success');
  }

  activeSession = null;
  EditorState.transition('active');
}

function handleKeyDown(e: KeyboardEvent) {
  if (!activeSession) return;

  if (e.key === 'Escape') {
    // Cancel editing, restore original
    removeEditHint();
    activeSession.element.innerHTML = activeSession.originalHTML;
    activeSession.element.contentEditable = 'false';
    activeSession.element.style.outline = '';
    activeSession.element.style.outlineOffset = '';
    activeSession.element.style.borderRadius = '';
    activeSession = null;
    EditorState.transition('active');
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    endTextEditing();
  }
}

function handleClickOutside(e: MouseEvent) {
  if (!activeSession) return;
  const target = e.target as HTMLElement;
  if (target !== activeSession.element && !activeSession.element.contains(target)) {
    endTextEditing();
  }
}

function showEditHint(el: HTMLElement) {
  removeEditHint();
  hintEl = document.createElement('div');
  hintEl.setAttribute('data-ss-editor', 'true');
  hintEl.textContent = 'Enter to save · Esc to cancel';
  hintEl.style.cssText = `
    position: absolute;
    left: ${el.getBoundingClientRect().left + window.scrollX}px;
    top: ${el.getBoundingClientRect().bottom + window.scrollY + 6}px;
    background: #1e1e1e;
    color: #999;
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid #333;
    z-index: 2147483647;
    pointer-events: none;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    white-space: nowrap;
  `;
  document.body.appendChild(hintEl);
}

function removeEditHint() {
  if (hintEl) {
    hintEl.remove();
    hintEl = null;
  }
}

export function initEditor(shadow: ShadowRoot) {
  shadowRef = shadow;

  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  document.addEventListener('mousedown', handleClickOutside, true);
}

export function destroyEditor() {
  endTextEditing();
  removeEditHint();
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  document.removeEventListener('mousedown', handleClickOutside, true);
  shadowRef = null;
}
