/**
 * A tiny combobox used across the cascade editor: a text input with a floating
 * suggestion list and an optional "Create <typed>" row (Stacki's add-property /
 * at-rule pattern). Submitting (Enter, or clicking a suggestion) calls `onSubmit`;
 * Escape/blur cancels. Free-text: you can always submit exactly what you typed.
 */

import { useRef, useState } from 'react';

interface Props {
  placeholder?: string;
  /** Suggestions for the current query (already filtered/limited by the caller). */
  suggest: (query: string) => string[];
  onSubmit: (value: string) => void;
  onCancel?: () => void;
  /** Show a leading "Create …" row for the typed text (e.g. a new property). */
  showCreate?: boolean;
  autoFocus?: boolean;
}

export function ComboInput({
  placeholder,
  suggest,
  onSubmit,
  onCancel,
  showCreate = true,
  autoFocus = true,
}: Props) {
  const [text, setText] = useState('');
  const closing = useRef(false);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v) {
      onCancel?.();
      return;
    }
    closing.current = true;
    onSubmit(v);
  };

  const items = suggest(text);
  const typed = text.trim();
  const exact = items.includes(typed);
  const showCreateRow = showCreate && typed.length > 0 && !exact;

  return (
    <div className="ss-combo">
      <input
        className="ss-combo__input"
        autoFocus={autoFocus}
        value={text}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit(text);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel?.();
          }
        }}
        onBlur={() => {
          // Let a suggestion click win the race before we cancel on blur.
          setTimeout(() => {
            if (!closing.current) onCancel?.();
          }, 120);
        }}
      />
      {(showCreateRow || items.length > 0) && (
        <div className="ss-combo__menu">
          {showCreateRow && (
            <button
              type="button"
              className="ss-combo__create"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => submit(typed)}
            >
              Create <span className="ss-combo__create-chip">{typed}</span>
            </button>
          )}
          {items.map((it) => (
            <button
              key={it}
              type="button"
              className="ss-combo__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => submit(it)}
            >
              {it}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
