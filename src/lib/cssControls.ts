/**
 * Structured control schema for the CSS-Mode editor (Phase 4).
 *
 * Unlike the Tailwind editor — which maps controls onto utility tokens and a
 * cross-breakpoint cascade — CSS mode reads/writes a property straight off the
 * resolved rule's declarations. So a control is just `{ a CSS property, how to
 * render it }`, and the value is `declarations.find(d => d.property === prop)`.
 *
 * The "Custom" category is handled by the panel directly (the raw declaration
 * list), so any property is always editable even if no structured control
 * exists for it.
 */

import type { CssDeclaration } from './edit-css';

/** Read the current value of a CSS property from a rule's declarations. */
export function cssValueOf(declarations: CssDeclaration[], prop: string): string {
  const lc = prop.toLowerCase();
  return declarations.find((d) => d.property.toLowerCase() === lc)?.value ?? '';
}

/** Predicate over the current declarations (for conditional controls). */
export type ControlPredicate = (get: (prop: string) => string) => boolean;

interface BaseControl {
  prop: string;
  label: string;
  /** Only render when this returns true (e.g. flex controls when display:flex). */
  showIf?: ControlPredicate;
  /** Pair this control with the next flagged one on a single row (Webflow puts
   *  Min W beside Min H). Flag both halves; the pair breaks apart if one of
   *  them is hidden by `showIf`. */
  pair?: boolean;
}

export interface SegOption {
  value: string;
  /** Name of a glyph in `CssControlIcons` — how Webflow fits four options in
   *  one row. Takes precedence over `label`. */
  icon?: string;
  /** Short text shown on the segment (omit when using `glyph`). */
  label?: string;
  /** A compact glyph (e.g. an arrow) shown instead of a label. */
  glyph?: string;
  /** Accessible / hover title. */
  title?: string;
}

export type CssControl =
  | (BaseControl & { kind: 'segmented'; options: SegOption[] })
  | (BaseControl & { kind: 'select'; options: { value: string; label: string }[] })
  | (BaseControl & { kind: 'length'; placeholder?: string })
  /** Free text that is never numeric (font stacks, gradients) — same input as
   *  `length` but without the scrub handle and unit menu. */
  | (BaseControl & { kind: 'text'; placeholder?: string })
  /** Layered shadow editor for `box-shadow` / `text-shadow`. */
  | (BaseControl & { kind: 'shadow' })
  /** Structured editor for the `transition` shorthand. */
  | (BaseControl & { kind: 'transition' })
  /** Structured editor for the `transform` shorthand. */
  | (BaseControl & { kind: 'transform' })
  /** Per-edge / per-corner control. `prop` names the grouped property
   *  (`border-width`, `border-radius`, …). */
  | (BaseControl & { kind: 'edges' })
  /** Gradient editor for `background-image`. */
  | (BaseControl & { kind: 'gradient' })
  | (BaseControl & { kind: 'color' });

export interface CssCategory {
  id: string;
  label: string;
  /** Controls for the category; `custom` has none (the panel renders the list). */
  controls: CssControl[];
}

const isFlexish: ControlPredicate = (get) => {
  const d = get('display');
  return d.includes('flex') || d.includes('grid');
};
const isFlex: ControlPredicate = (get) => get('display').includes('flex');
const isPositioned: ControlPredicate = (get) => {
  const p = get('position');
  return p !== '' && p !== 'static';
};

