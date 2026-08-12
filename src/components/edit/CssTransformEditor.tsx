/**
 * Structured editor for `transform` — move, rotate, scale and skew as fields.
 *
 * Values the parser refuses (a different function order, `matrix()`, 3D
 * functions) fall back to a text field, because re-emitting them in this
 * editor's fixed order would change where the element lands.
 *
 * @module components/edit/CssTransformEditor
 */

import { CssLengthField } from './CssLengthField';
import { formatTransform, parseTransform, type TransformParts } from '../../lib/cssTransform';

interface Props {
  prop: string;
  value: string;
  onPreview: (property: string, value: string | null) => void;
  onSave: (property: string, value: string | null) => void;
  isValid: (value: string) => boolean;
}

/** Field groups, with the step scale each one wants. */
const GROUPS: { title: string; fields: [keyof TransformParts, string, string][] }[] = [
  {
    title: 'Move',
    fields: [
      ['translateX', 'X', 'translate'],
      ['translateY', 'Y', 'translate'],
    ],
  },
  {
    title: 'Scale',
    fields: [
      ['scaleX', 'X', 'scale'],
      ['scaleY', 'Y', 'scale'],
    ],
  },
  {
    title: 'Skew',
    fields: [
      ['skewX', 'X', 'angle'],
      ['skewY', 'Y', 'angle'],
    ],
  },
];

export function CssTransformEditor({ prop, value, onPreview, onSave, isValid }: Props) {
  const parts = parseTransform(value);

  if (parts === null) {
    return (
      <div className="ss-shadow">
        <p className="ss-shadow__note">
          This transform can&apos;t be split into fields without risking a different result, so it
          stays as text.
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

  const update = (patch: Partial<TransformParts>, commit: boolean) => {
    const next = { ...parts, ...patch };
    const css = formatTransform(next);
    const out = css === 'none' ? null : css;
    onPreview(prop, out);
    if (commit) onSave(prop, out);
  };

  const field = (key: keyof TransformParts, label: string, scale: string) => (
    <label className="ss-shadow__field" key={key}>
      <span className="ss-shadow__label">{label}</span>
      <CssLengthField
        prop={`transform-${scale}`}
        value={parts[key]}
        placeholder={scale === 'scale' ? '1' : '0'}
        onPreview={(_p, v) => update({ [key]: v ?? '' }, false)}
        onSave={(_p, v) => update({ [key]: v ?? '' }, true)}
        // Each field is validated on its own terms: a length, a number, or an
        // angle depending on the group.
        isValid={(v) =>
          scale === 'scale'
            ? /^-?(?:\d+\.?\d*|\.\d+)$/.test(v.trim())
            : isValid(`translate(${v})`) || isValid(`rotate(${v})`)
        }
      />
    </label>
  );

  return (
    <div className="ss-shadow">
      {GROUPS.map((group) => (
        <div className="ss-shadow__layer" key={group.title}>
          <span className="ss-shadow__label">{group.title}</span>
          <div className="ss-shadow__grid">{group.fields.map((f) => field(...f))}</div>
        </div>
      ))}
      <div className="ss-shadow__layer">
        <label className="ss-shadow__field">
          <span className="ss-shadow__label">Rotate</span>
          <CssLengthField
            prop="transform-angle"
            value={parts.rotate}
            placeholder="0deg"
            onPreview={(_p, v) => update({ rotate: v ?? '' }, false)}
            onSave={(_p, v) => update({ rotate: v ?? '' }, true)}
            isValid={(v) => isValid(`rotate(${v})`)}
          />
        </label>
      </div>
    </div>
  );
}
