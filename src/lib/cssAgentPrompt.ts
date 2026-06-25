/**
 * Turn a visually-proposed CSS change into a precise instruction for the coding
 * agent (Claude Code / Codex). Used by the "Send to agent" flow: when a rule can't
 * be edited deterministically (defined across multiple files, an inline style, a
 * scoped non-CSS block, …), the user tweaks it visually — preview-only — and we
 * hand the agent a spec of the intended end-state to implement in real source.
 *
 * Pure and side-effect free so it's unit-testable; delivery (PTY injection) lives
 * in the AgentBridge.
 */

/** One declaration the user wants on the rule. `from` is the current value when the
 *  property already exists (so the agent can find it), absent when it's a new one. */
export interface ProposedDecl {
  prop: string;
  to: string;
  from?: string;
}

/** A visually-proposed change to one rule that the agent should implement in source. */
export interface ProposedCssChange {
  /** The selector whose styles should change (`.u-heading > *`, `*`, `h2`). */
  selector: string;
  /** The clicked element's context, so the agent targets the right place. */
  element?: { tag: string; classes: string[] };
  /** Declarations to set/add, in display order. */
  edits: ProposedDecl[];
  /** Why a direct edit wasn't possible — surfaced so the agent understands the ask. */
  readonlyReason?: string;
  /** Candidate source files (e.g. from the "defined in multiple files" case). */
  files?: string[];
}

/** A short, human-readable description of the element for the prompt. */
function describeElement(el?: { tag: string; classes: string[] }): string {
  if (!el) return '';
  const cls = el.classes.length ? ` class="${el.classes.join(' ')}"` : '';
  return `<${el.tag}${cls}>`;
}

/**
 * Build a ready-to-run agent prompt for a proposed CSS change. Precise by design:
 * names the element, the selector, each declaration (with its current value when
 * known), and any file hints, then asks the agent to implement it while preserving
 * the cascade — never to guess or to reach for `!important`.
 */
export function buildCssChangePrompt(change: ProposedCssChange): string {
  const { selector, element, edits, readonlyReason, files } = change;
  const lines: string[] = [];

  const el = describeElement(element);
  const target = el ? `the element ${el}` : `elements matching \`${selector}\``;
  lines.push(`In this project's CSS, change the styles for ${target}.`);
  lines.push('');
  lines.push(`It's styled by the selector \`${selector}\`. Apply these declarations:`);
  for (const e of edits) {
    const e0 = e.from ? ` (currently \`${e.from}\`)` : ' (new)';
    lines.push(`- \`${e.prop}: ${e.to};\`${e0}`);
  }
  lines.push('');

  if (files && files.length > 1) {
    lines.push(
      `This selector is defined in more than one file (${files
        .map((f) => `\`${f}\``)
        .join(', ')}). Find where it actually applies to this element and edit that one.`
    );
  } else if (readonlyReason) {
    lines.push(`Note: ${readonlyReason}.`);
  }

  lines.push(
    'Implement it in the real source, preserving the existing cascade and formatting. ' +
      "Don't add `!important` unless there's no other way."
  );

  return lines.join('\n');
}
