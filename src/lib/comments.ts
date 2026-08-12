/**
 * Preview comments — notes pinned to elements in the live preview, handed to
 * the agent in bulk.
 *
 * Two jobs live here: the typed mirror of `commands/comments.rs`, and the
 * element-identity scheme the pins depend on.
 *
 * Identity is the hard part. A note is worthless if it comes back attached to
 * the wrong element, and a page full of list items offers plenty of ways to
 * get that wrong. The rule this module follows is: prefer an anchor the page
 * itself guarantees (an id), fall back to structure, and when two elements are
 * genuinely indistinguishable, SAY SO rather than pick one. A note that admits
 * it lost its element is recoverable; a note silently pointing at the wrong
 * paragraph is not.
 *
 * @module lib/comments
 */

import { invoke } from '@tauri-apps/api/core';

/** One note, mirroring `PreviewComment` in comments.rs. */
export interface PreviewComment {
  id: string;
  /** Opaque to everything but the injected script that resolves it. */
  dom_path: string;
  /** Page the note was left on, for grouping. */
  url: string;
  /** Short human label for the element (`h1.hero`). */
  label: string;
  text: string;
  /** Unix millis. */
  added_at: number;
  /** True once the note actually reached the agent. */
  sent: boolean;
}

/** How confident the path is that it names exactly one element. */
export type AnchorConfidence = 'exact' | 'structural' | 'ambiguous';

export interface ElementAnchor {
  domPath: string;
  label: string;
  confidence: AnchorConfidence;
}

/* ── Element identity ─────────────────────────────────────────────── */

/** Attributes worth anchoring to, most trustworthy first. */
const ID_ATTRS = ['id', 'data-testid', 'data-test-id', 'data-id'] as const;

function cssEscapeIdent(value: string): string {
  // Tests run outside a browser, so don't depend on CSS.escape being present.
  return value.replace(/([^\w-])/g, '\\$1');
}

/**
 * A stable-ish path to one element.
 *
 * `exact` when the page gave us a unique handle (an id, or an id-bearing
 * ancestor plus a unique tail). `structural` when nth-of-type indices name it
 * unambiguously within its parent chain. `ambiguous` when the same path also
 * matches siblings — the caller should tell the user the note may drift.
 */
export function anchorFor(el: Element, root: ParentNode): ElementAnchor {
  const label = describeElement(el);

  for (const attr of ID_ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    const selector =
      attr === 'id' ? `#${cssEscapeIdent(value)}` : `[${attr}="${cssEscapeIdent(value)}"]`;
    if (root.querySelectorAll(selector).length === 1) {
      return { domPath: selector, label, confidence: 'exact' };
    }
  }

  const path = structuralPath(el, root);
  const matches = safeQueryCount(root, path);
  return {
    domPath: path,
    label,
    // Zero matches means our own path doesn't find the element we just built it
    // from — treat that as ambiguous rather than claiming precision.
    confidence: matches === 1 ? 'structural' : 'ambiguous',
  };
}

