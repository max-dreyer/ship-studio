/**
 * Reading and writing `box-shadow` / `text-shadow` as structured layers.
 *
 * Turns a raw shadow value into the fields Webflow's shadow editor shows
 * (offset, blur, spread, colour, inset) and back again, so the panel can offer
 * real controls instead of one long text input.
 *
 * A value the parser can't make sense of is reported as unparsed rather than
 * guessed at — the editor then leaves it to the text field instead of
 * rewriting something it doesn't understand.
 *
 * @module lib/cssShadow
 */

import { looksLikeColor, splitTopLevel } from './cssValue';

export interface ShadowLayer {
  offsetX: string;
  offsetY: string;
  blur: string;
  /** Always empty for text-shadow, which has no spread. */
  spread: string;
  color: string;
  inset: boolean;
}

export const EMPTY_SHADOW: ShadowLayer = {
  offsetX: '0',
  offsetY: '2px',
  blur: '4px',
  spread: '',
  color: 'rgba(0, 0, 0, 0.2)',
  inset: false,
};

/** `none` and the empty string both mean "no layers". */
function isNone(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || v === 'none';
}

/**
 * Parse one layer. Returns null when the part doesn't hold at least the two
 * required offsets — CSS demands them, so anything less is not a shadow we can
 * safely edit.
 */
export function parseShadowLayer(part: string): ShadowLayer | null {
  const tokens = splitTopLevel(part, 'space');
  if (tokens.length === 0) return null;

  let inset = false;
  let color = '';
  const lengths: string[] = [];

  for (const token of tokens) {
    if (token.toLowerCase() === 'inset') {
      inset = true;
    } else if (looksLikeColor(token)) {
      // Two colours in one layer is not a shadow we understand.
      if (color) return null;
      color = token;
    } else {
      lengths.push(token);
    }
  }

  if (lengths.length < 2 || lengths.length > 4) return null;
  const [offsetX, offsetY, blur = '', spread = ''] = lengths;
  return { offsetX, offsetY, blur, spread, color, inset };
}

/** Parse a full value into layers, or null if any layer is unrecognisable. */
export function parseShadow(value: string): ShadowLayer[] | null {
  if (isNone(value)) return [];
  const layers: ShadowLayer[] = [];
  for (const part of splitTopLevel(value, 'comma')) {
    const layer = parseShadowLayer(part);
    if (!layer) return null;
    layers.push(layer);
  }
  return layers;
}

/** Serialise one layer in the canonical CSS order. */
export function formatShadowLayer(layer: ShadowLayer): string {
  const parts: string[] = [];
  if (layer.inset) parts.push('inset');
  parts.push(layer.offsetX.trim() || '0', layer.offsetY.trim() || '0');
  // Spread without blur is invalid, so a set spread forces a blur of 0.
  const blur = layer.blur.trim();
  const spread = layer.spread.trim();
  if (blur || spread) parts.push(blur || '0');
  if (spread) parts.push(spread);
  const color = layer.color.trim();
  if (color) parts.push(color);
  return parts.join(' ');
}

/** Serialise all layers. No layers means `none`, which clears the property. */
export function formatShadow(layers: ShadowLayer[]): string {
  if (layers.length === 0) return 'none';
  return layers.map(formatShadowLayer).join(', ');
}
