/**
 * Pending edit applicator — on page load, fetches the client's pending/approved
 * edits from Supabase and re-applies them to the DOM with visual indicators.
 */

import type { InlineEdit, EditStatus } from '@shipstudio/shared';
import { fetchMyEdits } from '../api/client';
import { EditorState } from './state';

/** Tracks which DOM elements have been patched so we can update/remove indicators */
interface AppliedPatch {
  edit: InlineEdit;
  element: HTMLElement;
  indicator: HTMLElement;
  originalText?: string;
  originalSrc?: string;
}

const patches: AppliedPatch[] = [];

/**
 * Fetch pending/approved edits for the current page and apply them to the DOM.
 * Called once after auth during boot, and can be called again to refresh.
 */
export async function applyPendingEdits(): Promise<number> {
  const projectId = EditorState.getProjectId();
  const user = EditorState.getUser();
  if (!projectId) return 0;

  const pageUrl = window.location.pathname;

  try {
    const edits = await fetchMyEdits(projectId, pageUrl, user?.id ?? null);
    let applied = 0;

    for (const edit of edits) {
      // Skip if we already patched this edit
      if (patches.some((p) => p.edit.id === edit.id)) continue;

      const patched = applyEditToDOM(edit);
      if (patched) applied++;
    }

    return applied;
  } catch (err) {
    console.warn('[ShipStudio] Failed to apply pending edits:', err);
    return 0;
  }
}

/** Find the target element for an edit using fingerprint matching */
function findElement(edit: InlineEdit): HTMLElement | null {
  const fp = edit.element_fingerprint;
  if (!fp) return null;

  // 1. Try CSS selector first
  if (fp.cssSelector) {
    try {
      const el = document.querySelector(fp.cssSelector) as HTMLElement | null;
      if (el && matchesEdit(el, edit)) return el;
    } catch {
      // Invalid selector, fall through
    }
  }

  // 2. Fall back: scan by tag name + original text content
  const tagName = (fp.tagName || edit.element_tag_name || '').toUpperCase();
  if (!tagName) return null;

  const candidates = document.querySelectorAll(tagName);
  let bestMatch: HTMLElement | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    const el = candidate as HTMLElement;
    if (el.closest('[data-ss-editor]')) continue;

    const score = scoreMatch(el, edit);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = el;
    }
  }

  // Require a minimum confidence score
  return bestScore >= 0.5 ? bestMatch : null;
}

/** Check if an element plausibly matches an edit (quick check) */
function matchesEdit(el: HTMLElement, edit: InlineEdit): boolean {
  // For text edits, the element should contain the original text
  if (edit.original_text) {
    const text = (el.textContent || '').trim();
    const original = edit.original_text.trim();
    if (text === original) return true;
    // Also match if a previous pending edit already changed it
    if (edit.new_text && text === edit.new_text.trim()) return true;
  }

  // For image edits, match by src
  if (edit.edit_type === 'image_change' && edit.image_changes) {
    const img = el as HTMLImageElement;
    if (img.src === edit.image_changes.originalSrc) return true;
    if (img.src === edit.image_changes.newSrc) return true;
  }

  return false;
}

/** Score how well an element matches an edit (0-1) */
function scoreMatch(el: HTMLElement, edit: InlineEdit): number {
  let score = 0;
  let signals = 0;
  const fp = edit.element_fingerprint;

  // Text content match
  if (edit.original_text) {
    signals++;
    const text = (el.textContent || '').trim();
    const original = edit.original_text.trim();
    if (text === original) {
      score += 1;
    } else if (edit.new_text && text === edit.new_text.trim()) {
      // Already patched or content was updated
      score += 0.9;
    } else if (text.includes(original) || original.includes(text)) {
      score += 0.3;
    }
  }

  // Image src match
  if (edit.edit_type === 'image_change' && edit.image_changes) {
    signals++;
    const img = el as HTMLImageElement;
    if (img.src === edit.image_changes.originalSrc) score += 1;
    else if (img.src === edit.image_changes.newSrc) score += 0.9;
  }

  // Nearest ID ancestor match
  if (fp?.nearestIdAncestor) {
    signals++;
    let ancestor: Element | null = el.parentElement;
    while (ancestor) {
      if (ancestor.id === fp.nearestIdAncestor) {
        score += 1;
        break;
      }
      ancestor = ancestor.parentElement;
    }
  }

  // Class list match
  if (fp?.classList?.length) {
    signals++;
    const elClasses = Array.from(el.classList);
    const matchCount = fp.classList.filter((c) => elClasses.includes(c)).length;
    score += matchCount / fp.classList.length;
  }

  return signals > 0 ? score / signals : 0;
}

