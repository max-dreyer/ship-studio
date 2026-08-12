/**
 * Numeric handling for CSS length fields — parsing, stepping, and formatting.
 *
 * Backs the Webflow-style interactions on the CSS editor's length inputs: drag
 * to scrub a value, arrow-key to nudge it, switch its unit from a menu. Kept
 * separate from the component so the arithmetic (and its rounding, which
 * floats love to ruin) is testable without a DOM.
 *
 * A field's text is one of three things:
 *   - numeric   `16px`, `1.5rem`, `50%`, `0`, `1.5` (unitless line-height)
 *   - keyword   `auto`, `none`, `inherit` — steppable only by replacing it
 *   - opaque    `calc(100% - 2rem)`, `var(--x)`, `0 0 4px red` — never stepped
 *
 * Only the numeric case can be scrubbed; the others are handed back untouched
 * so a drag can never mangle a hand-written expression.
 *
 * @module lib/cssLength
 */

/** Units offered in the unit menu, in the order Webflow lists them. */
export const CSS_UNITS = ['px', '%', 'rem', 'em', 'vh', 'vw'] as const;
export type CssUnit = (typeof CSS_UNITS)[number];

export interface ParsedLength {
  num: number;
  /** Empty string for a unitless number (line-height: 1.5, z-index: 3). */
  unit: string;
}

/** Matches a lone number with an optional unit, and nothing else. */
const NUMERIC = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i;

/** Per-property stepping. Anything unlisted uses the numeric default. */
interface StepRule {
  step: number;
  /** Nudge while Shift is held. */
  bigStep: number;
  /** Unit assumed when stepping an empty field. */
  unit: string;
  min?: number;
  max?: number;
  /** Decimal places to round to, so 0.1 + 0.2 doesn't leak into the source. */
  precision: number;
}

const DEFAULT_RULE: StepRule = { step: 1, bigStep: 10, unit: 'px', precision: 2 };

const RULES: Record<string, StepRule> = {
  opacity: { step: 0.05, bigStep: 0.1, unit: '', min: 0, max: 1, precision: 2 },
  'line-height': { step: 0.1, bigStep: 0.5, unit: '', precision: 2 },
  'z-index': { step: 1, bigStep: 10, unit: '', precision: 0 },
  'flex-grow': { step: 1, bigStep: 5, unit: '', min: 0, precision: 0 },
  'flex-shrink': { step: 1, bigStep: 5, unit: '', min: 0, precision: 0 },
  order: { step: 1, bigStep: 5, unit: '', precision: 0 },
  'font-weight': { step: 100, bigStep: 100, unit: '', min: 100, max: 900, precision: 0 },
  'letter-spacing': { step: 0.1, bigStep: 1, unit: 'px', precision: 2 },
  // Synthetic properties used by the structured editors, whose fields aren't
  // CSS properties in their own right (see CssShadowEditor and friends).
  'transition-duration': { step: 0.05, bigStep: 0.25, unit: 's', min: 0, precision: 2 },
  'transition-delay': { step: 0.05, bigStep: 0.25, unit: 's', min: 0, precision: 2 },
  'transform-scale': { step: 0.1, bigStep: 0.5, unit: '', precision: 2 },
  'transform-angle': { step: 1, bigStep: 15, unit: 'deg', precision: 2 },
  'transform-translate': { step: 1, bigStep: 10, unit: 'px', precision: 2 },
  'shadow-length': { step: 1, bigStep: 10, unit: 'px', precision: 2 },
};

export function stepRuleFor(prop: string): StepRule {
  return RULES[prop] ?? DEFAULT_RULE;
}

/** Parse a field's text, or null when it isn't a plain number. */
export function parseLength(raw: string): ParsedLength | null {
  const m = NUMERIC.exec(raw.trim());
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;
  return { num, unit: m[2] ?? '' };
}

/** Whether dragging or arrow keys may touch this value. */
export function isScrubbable(raw: string): boolean {
  return raw.trim() === '' || parseLength(raw) !== null;
}

/** Drop float noise, then trailing zeros: 16.00 → 16, 1.50 → 1.5. */
function round(num: number, precision: number): number {
  return Number(num.toFixed(precision));
}

export function formatLength({ num, unit }: ParsedLength, precision = 2): string {
  const n = round(num, precision);
  // A bare 0 needs no unit, and reads cleaner in the source.
  if (n === 0 && unit !== '%') return '0';
  return `${n}${unit}`;
}

/**
 * Step a value by `steps` increments. An empty field starts from zero in the
 * property's assumed unit; a non-numeric one is returned unchanged so
 * `calc()` and `var()` survive a stray arrow key.
 */
export function stepLength(raw: string, prop: string, steps: number, big = false): string {
  const rule = stepRuleFor(prop);
  const parsed = parseLength(raw) ?? (raw.trim() === '' ? { num: 0, unit: rule.unit } : null);
  if (!parsed) return raw;

  const delta = (big ? rule.bigStep : rule.step) * steps;
  let num = round(parsed.num + delta, rule.precision);
  if (rule.min !== undefined) num = Math.max(rule.min, num);
  if (rule.max !== undefined) num = Math.min(rule.max, num);

  return formatLength({ num, unit: parsed.unit }, rule.precision);
}

/**
 * Swap the unit, keeping the number. Switching to `''` makes it unitless.
 * A non-numeric value is returned unchanged.
 */
export function withUnit(raw: string, unit: string, prop: string): string {
  const rule = stepRuleFor(prop);
  const parsed = parseLength(raw) ?? (raw.trim() === '' ? { num: 0, unit: '' } : null);
  if (!parsed) return raw;
  // Bypass formatLength's zero-shortening: picking a unit should show it.
  return `${round(parsed.num, rule.precision)}${unit}`;
}

/**
 * Pixels of pointer travel per step while scrubbing. Coarse steps (font-weight
 * moves in hundreds) would fly past their range at 1px per step, so the bigger
 * the step, the more travel it takes.
 */
export function scrubSensitivity(prop: string): number {
  const { step } = stepRuleFor(prop);
  if (step >= 100) return 8;
  if (step >= 1) return 3;
  return 2;
}
