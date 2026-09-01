/**
 * The link rules, checked where they're easy to get wrong: telling a page from
 * a file, and never writing an href that means something other than what the
 * user picked.
 */

import { describe, it, expect } from 'vitest';
import { buildHref, isDynamicHref, isPlainLinkTag, linkAttrName, parseHref } from './elementLink';

describe('parseHref', () => {
  it('reads a scheme as the kind it names', () => {
    expect(parseHref('mailto:hallo@example.com')).toEqual({
      kind: 'email',
      value: 'hallo@example.com',
    });
    expect(parseHref('tel:+493012345')).toEqual({ kind: 'phone', value: '+493012345' });
    expect(parseHref('#kontakt')).toEqual({ kind: 'anchor', value: 'kontakt' });
    expect(parseHref('https://example.com/x')).toEqual({
      kind: 'url',
      value: 'https://example.com/x',
    });
  });

  it('keeps a mailto subject out of the address field', () => {
    expect(parseHref('mailto:hallo@example.com?subject=Angebot%20anfordern')).toEqual({
      kind: 'email',
      value: 'hallo@example.com',
      subject: 'Angebot anfordern',
    });
  });

  it('treats a protocol-relative URL as external', () => {
    expect(parseHref('//cdn.example.com/app.js').kind).toBe('url');
  });

  it('separates a route from a file by its extension', () => {
    expect(parseHref('/about').kind).toBe('page');
    expect(parseHref('/blog/[slug]').kind).toBe('page');
    expect(parseHref('/preisliste.pdf').kind).toBe('file');
    expect(parseHref('/bilder/logo.svg').kind).toBe('file');
  });

  it('still calls a .html path a page', () => {
    // A static project's routes ARE .html files; classifying them as downloads
    // would put every page of such a site in the wrong picker.
    expect(parseHref('/impressum.html').kind).toBe('page');
  });

  it('does not read a leading dot as an extension', () => {
    expect(parseHref('/.well-known/security.txt').kind).toBe('file');
    expect(parseHref('/.well-known').kind).toBe('page');
  });

  it('starts an element with no href on the page picker', () => {
    expect(parseHref('')).toEqual({ kind: 'page', value: '' });
  });
});

describe('buildHref', () => {
  it('writes each kind in its own form', () => {
    expect(buildHref({ kind: 'email', value: 'hallo@example.com' })).toBe(
      'mailto:hallo@example.com'
    );
    expect(buildHref({ kind: 'email', value: 'hallo@example.com', subject: 'Angebot' })).toBe(
      'mailto:hallo@example.com?subject=Angebot'
    );
    // Spaces come out: they're legal in tel: but confuse enough dialers.
    expect(buildHref({ kind: 'phone', value: '+49 30 12 34 56' })).toBe('tel:+4930123456');
    expect(buildHref({ kind: 'anchor', value: '#kontakt' })).toBe('#kontakt');
    expect(buildHref({ kind: 'url', value: 'https://example.com' })).toBe('https://example.com');
  });

  it('anchors a site-relative target at the site root', () => {
    // Without the slash the link resolves against the current page, so the same
    // href means different things depending on where it is clicked.
    expect(buildHref({ kind: 'page', value: 'about' })).toBe('/about');
    expect(buildHref({ kind: 'file', value: 'preisliste.pdf' })).toBe('/preisliste.pdf');
    expect(buildHref({ kind: 'page', value: '/about' })).toBe('/about');
  });

  it('returns nothing for an empty value', () => {
    // The caller turns this into "remove the attribute" — an href="" would
    // reload the current page, which is never what clearing a field meant.
    expect(buildHref({ kind: 'page', value: '   ' })).toBe('');
    expect(buildHref({ kind: 'email', value: '' })).toBe('');
  });

  it('round-trips what it parsed', () => {
    for (const href of [
      '/about',
      '/preisliste.pdf',
      'https://example.com/x',
      'mailto:hallo@example.com',
      'tel:+493012345',
      '#kontakt',
    ]) {
      expect(buildHref(parseHref(href))).toBe(href);
    }
  });
});

describe('isDynamicHref', () => {
  it('recognises an href that holds code', () => {
    expect(isDynamicHref('{post.url}')).toBe(true);
    expect(isDynamicHref('`/blog/${slug}`')).toBe(true);
    expect(isDynamicHref('{{ item.href }}')).toBe(true);
  });

  it('leaves a literal URL alone', () => {
    expect(isDynamicHref('/about')).toBe(false);
    expect(isDynamicHref('https://example.com/?a=1&b=2')).toBe(false);
  });
});

describe('linkAttrName', () => {
  it('follows the attribute the element already carries', () => {
    expect(linkAttrName([{ name: 'href' }, { name: 'class' }])).toBe('href');
    // React Router's Link/NavLink; writing href here would sit dead beside it.
    expect(linkAttrName([{ name: 'to' }, { name: 'className' }])).toBe('to');
  });

  it('keeps the attribute spelled the way source spells it', () => {
    expect(linkAttrName([{ name: 'Href' }])).toBe('Href');
  });

  it('defaults to href for a link that has no target yet', () => {
    expect(linkAttrName([{ name: 'class' }])).toBe('href');
    expect(linkAttrName([])).toBe('href');
  });
});

describe('isPlainLinkTag', () => {
  it('separates HTML links from components that render one', () => {
    expect(isPlainLinkTag('a')).toBe(true);
    expect(isPlainLinkTag('area')).toBe(true);
    expect(isPlainLinkTag('Link')).toBe(false);
    expect(isPlainLinkTag('CallToAction')).toBe(false);
  });
});
