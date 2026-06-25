/**
 * The "Settings" tab of the cascade editor (Stacki's Style/Settings split) — edits
 * the selected element's MARKUP. v1: CLASSES are fully editable (chips with add/
 * remove); TAG and ATTRIBUTES are shown for reference (editing them is a fast-follow).
 */

import { useState } from 'react';
import { CloseIcon } from '../icons/common';
import { PlusIcon } from '../icons/utility';
import type { ElementSettings } from '../../hooks/useElementSettings';

export function ElementSettingsPanel({ settings }: { settings: ElementSettings }) {
  const { tag, classes, attributes, addClass, removeClass } = settings;
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  const submit = () => {
    const v = text.trim();
    if (v) addClass(v);
    setText('');
    setAdding(false);
  };

  return (
    <div className="ss-settings">
      <section className="ss-settings__group">
        <h4 className="ss-settings__label">Tag</h4>
        <div className="ss-settings__tag">{tag || '—'}</div>
      </section>

      <section className="ss-settings__group">
        <h4 className="ss-settings__label">Classes</h4>
        <div className="ss-settings__classes">
          {classes.map((c) => (
            <span key={c} className="ss-settings__class-chip">
              .{c}
              <button
                type="button"
                className="ss-settings__class-remove"
                title={`Remove .${c}`}
                aria-label={`Remove .${c}`}
                onClick={() => removeClass(c)}
              >
                <CloseIcon size={10} />
              </button>
            </span>
          ))}
          {adding ? (
            <input
              className="ss-settings__class-input"
              autoFocus
              value={text}
              spellCheck={false}
              autoComplete="off"
              placeholder="class name"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
                else if (e.key === 'Escape') {
                  setText('');
                  setAdding(false);
                }
              }}
              onBlur={submit}
            />
          ) : (
            <button
              type="button"
              className="ss-settings__class-add"
              onClick={() => setAdding(true)}
            >
              <PlusIcon size={10} /> add
            </button>
          )}
        </div>
      </section>

      <section className="ss-settings__group">
        <h4 className="ss-settings__label">Attributes</h4>
        {attributes.length === 0 ? (
          <p className="ss-settings__empty">No other attributes.</p>
        ) : (
          <ul className="ss-settings__attrs">
            {attributes.map((a) => (
              <li key={a.name} className="ss-settings__attr">
                <span className="ss-settings__attr-name">{a.name}</span>
                {a.value && (
                  <>
                    <span className="ss-settings__attr-eq">=</span>
                    <span className="ss-settings__attr-value">{a.value}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
