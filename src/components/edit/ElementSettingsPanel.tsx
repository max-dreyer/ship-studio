/**
 * The "Settings" tab of the cascade editor (Stacki's Style/Settings split) — edits
 * the selected element's MARKUP: CLASSES (chips with add/remove) and ATTRIBUTES
 * (edit a value, remove, or add) are editable; TAG is shown for reference.
 */

import { useState } from 'react';
import { CloseIcon } from '../icons/common';
import { PlusIcon } from '../icons/utility';
import type { ElementSettings } from '../../hooks/useElementSettings';

export function ElementSettingsPanel({ settings }: { settings: ElementSettings }) {
  const {
    tag,
    classes,
    attributes,
    addClass,
    removeClass,
    setAttribute,
    removeAttribute,
    canEditAttributes,
  } = settings;
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
        <ul className="ss-settings__attrs">
          {attributes.map((a) => (
            <AttrRow
              key={a.name}
              name={a.name}
              value={a.value}
              editable={canEditAttributes}
              onSetValue={(v) => setAttribute(a.name, v)}
              onRemove={() => removeAttribute(a.name)}
            />
          ))}
        </ul>
        {attributes.length === 0 && !canEditAttributes && (
          <p className="ss-settings__empty">No other attributes.</p>
        )}
        {canEditAttributes && <AddAttr onAdd={(name, value) => setAttribute(name, value)} />}
      </section>
    </div>
  );
}

/** One attribute row: name, click-to-edit value, and a remove button. */
function AttrRow({
  name,
  value,
  editable,
  onSetValue,
  onRemove,
}: {
  name: string;
  value: string;
  editable: boolean;
  onSetValue: (value: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);

  const commit = () => {
    const v = text;
    if (v !== value) onSetValue(v);
    setEditing(false);
  };

  return (
    <li className="ss-settings__attr">
      <span className="ss-settings__attr-name">{name}</span>
      <span className="ss-settings__attr-eq">=</span>
      {editing ? (
        <input
          className="ss-settings__attr-input"
          autoFocus
          value={text}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') {
              setText(value);
              setEditing(false);
            }
          }}
          onBlur={commit}
        />
      ) : (
        <button
          type="button"
          className="ss-settings__attr-value ss-settings__attr-value--editable"
          disabled={!editable}
          title={editable ? 'Click to edit' : undefined}
          onClick={() => {
            setText(value);
            setEditing(true);
          }}
        >
          {value || <span className="ss-settings__attr-empty">empty</span>}
        </button>
      )}
      {editable && (
        <button
          type="button"
          className="ss-settings__attr-remove"
          title={`Remove ${name}`}
          aria-label={`Remove ${name}`}
          onClick={onRemove}
        >
          <CloseIcon size={10} />
        </button>
      )}
    </li>
  );
}

/** "+ attribute" affordance: expands to name + value inputs. */
function AddAttr({ onAdd }: { onAdd: (name: string, value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [value, setValue] = useState('');

  const submit = () => {
    const n = name.trim();
    if (n) onAdd(n, value);
    setName('');
    setValue('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="ss-settings__class-add" onClick={() => setOpen(true)}>
        <PlusIcon size={10} /> attribute
      </button>
    );
  }
  return (
    <div className="ss-settings__attr-add">
      <input
        className="ss-settings__attr-input"
        autoFocus
        value={name}
        spellCheck={false}
        autoComplete="off"
        placeholder="name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') document.getElementById('ss-attr-add-value')?.focus();
          else if (e.key === 'Escape') setOpen(false);
        }}
      />
      <span className="ss-settings__attr-eq">=</span>
      <input
        id="ss-attr-add-value"
        className="ss-settings__attr-input"
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="value"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          else if (e.key === 'Escape') setOpen(false);
        }}
        onBlur={submit}
      />
    </div>
  );
}
