import { describe, expect, it } from 'vitest';
import {
  parseRuleBody,
  serializeRuleBody,
  declarations,
  nestedRules,
  overriddenProps,
  addDeclaration,
  addNestedRule,
  removeItem,
  moveDeclIntoNested,
} from './cssBody';

describe('parseRuleBody', () => {
  it('parses declarations with values, !important, and var()/colons in values', () => {
    const body = parseRuleBody(
      '\n  font-family: var(--font-display);\n  color: red !important;\n  --x: a:b;\n'
    );
    expect(declarations(body).map((d) => [d.prop, d.value, d.important])).toEqual([
      ['font-family', 'var(--font-display)', false],
      ['color', 'red', true],
      ['--x', 'a:b', false],
    ]);
  });

  it('parses a nested rule and recurses into its body', () => {
    const body = parseRuleBody('\n  color: red;\n  &:hover { color: blue; }\n');
    expect(declarations(body).map((d) => d.prop)).toEqual(['color']);
    const nested = nestedRules(body);
    expect(nested).toHaveLength(1);
    expect(nested[0].selector).toBe('&:hover');
    expect(declarations(nested[0].body).map((d) => [d.prop, d.value])).toEqual([['color', 'blue']]);
  });

  it('ignores comments and tolerates a missing trailing semicolon', () => {
    const body = parseRuleBody('\n  /* note */ gap: 1rem;\n  padding: 0 8px\n');
    expect(declarations(body).map((d) => [d.prop, d.value])).toEqual([
      ['gap', '1rem'],
      ['padding', '0 8px'],
    ]);
  });

  it('keeps semicolons inside strings out of the split', () => {
    const body = parseRuleBody("\n  content: 'a; b';\n  color: red;\n");
    expect(declarations(body).map((d) => [d.prop, d.value])).toEqual([
      ['content', "'a; b'"],
      ['color', 'red'],
    ]);
  });
});

describe('serializeRuleBody round-trips', () => {
  const cases = [
    '\n  color: red;\n',
    '\n  font-family: var(--x);\n  color: red !important;\n',
    '\n  color: red;\n  &:hover {\n    color: blue;\n  }\n',
    '\n  & .icon {\n    width: 16px;\n    &:hover {\n      opacity: 1;\n    }\n  }\n',
  ];
  for (const css of cases) {
    it(`is stable for: ${JSON.stringify(css)}`, () => {
      const once = serializeRuleBody(parseRuleBody(css));
      const twice = serializeRuleBody(parseRuleBody(once));
      expect(twice).toBe(once); // canonical form is a fixed point
    });
  }

  it('produces a spliceable, valid rule body', () => {
    const body = parseRuleBody('\n  color: red;\n  &:hover { color: blue; }\n');
    const out = `.btn {${serializeRuleBody(body)}}`;
    expect(out).toBe('.btn {\n  color: red;\n  &:hover {\n    color: blue;\n  }\n}');
  });
});

describe('mutations', () => {
  it('adds a declaration after the last declaration, before nested rules', () => {
    const body = parseRuleBody('\n  color: red;\n  &:hover { x: y; }\n');
    const next = addDeclaration(body, { prop: 'gap', value: '1rem', important: false });
    expect(next.items.map((it) => (it.kind === 'decl' ? it.prop : `&${it.selector}`))).toEqual([
      'color',
      'gap',
      '&&:hover',
    ]);
  });

  it('adds a nested rule and removes an item by index', () => {
    let body = parseRuleBody('\n  color: red;\n');
    body = addNestedRule(body, '&:focus');
    expect(nestedRules(body).map((r) => r.selector)).toEqual(['&:focus']);
    body = removeItem(body, 0); // drop the `color` decl
    expect(declarations(body)).toHaveLength(0);
    expect(nestedRules(body)).toHaveLength(1);
  });

  it('moves an existing declaration into a new nested rule', () => {
    const body = parseRuleBody('\n  color: red;\n  font-size: 16px;\n');
    const next = moveDeclIntoNested(body, 1, '&:hover'); // nest font-size
    expect(declarations(next).map((d) => d.prop)).toEqual(['color']);
    const nested = nestedRules(next);
    expect(nested.map((r) => r.selector)).toEqual(['&:hover']);
    expect(declarations(nested[0].body).map((d) => [d.prop, d.value])).toEqual([
      ['font-size', '16px'],
    ]);
  });

  it('appends into an existing nested rule with the same selector', () => {
    const body = parseRuleBody('\n  color: red;\n  &:hover { opacity: 1; }\n');
    const next = moveDeclIntoNested(body, 0, '&:hover'); // nest color into existing &:hover
    expect(declarations(next)).toHaveLength(0);
    const nested = nestedRules(next);
    expect(nested).toHaveLength(1);
    expect(declarations(nested[0].body).map((d) => d.prop)).toEqual(['opacity', 'color']);
  });
});

describe('overriddenProps', () => {
  it('maps overridden declaration names (lowercased) to the winning selector', () => {
    const map = overriddenProps({
      declarations: [
        {
          prop: 'Background',
          value: 'gray',
          important: false,
          active: false,
          overriddenBy: '.btn--primary',
        },
        { prop: 'color', value: 'red', important: false, active: true },
      ],
    });
    expect(map.has('background')).toBe(true);
    expect(map.get('background')).toBe('.btn--primary');
    expect(map.has('color')).toBe(false);
  });
});
