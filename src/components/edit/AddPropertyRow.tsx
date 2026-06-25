/**
 * The "add property" affordance at the bottom of a cascade rule card — a combobox
 * ("Select or type to add…") over CSS property names with a "Create <typed>" row
 * (Stacki-style). Submitting appends a new (valueless) declaration.
 */

import { useState } from 'react';
import { PlusIcon } from '../icons/utility';
import { ComboInput } from './ComboInput';
import { suggestProperties } from '../../lib/cssProperties';

interface Props {
  onAdd: (prop: string) => void;
}

export function AddPropertyRow({ onAdd }: Props) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" className="ss-card__add" onClick={() => setOpen(true)}>
        <PlusIcon size={11} /> Add property
      </button>
    );
  }

  return (
    <ComboInput
      placeholder="Select or type to add…"
      suggest={(q) => suggestProperties(q)}
      onSubmit={(prop) => {
        onAdd(prop);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}
