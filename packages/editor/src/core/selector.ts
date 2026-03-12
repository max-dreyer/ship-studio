/**
 * Element fingerprinting — generates multi-signal fingerprints for locating
 * elements in source code.
 */

import type { ElementFingerprint } from '@shipstudio/shared';

/** Generate a CSS selector path for an element */
function getCssSelector(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();

    if (current.id) {
      selector += `#${CSS.escape(current.id)}`;
      parts.unshift(selector);
      break;
    }

    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-child(${index})`;
      }
    }

    parts.unshift(selector);
    current = parent;
  }

  return parts.join(' > ');
}

/** Get truncated text content */
function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  const cleaned = text.trim().replace(/\s+/g, ' ');
  return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned;
}

/** Build a full element fingerprint */
export function buildFingerprint(el: Element): ElementFingerprint {
  const parent = el.parentElement;
  const prevSibling = el.previousElementSibling;
  const nextSibling = el.nextElementSibling;

  // Find nearest ancestor with an ID
  let nearestId: string | null = null;
  let ancestor: Element | null = el.parentElement;
  while (ancestor) {
    if (ancestor.id) {
      nearestId = ancestor.id;
      break;
    }
    ancestor = ancestor.parentElement;
  }

  // Collect data attributes
  const dataAttributes: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-')) {
      dataAttributes[attr.name] = attr.value;
    }
  }

  return {
    cssSelector: getCssSelector(el),
    tagName: el.tagName.toLowerCase(),
    textContent: truncate(el.textContent, 200),
    parentText: truncate(parent?.textContent, 200),
    previousSiblingText: truncate(prevSibling?.textContent, 100),
    nextSiblingText: truncate(nextSibling?.textContent, 100),
    nearestIdAncestor: nearestId,
    classList: Array.from(el.classList),
    dataAttributes,
    ariaLabel: el.getAttribute('aria-label'),
    src: (el as HTMLImageElement).src || null,
  };
}
