/**
 * Front-matter colouring: which spans get marked, and — more importantly —
 * when nothing should be.
 *
 * The decorations are line-based, so the risk isn't a wrong colour, it's
 * treating an ordinary horizontal rule as the start of a config block and
 * repainting half a document.
 */

import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownFrontMatter } from './codemirror';

/** Mount a document off-screen and read back the decorated ranges. */
function marks(doc: string): { text: string; cls: string }[] {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [markdownFrontMatter] }),
  });
  const out: { text: string; cls: string }[] = [];
  for (const set of view.state.facet(EditorView.decorations)) {
    const decorations = typeof set === 'function' ? set(view) : set;
    const iter = decorations.iter();
    while (iter.value) {
      const cls = (iter.value.spec as { class?: string }).class ?? '';
      out.push({ text: view.state.doc.sliceString(iter.from, iter.to), cls });
      iter.next();
    }
  }
  view.destroy();
  return out;
}

describe('markdownFrontMatter', () => {
  it('marks keys and values inside the leading fence', () => {
    const found = marks('---\nname: Max Dreyer Portfolio\nversion: 2\n---\n\n# Heading\n');
    const keys = found.filter((m) => m.cls === 'cm-fm-key').map((m) => m.text);
    const values = found.filter((m) => m.cls === 'cm-fm-value').map((m) => m.text);

    expect(keys).toEqual(['name', 'version']);
    expect(values).toEqual(['Max Dreyer Portfolio', '2']);
  });

  it('keeps indented keys, so nested config still reads', () => {
    const found = marks('---\ncolors:\n  ink: "#171815"\n---\n');
    const keys = found.filter((m) => m.cls === 'cm-fm-key').map((m) => m.text);
    // The nested key is marked without its indentation.
    expect(keys).toEqual(['colors', 'ink']);
  });

  it('leaves a horizontal rule mid-document alone', () => {
    // The dangerous case: `---` as a section break, not front matter.
    expect(marks('# Title\n\n---\n\nkey: not config\n')).toEqual([]);
  });

  it('ignores an unclosed fence', () => {
    // Someone is still typing; colouring the rest of the file would flash.
    expect(marks('---\nname: half written\n')).toEqual([]);
  });

  it('skips comments and bare nesting headers', () => {
    const found = marks('---\n# a comment\nparent:\n---\n');
    const keys = found.filter((m) => m.cls === 'cm-fm-key').map((m) => m.text);
    const values = found.filter((m) => m.cls === 'cm-fm-value');
    expect(keys).toEqual(['parent']);
    // `parent:` has no value, so nothing is marked as one.
    expect(values).toEqual([]);
  });
});
