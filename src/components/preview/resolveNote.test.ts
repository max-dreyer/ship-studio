/**
 * `resolveNote` from the injected select script: turning a stored dom_path
 * back into an element on the page.
 *
 * Two formats are in the wild. Comment mode writes a CSS selector, but notes
 * from other code paths carry an index path (`body:1>main:1>h1:1`, child
 * position rather than nth-of-type) which querySelector rejects outright. That
 * throw was being swallowed, every such note counted as lost, and its pin was
 * drawn at the canvas origin.
 *
 * The function is pulled out of the script's source so the test exercises the
 * shipped text, not a copy that can drift away from it.
 */

import { describe, it, expect } from 'vitest';
// The script is a .html asset; `?raw` hands it over as a string (unlike CSS,
// which Vitest resolves to an empty module).
import html from '../../../src-tauri/src/proxy/select_script.html?raw';

const src = html.slice(html.indexOf('function resolveNote'), html.indexOf('function report()'));
/* eslint-disable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call --
   The input is our own checked-in script file, never anything user-supplied,
   and evaluating it is the point: the alternative is a copy of the function in
   this file, which would keep passing after the shipped one changed. */
const resolveNote = new Function(`${src}; return resolveNote;`)() as (p: string) => Element | null;
/* eslint-enable @typescript-eslint/no-implied-eval, @typescript-eslint/no-unsafe-call */

it('found the function in the script (guards the extraction itself)', () => {
  // A rename upstream would otherwise leave every test below passing on junk.
  expect(src).toContain('function resolveNote');
  expect(typeof resolveNote).toBe('function');
});

describe('resolveNote', () => {
  it('resolves a CSS selector path', () => {
    document.body.innerHTML = '<div></div><div><span id="x">hi</span></div>';
    expect(resolveNote('#x')?.id).toBe('x');
  });
  it('resolves an index path querySelector cannot parse', () => {
    document.documentElement.innerHTML =
      '<head></head><body><div></div><main><h1>A</h1><h1>B</h1></main></body>';
    // body:1 = html.children[1]; main:1 = body.children[1]; h1:1 = second h1
    const el = resolveNote('body:1>main:1>h1:1');
    expect(el?.textContent).toBe('B');
  });
  it('returns null when the index path does not match', () => {
    document.documentElement.innerHTML = '<head></head><body><div></div></body>';
    expect(resolveNote('body:1>main:0>h1:0')).toBeNull();
  });
  it('returns null for junk', () => {
    expect(resolveNote('')).toBeNull();
    expect(resolveNote('>>>')).toBeNull();
  });
});
