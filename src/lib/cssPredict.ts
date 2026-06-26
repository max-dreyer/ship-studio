/**
 * Heuristic "what comes next" prediction for a CSS rule — the instant (no-API) layer of
 * the predictive autofill (Cursor-Tab-style). Given a rule's current declarations, guess
 * the single most likely next declaration from common co-occurrence patterns (flex/grid
 * companions, positioning insets, transition defaults). The Claude-powered layer can
 * later override/extend this with design-token-aware, element-aware suggestions.
 *
 * Pure + side-effect free so it's unit-testable. Returns `null` when there's nothing
 * confident to suggest — better silent than noisy.
 */

export interface PredictedDecl {
  prop: string;
  value: string;
  /** Why it's suggested — shown as a faint hint next to the ghost. */
  hint?: string;
}

/** One co-occurrence rule: when `needs` props are all present and `absent` are all
 *  missing (and any `valueOf` predicate holds), suggest `prop: value`. */
interface Pattern {
  needs: string[];
  absent: string[];
  /** Optional guard on a present property's value (e.g. display is flex/grid). */
  guard?: (get: (p: string) => string | undefined) => boolean;
  suggest: PredictedDecl;
}

const FLEXGRID = (get: (p: string) => string | undefined) => {
  const d = (get('display') ?? '').toLowerCase();
  return d.includes('flex') || d.includes('grid');
};

// Ordered by how reliably the suggestion is what the user wants next. The first
// applicable pattern wins, so put the strongest signals first.
const PATTERNS: Pattern[] = [
  // Flex/grid: the layout companions, in the order people usually reach for them.
  {
    needs: ['display'],
    absent: ['align-items'],
    guard: FLEXGRID,
    suggest: { prop: 'align-items', value: 'center', hint: 'center cross-axis' },
  },
  {
    needs: ['display'],
    absent: ['justify-content'],
    guard: FLEXGRID,
    suggest: { prop: 'justify-content', value: 'center', hint: 'center main-axis' },
  },
  {
    needs: ['display'],
    absent: ['gap'],
    guard: FLEXGRID,
    suggest: { prop: 'gap', value: '1rem', hint: 'space between items' },
  },
  // Positioning: an offset almost always follows.
  {
    needs: ['position'],
    absent: ['inset', 'top', 'right', 'bottom', 'left'],
    guard: (get) =>
      ['absolute', 'fixed', 'sticky'].includes((get('position') ?? '').toLowerCase().trim()),
    suggest: { prop: 'inset', value: '0', hint: 'pin to edges' },
  },
  // A transition usually wants a duration+easing if it's just a property name.
  {
    needs: ['transition-property'],
    absent: ['transition-duration'],
    suggest: { prop: 'transition-duration', value: '0.2s' },
  },
  // Common pairings.
  {
    needs: ['overflow'],
    absent: ['border-radius'],
    guard: (get) => (get('overflow') ?? '').includes('hidden'),
    suggest: { prop: 'border-radius', value: '8px' },
  },
  {
    needs: ['background-image'],
    absent: ['background-size'],
    suggest: { prop: 'background-size', value: 'cover' },
  },
  {
    needs: ['cursor'],
    absent: ['user-select'],
    guard: (get) => (get('cursor') ?? '').trim() === 'pointer',
    suggest: { prop: 'user-select', value: 'none' },
  },
];

/**
 * Predict the single most likely next declaration for a rule, or `null`. `decls` is the
 * rule's current declarations (property + value). A property already present (or one the
 * caller passes in `exclude`, e.g. just-dismissed) is never suggested.
 */
export function predictNextDeclaration(
  decls: { prop: string; value: string }[],
  exclude: ReadonlySet<string> = new Set()
): PredictedDecl | null {
  if (decls.length === 0) return null;
  const byProp = new Map(decls.map((d) => [d.prop.trim().toLowerCase(), d.value]));
  const get = (p: string) => byProp.get(p.toLowerCase());
  const has = (p: string) => byProp.has(p.toLowerCase());

  for (const pat of PATTERNS) {
    if (!pat.needs.every(has)) continue;
    if (!pat.absent.every((p) => !has(p))) continue;
    if (pat.guard && !pat.guard(get)) continue;
    const sugg = pat.suggest;
    if (exclude.has(sugg.prop.toLowerCase())) continue;
    return sugg;
  }
  return null;
}
