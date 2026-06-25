import { describe, expect, it } from 'vitest';
import { buildCssChangePrompt, type ProposedCssChange } from './cssAgentPrompt';

describe('buildCssChangePrompt', () => {
  const base: ProposedCssChange = {
    selector: '.u-heading > *',
    element: { tag: 'h1', classes: ['hero_title', 'u-heading'] },
    edits: [
      { prop: 'padding', to: '32px', from: '0px' },
      { prop: 'color', to: 'var(--accent)' },
    ],
  };

  it('names the element, selector, and each declaration with its current value', () => {
    const out = buildCssChangePrompt(base);
    expect(out).toContain('<h1 class="hero_title u-heading">');
    expect(out).toContain('`.u-heading > *`');
    expect(out).toContain('`padding: 32px;` (currently `0px`)');
    expect(out).toContain('`color: var(--accent);` (new)');
  });

  it('mentions the candidate files for the multiple-files case', () => {
    const out = buildCssChangePrompt({
      ...base,
      files: ['src/styles/reset.css', 'src/styles/theme.css'],
    });
    expect(out).toContain('more than one file');
    expect(out).toContain('`src/styles/reset.css`');
    expect(out).toContain('`src/styles/theme.css`');
  });

  it('falls back to the read-only reason when there are no file hints', () => {
    const out = buildCssChangePrompt({
      ...base,
      readonlyReason: 'inline style — move it to a class to edit',
    });
    expect(out).toContain('inline style');
  });

  it('handles a missing element gracefully', () => {
    const out = buildCssChangePrompt({ selector: 'h2', edits: [{ prop: 'color', to: 'red' }] });
    expect(out).toContain('elements matching `h2`');
    expect(out).not.toContain('<undefined');
  });
});
