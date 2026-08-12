/**
 * Structured editor for `box-shadow` and `text-shadow`.
 *
 * Replaces the raw text field with Webflow-style layer cards: offset, blur,
 * spread and colour as real fields, inset as a toggle, layers addable and
 * removable. The numeric fields are `CssLengthField`, so they scrub and
 * arrow-key like every other length in the panel.
 *
 * When the current value can't be parsed (a `var()`, an unusual layer), the
 * editor steps aside and shows a plain text field instead of rewriting
 * something it doesn't understand. That's the whole point of `parseShadow`
 * returning null rather than a best guess.
 *
 * @module components/edit/CssShadowEditor
 */

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutsidePointer } from '../../hooks/useDismissOnOutsidePointer';
import { ColorPicker } from './ColorPicker';
import { CssLengthField } from './CssLengthField';
import { EMPTY_SHADOW, formatShadow, parseShadow, type ShadowLayer } from '../../lib/cssShadow';

interface Props {
  prop: string;
  value: string;
  onPreview: (property: string, value: string | null) => void;
  onSave: (property: string, value: string | null) => void;
  isValid: (value: string) => boolean;
}

/** Swatch + popover colour picker, scoped to one shadow layer. */
function LayerColor({
  color,
  onChange,
  onCommit,
}: {
  color: string;
  onChange: (css: string) => void;
  onCommit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onCommit();
  }, [onCommit]);

  useDismissOnOutsidePointer(open, popRef, close, {
    isOutside: (t) => !triggerRef.current?.contains(t) && !popRef.current?.contains(t),
  });

  /** Placed on open rather than in an effect — the trigger's box is already
   *  laid out by then, and it keeps state out of the render cycle. */
  const toggle = () => {
    if (open) {
      close();
      return;
    }
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const W = 216;
    const H = 250;
    const M = 8;
    setPos({
      top: Math.min(Math.max(M, r.top), window.innerHeight - H - M),
      left: Math.min(Math.max(M, r.left - W - M), window.innerWidth - W - M),
    });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="ss-shadow__swatch"
        style={{ background: color || 'transparent' }}
        onClick={toggle}
        aria-label="Shadow colour"
        title={color || 'No colour'}
      />
      {open &&
        pos &&
        createPortal(
          <div ref={popRef} className="ss-color-popover" style={{ top: pos.top, left: pos.left }}>
            <ColorPicker value={color || '#000000'} onChange={onChange} />
          </div>,
          document.body
        )}
    </>
  );
}

export function CssShadowEditor({ prop, value, onPreview, onSave, isValid }: Props) {
  const layers = parseShadow(value);
  // Text-shadow has no spread; offering the field would produce invalid CSS.
  const hasSpread = prop === 'box-shadow';

  const write = (next: ShadowLayer[], commit: boolean) => {
    const css = formatShadow(next);
    // `none` is how we clear, but the panel's remove path wants null.
    const out = next.length === 0 ? null : css;
    onPreview(prop, out);
    if (commit) onSave(prop, out);
  };

  if (layers === null) {
    return (
      <div className="ss-shadow">
        <p className="ss-shadow__note">
          This value can&apos;t be broken into layers, so it stays as text.
        </p>
        <input
          className="ss-cc-input"
          defaultValue={value}
          spellCheck={false}
          aria-label={prop}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next === value.trim()) return;
            if (next !== '' && !isValid(next)) return;
            onSave(prop, next === '' ? null : next);
          }}
        />
      </div>
    );
  }

  const update = (index: number, patch: Partial<ShadowLayer>, commit: boolean) => {
    write(
      layers.map((l, i) => (i === index ? { ...l, ...patch } : l)),
      commit
    );
  };

  return (
    <div className="ss-shadow">
      {layers.map((layer, i) => (
        <div className="ss-shadow__layer" key={i}>
          <div className="ss-shadow__row">
            <LayerColor
              color={layer.color}
              onChange={(css) => update(i, { color: css }, false)}
              onCommit={() => write(layers, true)}
            />
            <button
              type="button"
              className={`ss-shadow__inset${layer.inset ? ' is-active' : ''}`}
              onClick={() => update(i, { inset: !layer.inset }, true)}
              aria-pressed={layer.inset}
              title="Inset shadow"
            >
              Inset
            </button>
            <button
              type="button"
              className="ss-shadow__remove"
              onClick={() =>
                write(
                  layers.filter((_, j) => j !== i),
                  true
                )
              }
              aria-label={`Remove shadow ${i + 1}`}
              title="Remove"
            >
              ×
            </button>
          </div>
          <div className="ss-shadow__grid">
            {(
              [
                ['offsetX', 'X'],
                ['offsetY', 'Y'],
                ['blur', 'Blur'],
                ...(hasSpread ? [['spread', 'Spread'] as const] : []),
              ] as [keyof ShadowLayer, string][]
            ).map(([key, label]) => (
              <label className="ss-shadow__field" key={key}>
                <span className="ss-shadow__label">{label}</span>
                <CssLengthField
                  // The property name only drives step size; every shadow
                  // field steps like a plain pixel length.
                  prop="shadow-length"
                  value={String(layer[key] ?? '')}
                  placeholder="0"
                  onPreview={(_p, v) => update(i, { [key]: v ?? '' }, false)}
                  onSave={(_p, v) => update(i, { [key]: v ?? '' }, true)}
                  // Validate the field on its own, not the assembled shadow:
                  // a half-typed layer would otherwise fail as a whole.
                  isValid={(v) => isValid(`0 0 ${v}`)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="ss-shadow__add"
        onClick={() => write([...layers, EMPTY_SHADOW], true)}
      >
        + Add shadow
      </button>
    </div>
  );
}
