/**
 * Structured editor for the `transition` shorthand.
 *
 * One card per transition: which property animates, how long, with what
 * easing, after what delay. Same shape as the shadow editor — entries can be
 * added and removed, and an unparseable value falls back to a text field
 * rather than being rewritten.
 *
 * @module components/edit/CssTransitionEditor
 */

import { EnumDropdown } from './EnumDropdown';
import { CssLengthField } from './CssLengthField';
import {
  EMPTY_TRANSITION,
  TIMING_FUNCTIONS,
  formatTransition,
  parseTransition,
  type TransitionEntry,
} from '../../lib/cssTransition';

interface Props {
  prop: string;
  value: string;
  onPreview: (property: string, value: string | null) => void;
  onSave: (property: string, value: string | null) => void;
  isValid: (value: string) => boolean;
}

/** The properties worth offering first; anything else can still be typed. */
const COMMON_PROPERTIES = [
  'all',
  'opacity',
  'transform',
  'color',
  'background-color',
  'border-color',
  'box-shadow',
  'width',
  'height',
];

export function CssTransitionEditor({ prop, value, onPreview, onSave, isValid }: Props) {
  const entries = parseTransition(value);

  const write = (next: TransitionEntry[], commit: boolean) => {
    const out = next.length === 0 ? null : formatTransition(next);
    onPreview(prop, out);
    if (commit) onSave(prop, out);
  };

  if (entries === null) {
    return (
      <div className="ss-shadow">
        <p className="ss-shadow__note">
          This value can&apos;t be broken into entries, so it stays as text.
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

  const update = (index: number, patch: Partial<TransitionEntry>, commit: boolean) => {
    write(
      entries.map((e, i) => (i === index ? { ...e, ...patch } : e)),
      commit
    );
  };

  return (
    <div className="ss-shadow">
      {entries.map((entry, i) => (
        <div className="ss-shadow__layer" key={i}>
          <div className="ss-shadow__row">
            <span className="ss-shadow__grow">
              <EnumDropdown
                label="Property"
                value={entry.property || null}
                options={COMMON_PROPERTIES.map((p) => ({ label: p, token: p }))}
                onChange={(token) => update(i, { property: token ?? '' }, true)}
              />
            </span>
            <button
              type="button"
              className="ss-shadow__remove"
              onClick={() =>
                write(
                  entries.filter((_, j) => j !== i),
                  true
                )
              }
              aria-label={`Remove transition ${i + 1}`}
              title="Remove"
            >
              ×
            </button>
          </div>
          <div className="ss-shadow__grid">
            <label className="ss-shadow__field">
              <span className="ss-shadow__label">Duration</span>
              <CssLengthField
                prop="transition-duration"
                value={entry.duration}
                placeholder="0.2s"
                onPreview={(_p, v) => update(i, { duration: v ?? '' }, false)}
                onSave={(_p, v) => update(i, { duration: v ?? '' }, true)}
                isValid={(v) => isValid(`all ${v}`)}
              />
            </label>
            <label className="ss-shadow__field">
              <span className="ss-shadow__label">Delay</span>
              <CssLengthField
                prop="transition-delay"
                value={entry.delay}
                placeholder="0s"
                onPreview={(_p, v) => update(i, { delay: v ?? '' }, false)}
                onSave={(_p, v) => update(i, { delay: v ?? '' }, true)}
                isValid={(v) => isValid(`all 0s ${v}`)}
              />
            </label>
          </div>
          <label className="ss-shadow__field">
            <span className="ss-shadow__label">Easing</span>
            <EnumDropdown
              label="Easing"
              value={entry.timing || null}
              options={[
                { label: '—', token: '' },
                ...TIMING_FUNCTIONS.map((t) => ({ label: t, token: t })),
              ]}
              onChange={(token) => update(i, { timing: token ?? '' }, true)}
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="ss-shadow__add"
        onClick={() => write([...entries, EMPTY_TRANSITION], true)}
      >
        + Add transition
      </button>
    </div>
  );
}
