/**
 * Element identity and message building for preview comments.
 *
 * Focus: the failure the whole feature turns on. A note that comes back on the
 * wrong element is worse than one that admits it lost its anchor, so the tests
 * here are mostly about telling lookalikes apart and about reporting ambiguity
 * honestly instead of picking a winner.
 */

import { describe, it, expect } from 'vitest';
import {
  anchorFor,
  structuralPath,
  describeElement,
  groupByPage,
  buildAgentMessage,
  type PreviewComment,
} from './comments';

/** Build a document from HTML and hand back its body. */
function dom(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body;
}

const comment = (over: Partial<PreviewComment> = {}): PreviewComment => ({
  id: 'c1',
  dom_path: 'body > h1',
  url: '/',
  label: 'h1',
  text: 'make this bigger',
  added_at: 1,
  sent: false,
  ...over,
});

describe('describeElement', () => {
  it('names an element the way the note list should read', () => {
    const body = dom('<h1 class="hero big">A</h1><button id="submit">B</button><div></div>');
    expect(describeElement(body.querySelector('h1')!)).toBe('h1.hero');
    expect(describeElement(body.querySelector('button')!)).toBe('button#submit');
    expect(describeElement(body.querySelector('div')!)).toBe('div');
  });
});

describe('anchorFor', () => {
  it('prefers an id, and calls that exact', () => {
    const body = dom('<div><p id="intro">A</p></div>');
    const anchor = anchorFor(body.querySelector('#intro')!, body);
    expect(anchor.domPath).toBe('#intro');
    expect(anchor.confidence).toBe('exact');
  });

  it('uses a test id when there is no id', () => {
    const body = dom('<span data-testid="price">9</span>');
    const anchor = anchorFor(body.querySelector('span')!, body);
    expect(anchor.domPath).toBe('[data-testid="price"]');
    expect(anchor.confidence).toBe('exact');
  });

  it('ignores a duplicated id rather than trusting it', () => {
    // Invalid HTML, but it happens; two elements share #item.
    const body = dom('<p id="item">A</p><p id="item">B</p>');
    const anchor = anchorFor(body.querySelectorAll('p')[1], body);
    expect(anchor.domPath).not.toBe('#item');
  });

  it('tells sibling lookalikes apart structurally', () => {
    const body = dom('<ul><li>one</li><li>two</li><li>three</li></ul>');
    const items = body.querySelectorAll('li');
    const second = anchorFor(items[1], body);
    const third = anchorFor(items[2], body);

    expect(second.domPath).not.toBe(third.domPath);
    expect(second.confidence).toBe('structural');
    expect(body.querySelectorAll(second.domPath)).toHaveLength(1);
    expect(body.querySelectorAll(second.domPath)[0]).toBe(items[1]);
  });

  it('anchors below the nearest id, so unrelated page changes do not shift it', () => {
    const body = dom('<div id="main"><section><p>A</p><p>B</p></section></div>');
    const anchor = anchorFor(body.querySelectorAll('p')[1], body);
    expect(anchor.domPath.startsWith('#main')).toBe(true);
    expect(body.querySelectorAll(anchor.domPath)[0]).toBe(body.querySelectorAll('p')[1]);
  });

  it('counts among its own type, so an inserted script does not re-point notes', () => {
    const before = dom('<div><p>A</p><p>B</p></div>');
    const after = dom('<div><script></script><p>A</p><p>B</p></div>');
    const target = (b: HTMLElement) => b.querySelectorAll('p')[1];

    expect(structuralPath(target(before))).toBe(structuralPath(target(after)));
    expect(after.querySelectorAll(structuralPath(target(after)))[0]).toBe(target(after));
  });
});

describe('groupByPage', () => {
  it('groups by page, keeping first-seen order', () => {
    const groups = groupByPage([
      comment({ id: 'a', url: '/' }),
      comment({ id: 'b', url: '/about' }),
      comment({ id: 'c', url: '/' }),
    ]);
    expect(groups.map((g) => g.url)).toEqual(['/', '/about']);
    expect(groups[0].comments.map((c) => c.id)).toEqual(['a', 'c']);
  });

  it('treats a missing url as the root', () => {
    expect(groupByPage([comment({ url: '' })])[0].url).toBe('/');
  });
});

describe('buildAgentMessage', () => {
  it('is empty for no notes, so nothing is ever sent blank', () => {
    expect(buildAgentMessage([])).toBe('');
  });

  it('names the element for each note so the agent can find it', () => {
    const msg = buildAgentMessage([comment({ label: 'h1.hero', text: 'bigger' })]);
    expect(msg).toContain('h1.hero');
    expect(msg).toContain('bigger');
    expect(msg).toContain('A note from the preview:');
  });

  it('locates a note whose element has no class of its own', () => {
    // The case that made notes unusable: every one of these read "- div: …",
    // and nothing in the message said which div was meant.
    const msg = buildAgentMessage([
      comment({
        label: 'div',
        dom_path: 'body > footer:nth-of-type(1) > div:nth-of-type(1) > div:nth-of-type(2)',
        text: 'Termin-Icon ergänzen',
      }),
    ]);
    expect(msg).toContain('body › footer › div › div (2)');
    expect(msg).toContain('Termin-Icon ergänzen');
  });

  it("quotes the element's own text, which is what makes it recognisable", () => {
    const msg = buildAgentMessage([
      comment({
        label: 'div',
        element_text: 'Kontakt Impressum Datenschutz',
        text: 'Termin-Icon ergänzen',
      }),
    ]);
    expect(msg).toContain('text: "Kontakt Impressum Datenschutz"');
  });

  it('omits the quote for notes that never captured one', () => {
    // Notes from before the field existed: no invented quote, just the path.
    const msg = buildAgentMessage([comment({ label: 'div', element_text: '' })]);
    expect(msg).not.toContain('text: ""');
  });

  it('reads the older index path format too', () => {
    const msg = buildAgentMessage([
      comment({ label: 'h1', dom_path: 'body:1>main:0>h1:1', text: 'umbenennen' }),
    ]);
    expect(msg).toContain('body (1) › main › h1 (1)');
  });

  it('keeps a descriptive label and adds the location behind it', () => {
    const msg = buildAgentMessage([
      comment({ label: 'a.btn-primary', dom_path: 'body > nav:nth-of-type(1) > a:nth-of-type(3)' }),
    ]);
    expect(msg).toContain('a.btn-primary — body › nav › a (3)');
  });

  it('groups several notes by page and counts them', () => {
    const msg = buildAgentMessage([
      comment({ id: 'a', url: '/', label: 'h1', text: 'bigger' }),
      comment({ id: 'b', url: '/about', label: 'p', text: 'typo' }),
    ]);
    expect(msg).toContain('2 notes from the preview:');
    expect(msg).toContain('Page /about');
    expect(msg.indexOf('Page /')).toBeLessThan(msg.indexOf('Page /about'));
  });
});