/** Apply a single edit to the DOM and add a visual indicator */
function applyEditToDOM(edit: InlineEdit): boolean {
  // Only apply pending edits
  if (edit.status !== 'pending') return false;

  // Meta changes don't apply to visible elements
  if (edit.edit_type === 'meta_change') return false;

  const el = findElement(edit);
  if (!el) return false;

  const patch: AppliedPatch = {
    edit,
    element: el,
    indicator: null!,
    originalText: undefined,
    originalSrc: undefined,
  };

  // Apply the change to the DOM
  if (
    (edit.edit_type === 'text_change' ||
      edit.edit_type === 'text_add' ||
      edit.edit_type === 'text_delete') &&
    edit.new_text !== null &&
    edit.new_text !== undefined
  ) {
    const currentText = (el.textContent || '').trim();
    // Only replace if the element still shows the original text
    if (currentText === (edit.original_text || '').trim()) {
      patch.originalText = el.textContent || '';
      el.textContent = edit.new_text;
    }
  } else if (edit.edit_type === 'image_change' && edit.image_changes) {
    const img = el as HTMLImageElement;
    if (img.src === edit.image_changes.originalSrc) {
      patch.originalSrc = img.src;
      img.src = edit.image_changes.newSrc;
      if (edit.image_changes.newAlt) {
        img.alt = edit.image_changes.newAlt;
      }
    }
  }

  // Add visual indicator
  const indicator = createIndicator(edit.status, el);
  patch.indicator = indicator;

  // Mark the element so we can find it later
  el.setAttribute('data-ss-patched', edit.id);

  patches.push(patch);
  return true;
}

/** Reposition all dots to track their elements (call on scroll/resize) */
function repositionDots() {
  for (const patch of patches) {
    if (!patch.indicator || !patch.element) continue;
    positionDot(patch.indicator, patch.element);
  }
}

function positionDot(dot: HTMLElement, el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  dot.style.top = `${rect.top + window.scrollY - 7}px`;
  dot.style.left = `${rect.right + window.scrollX + 1}px`;
}

let repositionListenersAdded = false;

function ensureRepositionListeners() {
  if (repositionListenersAdded) return;
  repositionListenersAdded = true;
  window.addEventListener('scroll', repositionDots, { passive: true });
  window.addEventListener('resize', repositionDots, { passive: true });
}

/** Create a small colored dot indicator positioned at the top-right of the element */
function createIndicator(_status: EditStatus, el: HTMLElement): HTMLElement {
  const color = '#eab308';

  // Dashed outline on the element itself
  el.style.outline = `2px dashed ${color}`;
  el.style.outlineOffset = '3px';
  el.style.borderRadius = '3px';

  // Small dot on document.body
  const dot = document.createElement('div');
  dot.setAttribute('data-ss-editor', 'true');
  dot.style.cssText = `
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${color};
    z-index: 2147483640;
    cursor: default;
    pointer-events: auto;
    box-shadow: 0 0 0 2px rgba(0,0,0,0.3);
  `;

  // Tooltip on hover
  const tooltip = document.createElement('div');
  tooltip.setAttribute('data-ss-editor', 'true');
  tooltip.textContent = 'Pending';
  tooltip.style.cssText = `
    position: absolute;
    bottom: 14px;
    right: -4px;
    background: #1e1e1e;
    color: #fff;
    font-size: 11px;
    font-weight: 500;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.15s;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  `;
  dot.appendChild(tooltip);

  dot.addEventListener('mouseenter', () => { tooltip.style.opacity = '1'; });
  dot.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });

  document.body.appendChild(dot);
  positionDot(dot, el);
  ensureRepositionListeners();

  return dot;
}

/**
 * Update indicator for a specific edit (called when Realtime notifies of status change).
 */
export function updateEditStatus(editId: string, newStatus: EditStatus, reviewNote?: string) {
  const patch = patches.find((p) => p.edit.id === editId);
  if (!patch) return;

  patch.edit.status = newStatus;

  if (newStatus === 'approved' || newStatus === 'applied') {
    // Edit was accepted — remove indicator, keep the content
    removeIndicator(patch);
  } else if (newStatus === 'rejected') {
    // Revert the DOM change and remove indicator
    revertPatch(patch);
  }
}

function removeIndicator(patch: AppliedPatch) {
  const { element, indicator } = patch;

  if (indicator) indicator.remove();
  element.style.outline = '';
  element.style.outlineOffset = '';
  element.style.borderRadius = '';
  element.removeAttribute('data-ss-patched');

  // Remove from patches array
  const idx = patches.indexOf(patch);
  if (idx >= 0) patches.splice(idx, 1);

  // Clean up listeners if no more patches
  if (patches.length === 0 && repositionListenersAdded) {
    window.removeEventListener('scroll', repositionDots);
    window.removeEventListener('resize', repositionDots);
    repositionListenersAdded = false;
  }
}

function revertPatch(patch: AppliedPatch) {
  const { element, edit } = patch;

  // Restore original content
  if (patch.originalText !== undefined) {
    element.textContent = patch.originalText;
  } else if (patch.originalSrc !== undefined && edit.image_changes) {
    const img = element as HTMLImageElement;
    img.src = edit.image_changes.originalSrc;
    img.alt = edit.image_changes.originalAlt;
  }

  removeIndicator(patch);
}

/** Clean up all patches (called when editor is destroyed) */
export function clearAllPatches() {
  for (const patch of [...patches]) {
    removeIndicator(patch);
  }
  patches.length = 0;
}

/** Get count of currently applied patches */
export function getPatchCount(): number {
  return patches.length;
}