function safeQueryCount(root: ParentNode, selector: string): number {
  try {
    return root.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

/**
 * `tag:nth-of-type(n) > tag:nth-of-type(n) > …` from the nearest usable
 * id-bearing ancestor (or the body) down to the element.
 *
 * nth-of-type rather than nth-child: inserting an unrelated `<script>` or a
 * comment-turned-element between siblings shifts nth-child and would silently
 * re-point every note below it.
 *
 * `root` is optional only so the function stays callable in isolation; pass it
 * whenever you can, because without it a duplicated id can't be spotted and
 * would be trusted as an anchor.
 */
export function structuralPath(el: Element, root?: ParentNode): string {
  const parts: string[] = [];
  let current: Element | null = el;

  while (current && current.tagName.toLowerCase() !== 'html') {
    const tag = current.tagName.toLowerCase();
    if (tag === 'body') {
      parts.unshift('body');
      break;
    }

    const id = current.getAttribute('id');
    // An id anchors everything below it — but only if the page actually kept
    // it unique. Duplicated ids are invalid HTML and common enough that
    // trusting one would silently point notes at the wrong element.
    if (id && (!root || safeQueryCount(root, `#${cssEscapeIdent(id)}`) === 1)) {
      parts.unshift(`#${cssEscapeIdent(id)}`);
      break;
    }

    parts.unshift(`${tag}:nth-of-type(${indexAmongType(current)})`);
    current = current.parentElement;
  }

  return parts.join(' > ');
}

function indexAmongType(el: Element): number {
  const tag = el.tagName;
  let index = 1;
  let sibling = el.previousElementSibling;
  while (sibling) {
    if (sibling.tagName === tag) index++;
    sibling = sibling.previousElementSibling;
  }
  return index;
}

/**
 * Short human label for the note list: `h1.hero`, `button#submit`, `div`.
 *
 * Only the first class — a utility-heavy element would otherwise produce a
 * label longer than the note itself.
 */
export function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id');
  if (id) return `${tag}#${id}`;
  const first = (el.getAttribute('class') ?? '').trim().split(/\s+/)[0];
  return first ? `${tag}.${first}` : tag;
}

/* ── Grouping and formatting ──────────────────────────────────────── */

/** Notes grouped by the page they were left on, pages in first-seen order. */
export function groupByPage(
  comments: PreviewComment[]
): { url: string; comments: PreviewComment[] }[] {
  const groups = new Map<string, PreviewComment[]>();
  for (const c of comments) {
    const key = c.url || '/';
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }
  return [...groups.entries()].map(([url, list]) => ({ url, comments: list }));
}

/**
 * The message handed to the agent.
 *
 * Grouped by page and labelled by element, because the agent needs to find the
 * thing being talked about in the source, and "make this bigger" alone can't
 * be acted on.
 */
export function buildAgentMessage(comments: PreviewComment[]): string {
  if (comments.length === 0) return '';
  const lines: string[] = [
    comments.length === 1
      ? 'A note from the preview:'
      : `${comments.length} notes from the preview:`,
  ];
  for (const group of groupByPage(comments)) {
    lines.push('', `Page ${group.url}`);
    for (const c of group.comments) {
      lines.push(`- ${c.label}: ${c.text}`);
    }
  }
  return lines.join('\n');
}

/* ── Backend ──────────────────────────────────────────────────────── */

export function listPreviewComments(projectPath: string): Promise<PreviewComment[]> {
  return invoke<PreviewComment[]>('list_preview_comments', { projectPath });
}

export function addPreviewComment(
  projectPath: string,
  comment: PreviewComment
): Promise<PreviewComment> {
  return invoke<PreviewComment>('add_preview_comment', { projectPath, comment });
}

export function updatePreviewComment(
  projectPath: string,
  id: string,
  text: string
): Promise<PreviewComment> {
  return invoke<PreviewComment>('update_preview_comment', { projectPath, id, text });
}

export function deletePreviewComment(projectPath: string, id: string): Promise<void> {
  return invoke<void>('delete_preview_comment', { projectPath, id });
}

export function reanchorPreviewComment(
  projectPath: string,
  id: string,
  domPath: string,
  label: string
): Promise<PreviewComment> {
  return invoke<PreviewComment>('reanchor_preview_comment', {
    projectPath,
    id,
    domPath,
    label,
  });
}

/** Marks only `ids` — see the command's own note on partial delivery. */
export function markPreviewCommentsSent(
  projectPath: string,
  ids: string[]
): Promise<PreviewComment[]> {
  return invoke<PreviewComment[]>('mark_preview_comments_sent', { projectPath, ids });
}

export function clearSentPreviewComments(projectPath: string): Promise<PreviewComment[]> {
  return invoke<PreviewComment[]>('clear_sent_preview_comments', { projectPath });
}