export const CSS_CATEGORIES: CssCategory[] = [
  {
    id: 'layout',
    label: 'Layout',
    controls: [
      {
        kind: 'segmented',
        prop: 'display',
        label: 'Display',
        options: [
          { value: 'block', label: 'Block' },
          { value: 'flex', label: 'Flex' },
          { value: 'grid', label: 'Grid' },
          { value: 'inline-block', label: 'Inline' },
          { value: 'none', label: 'None' },
        ],
      },
      {
        kind: 'segmented',
        prop: 'flex-direction',
        label: 'Direction',
        showIf: isFlex,
        options: [
          { value: 'row', glyph: '→', title: 'Row' },
          { value: 'column', glyph: '↓', title: 'Column' },
          { value: 'row-reverse', glyph: '←', title: 'Row reverse' },
          { value: 'column-reverse', glyph: '↑', title: 'Column reverse' },
        ],
      },
      {
        kind: 'segmented',
        prop: 'align-items',
        label: 'Align items',
        showIf: isFlexish,
        options: [
          { value: 'flex-start', label: 'Start' },
          { value: 'center', label: 'Center' },
          { value: 'flex-end', label: 'End' },
          { value: 'stretch', label: 'Stretch' },
        ],
      },
      {
        kind: 'segmented',
        prop: 'justify-content',
        label: 'Justify',
        showIf: isFlexish,
        options: [
          { value: 'flex-start', label: 'Start' },
          { value: 'center', label: 'Center' },
          { value: 'flex-end', label: 'End' },
          { value: 'space-between', label: 'Between' },
        ],
      },
      {
        kind: 'segmented',
        prop: 'flex-wrap',
        label: 'Wrap',
        showIf: isFlex,
        options: [
          { value: 'nowrap', label: 'No wrap' },
          { value: 'wrap', label: 'Wrap' },
          { value: 'wrap-reverse', label: 'Reverse' },
        ],
      },
      { kind: 'length', prop: 'gap', label: 'Gap', placeholder: '0', showIf: isFlexish },
    ],
  },
  {
    // Flex/grid child properties. They act on the element's own box inside its
    // parent, so unlike the container controls above they can't be gated on
    // this element's own `display` — the parent's is what matters, and the
    // panel doesn't see it.
    id: 'child',
    label: 'Child',
    controls: [
      {
        kind: 'select',
        prop: 'align-self',
        label: 'Align self',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'flex-start', label: 'Start' },
          { value: 'center', label: 'Center' },
          { value: 'flex-end', label: 'End' },
          { value: 'stretch', label: 'Stretch' },
        ],
      },
      { kind: 'length', prop: 'flex-grow', label: 'Grow', placeholder: '0' },
      { kind: 'length', prop: 'flex-shrink', label: 'Shrink', placeholder: '1' },
      { kind: 'length', prop: 'flex-basis', label: 'Basis', placeholder: 'auto' },
      { kind: 'length', prop: 'order', label: 'Order', placeholder: '0' },
    ],
  },
  {
    id: 'spacing',
    label: 'Spacing',
    // Rendered by `CssSpacingBox`, not from this list — the box covers all
    // eight sides itself. Kept as the fallback if the box is ever bypassed.
    controls: [
      { kind: 'length', prop: 'padding', label: 'Padding', placeholder: '0' },
      { kind: 'length', prop: 'margin', label: 'Margin', placeholder: '0' },
    ],
  },
  {
    id: 'size',
    label: 'Size',
    controls: [
      // Paired the way Webflow pairs them: the two axes of one concept per row.
      { kind: 'length', prop: 'width', label: 'Width', placeholder: 'auto', pair: true },
      { kind: 'length', prop: 'height', label: 'Height', placeholder: 'auto', pair: true },
      { kind: 'length', prop: 'min-width', label: 'Min W', placeholder: 'auto', pair: true },
      { kind: 'length', prop: 'min-height', label: 'Min H', placeholder: 'auto', pair: true },
      { kind: 'length', prop: 'max-width', label: 'Max W', placeholder: 'none', pair: true },
      { kind: 'length', prop: 'max-height', label: 'Max H', placeholder: 'none', pair: true },
      { kind: 'text', prop: 'aspect-ratio', label: 'Ratio', placeholder: 'auto' },
    ],
  },
  {
    id: 'position',
    label: 'Position',
    controls: [
      {
        kind: 'select',
        prop: 'position',
        label: 'Position',
        options: [
          { value: 'static', label: 'Static' },
          { value: 'relative', label: 'Relative' },
          { value: 'absolute', label: 'Absolute' },
          { value: 'fixed', label: 'Fixed' },
          { value: 'sticky', label: 'Sticky' },
        ],
      },
      { kind: 'length', prop: 'top', label: 'Top', placeholder: 'auto', showIf: isPositioned },
      { kind: 'length', prop: 'right', label: 'Right', placeholder: 'auto', showIf: isPositioned },
      {
        kind: 'length',
        prop: 'bottom',
        label: 'Bottom',
        placeholder: 'auto',
        showIf: isPositioned,
      },
      { kind: 'length', prop: 'left', label: 'Left', placeholder: 'auto', showIf: isPositioned },
      { kind: 'length', prop: 'z-index', label: 'Z-index', placeholder: 'auto' },
    ],
  },
  {
    id: 'typography',
    label: 'Type',
    controls: [
      { kind: 'text', prop: 'font-family', label: 'Font', placeholder: 'inherit' },
      {
        kind: 'select',
        prop: 'font-weight',
        label: 'Weight',
        options: [
          { value: '300', label: '300 - Light' },
          { value: '400', label: '400 - Normal' },
          { value: '500', label: '500 - Medium' },
          { value: '600', label: '600 - Semibold' },
          { value: '700', label: '700 - Bold' },
          { value: '800', label: '800 - Extrabold' },
        ],
      },
      // Size beside Height, as Webflow pairs them.
      { kind: 'length', prop: 'font-size', label: 'Size', placeholder: '16px', pair: true },
      { kind: 'length', prop: 'line-height', label: 'Height', placeholder: '1.5', pair: true },
      { kind: 'color', prop: 'color', label: 'Color' },
      {
        kind: 'segmented',
        prop: 'text-align',
        label: 'Align',
        options: [
          { value: 'left', icon: 'align-left', title: 'Left' },
          { value: 'center', icon: 'align-center', title: 'Center' },
          { value: 'right', icon: 'align-right', title: 'Right' },
          { value: 'justify', icon: 'align-justify', title: 'Justify' },
        ],
      },
      {
        kind: 'segmented',
        prop: 'text-decoration-line',
        label: 'Decor',
        options: [
          { value: 'none', icon: 'none', title: 'None' },
          { value: 'line-through', icon: 'strikethrough', title: 'Strikethrough' },
          { value: 'underline', icon: 'underline', title: 'Underline' },
          { value: 'overline', icon: 'overline', title: 'Overline' },
        ],
      },
      {
        kind: 'segmented',
        prop: 'font-style',
        label: 'Italicize',
        options: [
          { value: 'normal', icon: 'roman', title: 'Regular' },
          { value: 'italic', icon: 'italic', title: 'Italic' },
        ],
      },
      {
        kind: 'segmented',
        prop: 'text-transform',
        label: 'Capitalize',
        options: [
          { value: 'none', icon: 'none', title: 'None' },
          { value: 'uppercase', icon: 'uppercase', title: 'ALL CAPS' },
          { value: 'capitalize', icon: 'capitalize', title: 'Capitalize Every Word' },
          { value: 'lowercase', icon: 'lowercase', title: 'lowercase' },
        ],
      },
      { kind: 'length', prop: 'letter-spacing', label: 'Spacing', placeholder: 'normal' },
      { kind: 'shadow', prop: 'text-shadow', label: 'Text shadows' },
    ],
  },
  {
    id: 'background',
    label: 'Background',
    controls: [
      { kind: 'color', prop: 'background-color', label: 'Color' },
      { kind: 'gradient', prop: 'background-image', label: 'Image' },
      { kind: 'text', prop: 'background-size', label: 'Size', placeholder: 'auto' },
      { kind: 'text', prop: 'background-position', label: 'Position', placeholder: '0% 0%' },
      {
        kind: 'select',
        prop: 'background-repeat',
        label: 'Repeat',
        options: [
          { value: 'repeat', label: 'Repeat' },
          { value: 'no-repeat', label: 'No repeat' },
          { value: 'repeat-x', label: 'Repeat X' },
          { value: 'repeat-y', label: 'Repeat Y' },
        ],
      },
    ],
  },
  {
    id: 'border',
    label: 'Border',
    controls: [
      { kind: 'edges', prop: 'border-width', label: 'Width' },
      {
        kind: 'segmented',
        prop: 'border-style',
        label: 'Style',
        options: [
          { value: 'none', icon: 'none', title: 'None' },
          { value: 'solid', icon: 'solid', title: 'Solid' },
          { value: 'dashed', icon: 'dashed', title: 'Dashed' },
          { value: 'dotted', icon: 'dotted', title: 'Dotted' },
        ],
      },
      { kind: 'color', prop: 'border-color', label: 'Color' },
      { kind: 'edges', prop: 'border-radius', label: 'Radius' },
    ],
  },
  {
    id: 'transform',
    label: 'Transform',
    controls: [
      { kind: 'transform', prop: 'transform', label: 'Transform' },
      { kind: 'length', prop: 'transform-origin', label: 'Origin', placeholder: 'center' },
      { kind: 'transition', prop: 'transition', label: 'Transition' },
    ],
  },
  {
    id: 'effects',
    label: 'Effects',
    controls: [
      { kind: 'length', prop: 'opacity', label: 'Opacity', placeholder: '1' },
      { kind: 'shadow', prop: 'box-shadow', label: 'Box shadow' },
      { kind: 'length', prop: 'filter', label: 'Filter', placeholder: 'none' },
      {
        kind: 'select',
        prop: 'overflow',
        label: 'Overflow',
        options: [
          { value: 'visible', label: 'Visible' },
          { value: 'hidden', label: 'Hidden' },
          { value: 'auto', label: 'Auto' },
          { value: 'scroll', label: 'Scroll' },
        ],
      },
      {
        kind: 'select',
        prop: 'cursor',
        label: 'Cursor',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'default', label: 'Default' },
          { value: 'pointer', label: 'Pointer' },
          { value: 'text', label: 'Text' },
          { value: 'move', label: 'Move' },
          { value: 'not-allowed', label: 'Not allowed' },
        ],
      },
    ],
  },
  { id: 'custom', label: 'Custom', controls: [] },
];

/** The breakpoints the CSS editor targets (min-width). `null` = base (all
 *  sizes). An edit at a breakpoint writes into `@media (min-width: …)`. */
export const CSS_BREAKPOINTS: { label: string; minPx: number | null }[] = [
  { label: 'Base', minPx: null },
  { label: 'SM', minPx: 640 },
  { label: 'MD', minPx: 768 },
  { label: 'LG', minPx: 1024 },
  { label: 'XL', minPx: 1280 },
];

/** Map a CSS property to the category whose controls edit it — powers "add a
 *  property" jumping to the right section. Spacing shorthands/longhands map to
 *  the box-model editor's category. */
export const PROP_TO_CATEGORY: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const cat of CSS_CATEGORIES) {
    for (const c of cat.controls) map[c.prop] = cat.id;
  }
  for (const t of ['padding', 'margin']) {
    map[t] = 'spacing';
    for (const s of ['top', 'right', 'bottom', 'left']) map[`${t}-${s}`] = 'spacing';
  }
  return map;
})();
