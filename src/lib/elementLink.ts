/**
 * What an element's `href` means, and how to write one back.
 *
 * The Link section of the Settings tab edits one string, but a person thinks in
 * kinds: a page on this site, an external address, a file, an email, a phone
 * number, a spot further down the page. This module is the translation between
 * the two, kept pure so the rules are testable without a preview or a project.
 *
 * Two rules shape the parsing. A scheme always wins (`mailto:`, `tel:`, `#`,
 * `https://`) because it says outright what the link is. Everything else is a
 * site-relative path, and the only thing separating a page from a file is a
 * file extension on the last segment — `/about` is a page, `/press-kit.pdf` is
 * a file. It's a heuristic, and it's why the kind stays switchable by hand: a
 * guess the user can correct in one click is fine, one they can't is not.
 *
 * @module lib/elementLink
 */

/** The kinds of target the Link section offers. */
export type LinkKind = 'page' | 'url' | 'file' | 'email' | 'phone' | 'anchor';

export interface LinkValue {
  kind: LinkKind;
  /**
   * The part the user edits: a route, a full URL, a file path, an address, a
   * phone number, or an element id (without the `#`).
   */
  value: string;
  /** `mailto:` subject, held apart so the address stays its own field. */
  subject?: string;
}

/** An empty link — what an `<a>` with no `href` starts from. */
export const EMPTY_LINK: LinkValue = { kind: 'page', value: '' };

/**
 * True when the attribute holds code rather than a literal URL — a JSX
 * expression (`href={route}`), a template literal, or a framework binding
 * (`:href`, `{{ url }}`).
 *
 * The Link section refuses to edit these. Writing a URL over `{post.slug}`
 * would compile and silently break every link the expression produced, and no
 * amount of undo tells the user that's what happened.
 */
export function isDynamicHref(href: string): boolean {
  return /[{}`]|\$\{/.test(href);
}

function parseMailto(rest: string): LinkValue {
  const [address, query = ''] = rest.split('?');
  const subject = new URLSearchParams(query).get('subject') ?? '';
  return { kind: 'email', value: address, ...(subject ? { subject } : {}) };
}

/** Extensions that still name a page. A static project's routes ARE `.html`
 *  files, and calling those downloads would put every one of them in the wrong
 *  picker. */
const PAGE_EXTENSIONS = ['html', 'htm', 'php', 'aspx', 'jsp'];

/** Whether a site-relative path points at a file rather than a route. */
function looksLikeFile(path: string): boolean {
  const lastSegment = path.split(/[?#]/)[0].split('/').pop() ?? '';
  // A dot anywhere but the start of the segment: `/logo.svg` yes, `/.well-known` no.
  const match = /.\.([a-zA-Z0-9]{1,8})$/.exec(lastSegment);
  if (!match) return false;
  return !PAGE_EXTENSIONS.includes(match[1].toLowerCase());
}

/** Read an `href` back into the kind + value the Link section edits. */
export function parseHref(href: string): LinkValue {
  const raw = href.trim();
  if (!raw) return EMPTY_LINK;

  const lower = raw.toLowerCase();
  if (lower.startsWith('mailto:')) return parseMailto(raw.slice('mailto:'.length));
  if (lower.startsWith('tel:')) return { kind: 'phone', value: raw.slice('tel:'.length) };
  if (raw.startsWith('#')) return { kind: 'anchor', value: raw.slice(1) };
  // `//cdn.example.com/x` is protocol-relative and just as external as https.
  if (raw.startsWith('//') || /^[a-zA-Z][\w+.-]*:/.test(raw)) return { kind: 'url', value: raw };

  return { kind: looksLikeFile(raw) ? 'file' : 'page', value: raw };
}

/** Site-relative targets are written from the site root, not the current page. */
function withLeadingSlash(value: string): string {
  return value.startsWith('/') ? value : `/${value}`;
}

/**
 * Write a link back to an `href`.
 *
 * An empty value returns an empty string, which the caller turns into "remove
 * the attribute" — an `href=""` reloads the current page, which is never what
 * clearing a field meant.
 */
export function buildHref(link: LinkValue): string {
  const value = link.value.trim();
  if (!value) return '';

  switch (link.kind) {
    case 'email': {
      const subject = link.subject?.trim();
      const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
      return `mailto:${value}${query}`;
    }
    case 'phone':
      // Spaces are legal in `tel:` but confuse enough dialers to be worth losing.
      return `tel:${value.replace(/\s+/g, '')}`;
    case 'anchor':
      return `#${value.replace(/^#+/, '')}`;
    case 'url':
      return value;
    case 'page':
    case 'file':
      return withLeadingSlash(value);
  }
}

/**
 * The attribute a link's target lives in, given the element's source
 * attributes.
 *
 * `href` for plain `<a>`, Next.js `<Link>`, Astro and Nuxt; `to` for React
 * Router's `<Link>`/`<NavLink>`. Reading it from what the element actually
 * carries beats a component-name lookup: it needs no list of framework
 * components, and writing `href` onto a `<NavLink to>` would add a dead
 * attribute beside the live one.
 *
 * Falls back to `href` when the element has neither — the right answer for an
 * `<a>` that has no target yet, and the only sane default.
 */
export function linkAttrName(attributes: { name: string }[]): string {
  const found = attributes.find((a) => ['href', 'to'].includes(a.name.toLowerCase()));
  return found ? found.name : 'href';
}

/**
 * Whether this SOURCE tag is a plain link element (as opposed to a component
 * that happens to render one).
 *
 * A lowercase tag is HTML; anything capitalized is a component, and only the
 * component knows whether it forwards an `href` at all.
 */
export function isPlainLinkTag(sourceTag: string): boolean {
  return ['a', 'area'].includes(sourceTag);
}

/** Label and input hints per kind, so the section's copy lives beside its rules. */
export const LINK_KINDS: { id: LinkKind; label: string; placeholder: string }[] = [
  { id: 'page', label: 'Page', placeholder: '/about' },
  { id: 'url', label: 'URL', placeholder: 'https://example.com' },
  { id: 'file', label: 'File', placeholder: '/press-kit.pdf' },
  { id: 'email', label: 'Email', placeholder: 'hallo@example.com' },
  { id: 'phone', label: 'Phone', placeholder: '+49 30 123456' },
  { id: 'anchor', label: 'Section', placeholder: 'contact' },
];
