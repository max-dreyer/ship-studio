import { describe, expect, it } from 'vitest';
import {
  rulesToLocate,
  mergeCascade,
  formatRuleCss,
  rowKey,
  type MatchedRule,
  type RuleLocation,
} from './cssCascade';

function rule(partial: Partial<MatchedRule>): MatchedRule {
  return {
    selector: '.btn',
    declarations: [{ prop: 'color', value: 'red', important: false, active: true }],
    specificity: [0, 1, 0],
    sourceOrder: 1,
    mediaText: null,
    mediaMinPx: null,
    inactiveMedia: false,
    layer: null,
    href: null,
    origin: 'author',
    ...partial,
  };
}

describe('rulesToLocate', () => {
  it('keeps author rules with a selector and preserves their original index', () => {
    const matched = [
      rule({ selector: '.a' }),
      rule({ origin: 'inline', selector: null }),
      rule({ selector: '.b', mediaText: '(max-width: 768px)', href: 'http://x/s.css' }),
    ];
    const out = rulesToLocate(matched);
    expect(out).toEqual([
      { index: 0, query: { selector: '.a', mediaText: null, href: null } },
      {
        index: 2,
        query: { selector: '.b', mediaText: '(max-width: 768px)', href: 'http://x/s.css' },
      },
    ]);
  });
});

describe('mergeCascade', () => {
  it('marks a resolved author rule editable with its source body', () => {
    const matched = [rule({ selector: '.btn' })];
    const loc: RuleLocation = {
      status: 'resolved',
      file: 'a.css',
      line: 4,
      inner_text: '\n  color: red;\n',
    };
    const [row] = mergeCascade(matched, new Map([[0, loc]]));
    expect(row.editable).toBe(true);
    expect(row.file).toBe('a.css');
    expect(row.line).toBe(4);
    expect(row.innerText).toBe('\n  color: red;\n');
  });

  it('leaves inline, not_found, and multiple rules read-only with a reason', () => {
    const matched = [
      rule({ origin: 'inline', selector: null }),
      rule({ selector: '.ghost' }),
      rule({ selector: '.dup' }),
    ];
    const rows = mergeCascade(
      matched,
      new Map<number, RuleLocation>([
        [1, { status: 'not_found' }],
        [2, { status: 'multiple', files: ['a.css', 'b.css'] }],
      ])
    );
    expect(rows[0].editable).toBe(false);
    expect(rows[0].readonlyReason).toMatch(/inline/);
    expect(rows[1].editable).toBe(false);
    expect(rows[1].readonlyReason).toMatch(/stylesheet/);
    expect(rows[2].editable).toBe(false);
    expect(rows[2].readonlyReason).toMatch(/multiple/);
  });

  it('treats a missing location entry as read-only (locate failed)', () => {
    const [row] = mergeCascade([rule({ selector: '.x' })], new Map());
    expect(row.editable).toBe(false);
  });
});

describe('formatRuleCss', () => {
  it('emits a bare rule (media context comes from the group it is replaced into)', () => {
    expect(formatRuleCss('.btn', ' color: red; ')).toBe('.btn { color: red; }');
    expect(formatRuleCss('.btn', '\n  &:hover { color: blue; }\n')).toBe(
      '.btn {\n  &:hover { color: blue; }\n}'
    );
  });
});

describe('rowKey', () => {
  it('is stable for a row and distinguishes rows that differ only by index', () => {
    const a = mergeCascade(
      [rule({ selector: '.btn' })],
      new Map([[0, { status: 'resolved', file: 'a.css', line: 1, inner_text: '' }]])
    )[0];
    expect(rowKey(a)).toBe(rowKey({ ...a }));
    expect(rowKey(a)).not.toBe(rowKey({ ...a, index: 1 }));
  });
});
