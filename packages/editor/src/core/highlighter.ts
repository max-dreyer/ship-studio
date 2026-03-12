/**
 * Hover overlay on editable elements — shows a blue outline when hovering
 * over elements that can be edited.
 */

import { EditorState } from './state';
import { injectStyles } from '../ui/styles';

const HIGHLIGHT_CLASS = 'ss-editor-highlight';
const NON_EDITABLE_TAGS = new Set([
  'HTML', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'BR', 'HR',
  'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'SVG', 'CANVAS',
]);

let currentHighlight: HTMLElement | null = null;
let overlay: HTMLDivElement | null = null;

/** Tags that should never be highlighted */
const SKIP_TAGS = new Set([
  'HTML', 'HEAD', 'BODY', 'SCRIPT', 'STYLE', 'LINK', 'META', 'BR', 'HR',
  'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'SVG', 'CANVAS',
  'NAV', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE',
]);

/** Check if an element directly contains meaningful text (not just text from children) */
function hasOwnText(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
      return true;
    }
  }
  return false;
}

function isEditable(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return false;
  if (el.closest('[data-ss-editor]')) return false; // Our own UI
  if (el.tagName === 'IMG') return true;

  // Must have some text content
  const text = el.textContent?.trim();
  if (!text) return false;

  // Element must directly contain text (leaf-level text container)
  // Either it has its own text nodes, or all its children are inline formatting (b, i, em, etc.)
  if (hasOwnText(el)) return true;

  // Allow elements whose children are only inline formatting tags
  if (el.children.length > 0 && el.children.length <= 5) {
    const allInline = Array.from(el.children).every((child) =>
      ['STRONG', 'EM', 'B', 'I', 'U', 'S', 'SPAN', 'A', 'SMALL', 'BR'].includes(child.tagName)
    );
    if (allInline) return true;
  }

  return false;
}

function showOverlay(el: HTMLElement) {
  if (!overlay) return;
  const rect = el.getBoundingClientRect();
  overlay.style.display = 'block';
  overlay.style.top = `${rect.top + window.scrollY}px`;
  overlay.style.left = `${rect.left + window.scrollX}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
}

function hideOverlay() {
  if (overlay) overlay.style.display = 'none';
  currentHighlight = null;
}

function handleMouseMove(e: MouseEvent) {
  if (EditorState.getPhase() !== 'active') return;

  const target = e.target as HTMLElement;
  if (!target || target === currentHighlight) return;

  if (isEditable(target)) {
    currentHighlight = target;
    showOverlay(target);
  } else {
    hideOverlay();
  }
}

function handleMouseLeave() {
  hideOverlay();
}

export function initHighlighter(shadow: ShadowRoot) {
  // Inject highlight styles
  injectStyles(shadow);

  // Create overlay element in the shadow DOM
  overlay = document.createElement('div');
  overlay.className = HIGHLIGHT_CLASS;
  overlay.style.cssText = `
    position: absolute;
    pointer-events: none;
    border: 2px solid #3b82f6;
    border-radius: 4px;
    background: rgba(59, 130, 246, 0.08);
    z-index: 2147483646;
    display: none;
    transition: all 0.1s ease;
  `;
  document.body.appendChild(overlay);

  document.addEventListener('mousemove', handleMouseMove, { passive: true });
  document.addEventListener('mouseleave', handleMouseLeave, { passive: true });
}

export function destroyHighlighter() {
  document.removeEventListener('mousemove', handleMouseMove);
  document.removeEventListener('mouseleave', handleMouseLeave);
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  currentHighlight = null;
}

export function getHighlightedElement(): HTMLElement | null {
  return currentHighlight;
}
