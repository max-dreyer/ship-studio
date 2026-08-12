/**
 * Structured editor for a `background-image` gradient.
 *
 * Type, angle and a list of colour stops, with a live preview strip on top.
 * Values that aren't a single plain gradient (a URL, several layers, radial
 * positioning) keep the text field — see `parseGradient` for what's in scope.
 *
 * @module components/edit/CssGradientEditor
 */

import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutsidePointer } from '../../hooks/useDismissOnOutsidePointer';
import { ColorPicker } from './ColorPicker';
import { CssLengthField } from './CssLengthField';
import {
  EMPTY_GRADIENT,
  formatGradient,
  parseGradient,
  type Gradient,
  type GradientStop,
} from '../../lib/cssGradient';

interface Props {
  prop: string;
  value: string;
  onPreview: (property: string, value: string | null) => void;
  onSave: (property: string, value: string | null) => void;
  isValid: (value: string) => boolean;
}

function StopColor({
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
        aria-label="Stop colour"
        title={color}
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

export function CssGradientEditor({ prop, value, onPreview, onSave, isValid }: Props) {
  const gradient = parseGradient(value);

  if (gradient === null) {
    return (
      <div className="ss-shadow">
        <input
          className="ss-cc-input"
          defaultValue={value}
          placeholder="none"
          spellCheck={false}
          aria-label={prop}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next === value.trim()) return;
            if (next !== '' && !isValid(next)) return;
            onSave(prop, next === '' ? null : next);
          }}
        />
        <button
          type="button"
          className="ss-shadow__add"
          onClick={() => onSave(prop, formatGradient(EMPTY_GRADIENT))}
        >
          + Add gradient
        </button>
      </div>
    );
  }

  const write = (next: Gradient, commit: boolean) => {
    const css = formatGradient(next);
    onPreview(prop, css);
    if (commit) onSave(prop, css);
  };

  const updateStop = (index: number, patch: Partial<GradientStop>, commit: boolean) => {
    write(
      {
        ...gradient,
        stops: gradient.stops.map((s, i) => (i === index ? { ...s, ...patch } : s)),
      },
      commit
    );
  };

  return (
    <div className="ss-shadow">
      <div className="ss-gradient__preview" style={{ backgroundImage: formatGradient(gradient) }} />
      <div className="ss-shadow__row">
        <div className="ss-cc-seg" role="group" aria-label="Gradient type">
          {(['linear', 'radial'] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={`ss-cc-seg__btn${gradient.type === t ? ' is-active' : ''}`}
              aria-pressed={gradient.type === t}
              onClick={() => write({ ...gradient, type: t }, true)}
            >
              {t === 'linear' ? 'Linear' : 'Radial'}
            </button>
          ))}
        </div>
      </div>
      {gradient.type === 'linear' && (
        <label className="ss-shadow__field">
          <span className="ss-shadow__label">Angle</span>
          <CssLengthField
            prop="transform-angle"
            value={gradient.angle}
            placeholder="180deg"
            onPreview={(_p, v) => write({ ...gradient, angle: v ?? '' }, false)}
            onSave={(_p, v) => write({ ...gradient, angle: v ?? '' }, true)}
            isValid={(v) => isValid(`linear-gradient(${v}, red, blue)`)}
          />
        </label>
      )}
      {gradient.stops.map((stop, i) => (
        <div className="ss-shadow__row" key={i}>
          <StopColor
            color={stop.color}
            onChange={(css) => updateStop(i, { color: css }, false)}
            onCommit={() => write(gradient, true)}
          />
          <span className="ss-shadow__grow">
            <CssLengthField
              prop="gradient-stop"
              value={stop.position}
              placeholder="auto"
              onPreview={(_p, v) => updateStop(i, { position: v ?? '' }, false)}
              onSave={(_p, v) => updateStop(i, { position: v ?? '' }, true)}
              isValid={(v) => isValid(`linear-gradient(red ${v}, blue)`)}
            />
          </span>
          {/* CSS needs two stops; removing below that would break the value. */}
          {gradient.stops.length > 2 && (
            <button
              type="button"
              className="ss-shadow__remove"
              onClick={() =>
                write({ ...gradient, stops: gradient.stops.filter((_, j) => j !== i) }, true)
              }
              aria-label={`Remove stop ${i + 1}`}
              title="Remove"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="ss-shadow__add"
        onClick={() =>
          write(
            {
              ...gradient,
              stops: [...gradient.stops, { color: '#ffffff', position: '100%' }],
            },
            true
          )
        }
      >
        + Add stop
      </button>
    </div>
  );
}
