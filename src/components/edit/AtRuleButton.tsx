/**
 * The "add parent / add child" affordance on a cascade card (Stacki's `@`, but
 * labelled). Above the selector it wraps the rule in a parent at-rule; below it
 * adds a nested child rule. Clicking opens a combobox of common at-rules
 * (`@media (...)`, `@supports (...)`) that also accepts free text (e.g. `&:hover`
 * for a child). The parent decides what the chosen prelude does.
 */

import { useState } from 'react';
import { PlusIcon } from '../icons/utility';
import { ComboInput } from './ComboInput';
import { suggestAtRules } from '../../lib/cssProperties';

interface Props {
  /** Short label after the +, e.g. "parent" (wrap) or "child" (nest). */
  label: string;
  /** Tooltip describing what this does. */
  title: string;
  onSubmit: (prelude: string) => void;
}

export function AtRuleButton({ label, title, onSubmit }: Props) {
  const [open, setOpen] = useState(false);
  if (open) {
    return (
      <div className="ss-card__at-input">
        <ComboInput
          placeholder="@media (max-width: 768px) or &:hover"
          suggest={(q) => suggestAtRules(q)}
          showCreate={false}
          onSubmit={(prelude) => {
            onSubmit(prelude);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      className="ss-card__at"
      title={title}
      aria-label={title}
      onClick={() => setOpen(true)}
    >
      <PlusIcon size={10} /> {label}
    </button>
  );
}
