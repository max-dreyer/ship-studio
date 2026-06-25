import { describe, expect, it } from 'vitest';
import { NEST_ITEMS, WRAP_ITEMS, searchStructures, classifyFreeText } from './cssStructures';

describe('searchStructures', () => {
  it('returns the full group (capped) for an empty query', () => {
    expect(searchStructures(NEST_ITEMS, '').length).toBeGreaterThan(0);
    expect(searchStructures(NEST_ITEMS, '', 3)).toHaveLength(3);
  });

  it('matches on label', () => {
    const r = searchStructures(NEST_ITEMS, 'hover');
    expect(r.some((i) => i.insert === '&:hover')).toBe(true);
  });

  it('matches on hint and keywords, not just the label', () => {
    // "dark" only appears in the hint of the prefers-color-scheme item.
    expect(searchStructures(WRAP_ITEMS, 'dark').some((i) => i.insert.includes('dark'))).toBe(true);
    // "cq" is a keyword on container queries.
    expect(searchStructures(WRAP_ITEMS, 'cq').some((i) => i.insert.startsWith('@container'))).toBe(
      true
    );
    // "contains" is a keyword on :has().
    expect(searchStructures(NEST_ITEMS, 'contains').some((i) => i.insert.startsWith('&:has'))).toBe(
      true
    );
  });

  it('returns nothing for a non-matching query', () => {
    expect(searchStructures(NEST_ITEMS, 'zzzzz')).toHaveLength(0);
  });
});

describe('classifyFreeText', () => {
  it('treats @-rules as a condition (wrap)', () => {
    expect(classifyFreeText('@container (min-width: 600px)')).toEqual({
      label: '@container (min-width: 600px)',
      insert: '@container (min-width: 600px)',
      kind: 'wrap',
    });
  });

  it('keeps an &-relative selector as-is (nest)', () => {
    expect(classifyFreeText('&:focus-within')).toMatchObject({
      insert: '&:focus-within',
      kind: 'nest',
    });
  });

  it('prefixes a bare pseudo with & (covers ::before too)', () => {
    expect(classifyFreeText(':hover')).toMatchObject({ insert: '&:hover', kind: 'nest' });
    expect(classifyFreeText('::after')).toMatchObject({ insert: '&::after', kind: 'nest' });
  });

  it('prefixes a bare descendant/tag/id with "& "', () => {
    expect(classifyFreeText('.icon')).toMatchObject({ insert: '& .icon', kind: 'nest' });
    expect(classifyFreeText('> li')).toMatchObject({ insert: '& > li', kind: 'nest' });
    expect(classifyFreeText('span')).toMatchObject({ insert: '& span', kind: 'nest' });
  });

  it('returns null for empty input', () => {
    expect(classifyFreeText('   ')).toBeNull();
  });
});
