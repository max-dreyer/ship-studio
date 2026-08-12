/**
 * Structured visual controls for the CSS-Mode editor (Phase 4).
 *
 * Renders one category's controls (segmented / dropdown / length / color) for a
 * resolved rule, plus an always-available "add any property" row. Each control
 * reads its value straight from the rule's declarations and writes a single CSS
 * property: a quick `onPreview` for live feedback, then `onSave` to persist.
 *
 * Dropdowns and the color popover reuse the Tailwind editor's components
 * (`EnumDropdown`, `ColorPicker`) so both editors look and behave identically.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useDismissOnOutsidePointer } from '../../hooks/useDismissOnOutsidePointer';
import { Button } from '../primitives/Button';
import { EnumDropdown } from './EnumDropdown';
import { ColorPicker } from './ColorPicker';
import { CssLengthField } from './CssLengthField';
import { CssSpacingBox } from './CssSpacingBox';
import { CssShadowEditor } from './CssShadowEditor';
import { CssTransitionEditor } from './CssTransitionEditor';
import { CssTransformEditor } from './CssTransformEditor';
import { CssEdgeControl } from './CssEdgeControl';
import { CssGradientEditor } from './CssGradientEditor';
import { ICONS } from './CssControlIcons';
import type { EdgeKind } from '../../lib/cssEdges';
import { inheritedValue, type EffectiveValue } from '../../lib/cssEffective';
import { CSS_CATEGORIES, cssValueOf, type CssControl, type SegOption } from '../../lib/cssControls';
import type { CssDeclaration } from '../../lib/edit-css';

function cssSupports(prop: string, value: string): boolean {
  try {
    return (
      typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports(prop, value)
    );
  } catch {
    return false;
  }
}

function isValidProperty(prop: string): boolean {
  return /^-{0,2}[a-z][a-z0-9-]*$/.test(prop.trim());
}

interface ControlProps {
  value: string;
  onPreview: (property: string, value: string | null) => void;
  onSave: (property: string, value: string | null) => void;
  /** What the element actually has when this rule doesn't set the property —
   *  shown as a placeholder so the panel reflects reality, not just this rule. */
  inherited?: EffectiveValue | null;
}

/** A control label that doubles as a Reset affordance — same behavior as the
 *  Tailwind editor's ResettableLabel: when the property is set, the label is
 *  clickable and pops a floating "Reset" next to the cursor that clears it. */
function ResettableCcLabel({
  label,
  isSet,
  onReset,
}: {
  label: string;
  isSet: boolean;
  onReset: () => void;
}) {
  const [pop, setPop] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLButtonElement>(null);

  useDismissOnOutsidePointer(pop !== null, popRef, () => setPop(null), {
    isOutside: (t) => !popRef.current?.contains(t) && !btnRef.current?.contains(t),
  });
  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPop(null);
    const onScroll = () => setPop(null);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [pop]);

  if (!isSet) return <span className="ss-cc-label">{label}</span>;

  const openAt = (e: ReactMouseEvent) => {
    const M = 8;
    const W = 72;
    const H = 28;
    setPop({
      left: Math.min(e.clientX + 10, window.innerWidth - W - M),
      top: Math.min(e.clientY + 10, window.innerHeight - H - M),
    });
  };

  return (
    <span className="ss-cc-label ss-cc-label--resettable">
      <button
        ref={btnRef}
        type="button"
        className="ss-cc-labelbtn"
        aria-expanded={pop !== null}
        onClick={openAt}
        title={`${label} is set — click to reset`}
      >
        {label}
        <span className="ss-cc-setdot" aria-hidden />
      </button>
      {pop &&
        createPortal(
          <button
            ref={popRef}
            type="button"
            className="ss-reset-pop"
            style={{ top: pop.top, left: pop.left }}
            onClick={() => {
              onReset();
              setPop(null);
            }}
          >
            Reset
          </button>,
          document.body
        )}
    </span>
  );
}

function Field({
  label,
  isSet,
  inherited,
  onReset,
  block,
  children,
}: {
  label: string;
  isSet?: boolean;
  /** Set when the value on screen comes from another rule — the row is muted
   *  and the label says where it came from. */
  inherited?: EffectiveValue | null;
  onReset?: () => void;
  /** Stack the control under its label instead of beside it. For controls that
   *  need the full width (layer editors, the box model), where Webflow also
   *  breaks out of its two-column grid. */
  block?: boolean;
  children: ReactNode;
}) {
  const showsInherited = !isSet && !!inherited;
  return (
    <div
      className={`ss-cc-field${block ? ' ss-cc-field--block' : ''}${
        showsInherited ? ' is-inherited' : ''
      }`}
      title={showsInherited ? `From ${inherited.source}` : undefined}
    >
      {onReset ? (
        <ResettableCcLabel label={label} isSet={!!isSet} onReset={onReset} />
      ) : (
        <span className="ss-cc-label">{label}</span>
      )}
      {children}
    </div>
  );
}

function Segmented({
  prop,
  label,
  options,
  value,
  onPreview,
  onSave,
  inherited,
}: ControlProps & { prop: string; label: string; options: SegOption[] }) {
  // With nothing set here, highlight what the element actually has, muted.
  const shown = value.trim() !== '' ? value : (inherited?.value ?? '');
  return (
    <Field
      label={label}
      isSet={value.trim() !== ''}
      inherited={inherited}
      onReset={() => {
        onPreview(prop, null);
        onSave(prop, null);
      }}
    >
      <div className="ss-cc-seg" role="group" aria-label={label}>
        {options.map((o) => {
          const active = shown === o.value;
          return (
            <button
              key={o.value}
              type="button"
              className={`ss-cc-seg__btn${active ? ' is-active' : ''}`}
              title={o.title ?? o.label ?? o.value}
              aria-pressed={active}
              onClick={() => {
                const next = active ? null : o.value; // click active again to clear
                onPreview(prop, next);
                onSave(prop, next);
              }}
            >
              {o.icon ? ICONS[o.icon] : (o.glyph ?? o.label ?? o.value)}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

function SelectControl({
  prop,
  label,
  options,
  value,
  onPreview,
  onSave,
  inherited,
}: ControlProps & { prop: string; label: string; options: { value: string; label: string }[] }) {
  return (
    <Field
      label={label}
      isSet={value.trim() !== ''}
      inherited={inherited}
      onReset={() => {
        onPreview(prop, null);
        onSave(prop, null);
      }}
    >
      <EnumDropdown
        label={label}
        value={value || inherited?.value || null}
        options={[
          { label: '—', token: '' },
          ...options.map((o) => ({ label: o.label, token: o.value })),
        ]}
        onChange={(token) => {
          const v = token || null;
          onPreview(prop, v);
          onSave(prop, v);
        }}
      />
    </Field>
  );
}

/** Numeric field. The input stays free-form (calc(), var(), keywords all go in
 *  by hand); `CssLengthField` adds scrub / arrow-key / unit-menu on top for the
 *  values that are plain numbers. */
function LengthControl({
  prop,
  label,
  placeholder,
  value,
  onPreview,
  onSave,
  inherited,
}: ControlProps & { prop: string; label: string; placeholder?: string }) {
  return (
    <Field
      label={label}
      isSet={value.trim() !== ''}
      inherited={inherited}
      onReset={() => {
        onPreview(prop, null);
        onSave(prop, null);
      }}
    >
      <CssLengthField
        prop={prop}
        value={value}
        placeholder={inherited?.value ?? placeholder}
        onPreview={onPreview}
        onSave={onSave}
        isValid={(v) => cssSupports(prop, v)}
      />
    </Field>
  );
}

/** Free-text field for values that are never a lone number (font stacks,
 *  gradients). Same chrome as the numeric field, minus the gestures that would
 *  have nothing to grab onto. */
function TextControl({
  prop,
  label,
  placeholder,
  value,
  onPreview,
  onSave,
  inherited,
}: ControlProps & { prop: string; label: string; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [syncedValue, setSyncedValue] = useState(value);
  if (value !== syncedValue) {
    setSyncedValue(value);
    setText(value);
  }
  const valid = text.trim() === '' || cssSupports(prop, text.trim());
  const commit = () => {
    const next = text.trim();
    if (next === value.trim()) return;
    if (next !== '' && !valid) {
      setText(value);
      onPreview(prop, value || null);
      return;
    }
    onSave(prop, next === '' ? null : next);
  };
  return (
    <Field
      label={label}
      isSet={value.trim() !== ''}
      inherited={inherited}
      onReset={() => {
        onPreview(prop, null);
        onSave(prop, null);
      }}
    >
      <input
        className={`ss-cc-input${!valid ? ' is-invalid' : ''}`}
        value={text}
        placeholder={inherited?.value ?? placeholder}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          const t = e.target.value.trim();
          if (t && cssSupports(prop, t)) onPreview(prop, t);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') {
            setText(value);
            onPreview(prop, value || null);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </Field>
  );
}

/** Color control: a swatch that opens the shared ColorPicker popover. Previews
 *  live while dragging; commits the final value when the popover closes. */
function ColorControl({
  prop,
  label,
  value,
  onPreview,
  onSave,
}: ControlProps & { prop: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number } | null>(null);
  const [local, setLocal] = useState(value || '');
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const latestRef = useRef(value);

  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 216;
    const H = 250;
    const M = 8;
    let left = r.left - W - M;
    if (left < M) left = r.right + M;
    left = Math.min(Math.max(M, left), window.innerWidth - W - M);
    const top = Math.min(Math.max(M, r.top), window.innerHeight - H - M);
    setRect({ top, left });
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    if (latestRef.current !== value) onSave(prop, latestRef.current || null);
  }, [prop, value, onSave]);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  useDismissOnOutsidePointer(open, popRef, close, {
    isOutside: (t) => !triggerRef.current?.contains(t) && !popRef.current?.contains(t),
  });
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const commitText = () => {
    const next = local.trim();
    if (next === (value || '')) return;
    if (next !== '' && !cssSupports(prop, next)) {
      setLocal(value || '');
      return;
    }
    onSave(prop, next === '' ? null : next);
  };

  return (
    <Field
      label={label}
      isSet={value.trim() !== ''}
      onReset={() => {
        onPreview(prop, null);
        onSave(prop, null);
      }}
    >
      <div className="ss-cc-color">
        <button
          ref={triggerRef}
          type="button"
          className="ss-color-swatch"
          title={`${label} color`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            if (open) {
              close();
            } else {
              latestRef.current = value;
              setLocal(value || '');
              setOpen(true);
            }
          }}
        >
          {value ? (
            <span className="ss-color-swatch__chip" style={{ background: value }} />
          ) : (
            <span className="ss-color-swatch__empty">—</span>
          )}
        </button>
        <input
          className="ss-cc-input"
          value={local}
          placeholder="—"
          spellCheck={false}
          aria-label={`${label} value`}
          onChange={(e) => {
            setLocal(e.target.value);
            latestRef.current = e.target.value;
            const t = e.target.value.trim();
            if (t && cssSupports(prop, t)) onPreview(prop, t);
          }}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      {open &&
        rect &&
        createPortal(
          <div ref={popRef} className="ss-color-popover" style={{ top: rect.top, left: rect.left }}>
            <ColorPicker
              value={local || '#000000'}
              onChange={(css) => {
                setLocal(css);
                latestRef.current = css;
                onPreview(prop, css);
              }}
            />
          </div>,
          document.body
        )}
    </Field>
  );
}

function Control({
  control,
  value,
  onPreview,
  onSave,
  onSaveMany,
  declarations,
  inherited,
  highlight,
}: {
  control: CssControl;
  highlight?: boolean;
  /** Both only used by the edge control, which spans several properties. */
  declarations: CssDeclaration[];
  onSaveMany: (changes: { property: string; value: string | null }[]) => void;
} & ControlProps) {
  const key = `${control.prop}:${value}`;
  let inner: ReactNode;

  /** Every structured editor hangs in a full-width Field with the same reset. */
  const editorField = (child: ReactNode) => (
    <Field
      key={key}
      block
      label={control.label}
      isSet={value.trim() !== ''}
      onReset={() => {
        onPreview(control.prop, null);
        onSave(control.prop, null);
      }}
    >
      {child}
    </Field>
  );
  const editorProps = {
    prop: control.prop,
    value,
    onPreview,
    onSave,
    isValid: (v: string) => cssSupports(control.prop, v),
  };

  switch (control.kind) {
    case 'segmented':
      inner = (
        <Segmented
          key={key}
          prop={control.prop}
          label={control.label}
          inherited={inherited}
          options={control.options}
          value={value}
          onPreview={onPreview}
          onSave={onSave}
        />
      );
      break;
    case 'select':
      inner = (
        <SelectControl
          key={key}
          prop={control.prop}
          label={control.label}
          inherited={inherited}
          options={control.options}
          value={value}
          onPreview={onPreview}
          onSave={onSave}
        />
      );
      break;
    case 'length':
      inner = (
        <LengthControl
          key={key}
          prop={control.prop}
          label={control.label}
          inherited={inherited}
          placeholder={control.placeholder}
          value={value}
          onPreview={onPreview}
          onSave={onSave}
        />
      );
      break;
    case 'text':
      inner = (
        <TextControl
          key={key}
          prop={control.prop}
          label={control.label}
          inherited={inherited}
          placeholder={control.placeholder}
          value={value}
          onPreview={onPreview}
          onSave={onSave}
        />
      );
      break;
    case 'shadow':
      inner = editorField(<CssShadowEditor {...editorProps} />);
      break;
    case 'transition':
      inner = editorField(<CssTransitionEditor {...editorProps} />);
      break;
    case 'transform':
      inner = editorField(<CssTransformEditor {...editorProps} />);
      break;
    case 'gradient':
      inner = editorField(<CssGradientEditor {...editorProps} />);
      break;
    case 'edges':
      inner = editorField(
        <CssEdgeControl
          kind={control.prop as EdgeKind}
          declarations={declarations}
          onPreview={onPreview}
          onSaveMany={onSaveMany}
          isValid={editorProps.isValid}
        />
      );
      break;
    case 'color':
      inner = (
        <ColorControl
          key={key}
          prop={control.prop}
          label={control.label}
          value={value}
          onPreview={onPreview}
          onSave={onSave}
        />
      );
      break;
  }
  return (
    <div data-prop={control.prop} className={`ss-cc-ctrl${highlight ? ' ss-cc-hl' : ''}`}>
      {inner}
    </div>
  );
}

export function AddProp({
  onSave,
  onAdded,
}: {
  onSave: (property: string, value: string | null) => void;
  onAdded?: (property: string) => void;
}) {
  const [prop, setProp] = useState('');
  const [value, setValue] = useState('');
  const ready =
    isValidProperty(prop) && value.trim() !== '' && cssSupports(prop.trim(), value.trim());
  const add = () => {
    if (!ready) return;
    const p = prop.trim().toLowerCase();
    onSave(p, value.trim());
    onAdded?.(p);
    setProp('');
    setValue('');
  };
  return (
    <div className="ss-cc-add">
      <span className="ss-cc-label">Add property</span>
      <div className="ss-cc-add__row">
        <input
          className="ss-cc-input"
          placeholder="property"
          value={prop}
          spellCheck={false}
          onChange={(e) => setProp(e.target.value)}
        />
        <input
          className="ss-cc-input"
          placeholder="value"
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add();
          }}
        />
        <Button variant="secondary" size="sm" onClick={add} disabled={!ready}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function CssControls({
  category,
  declarations,
  onPreview,
  onSave,
  onSaveMany,
  effective,
  highlightProp,
}: {
  category: string;
  declarations: CssDeclaration[];
  onPreview: (property: string, value: string | null) => void;
  onSave: (property: string, value: string | null) => void;
  /** Several declarations at once — the spacing box and the edge control need
   *  it to replace a shorthand with longhands in one write. */
  onSaveMany: (changes: { property: string; value: string | null }[]) => void;
  /** What the element currently has, per property, across the whole cascade.
   *  Controls the rule doesn't set show it as a muted placeholder. */
  effective?: Map<string, EffectiveValue>;
  highlightProp?: string | null;
}) {
  const get = (p: string) => cssValueOf(declarations, p);
  const cat = CSS_CATEGORIES.find((c) => c.id === category);
  if (!cat) return null;
  const controls = cat.controls.filter((c) => !c.showIf || c.showIf(get));

  const render = (c: CssControl) => (
    <Control
      key={c.prop}
      control={c}
      value={get(c.prop)}
      declarations={declarations}
      inherited={inheritedValue(effective, c.prop)}
      onPreview={onPreview}
      onSave={onSave}
      onSaveMany={onSaveMany}
      highlight={highlightProp === c.prop}
    />
  );

  // Walk the list, taking flagged controls two at a time onto one row. A lone
  // survivor (its partner hidden by `showIf`) falls back to a full-width row.
  const rows: ReactNode[] = [];
  for (let i = 0; i < controls.length; i++) {
    const c = controls[i];
    const next = controls[i + 1];
    if (c.pair && next?.pair) {
      rows.push(
        <div className="ss-cc-pair" key={`${c.prop}+${next.prop}`}>
          {render(c)}
          {render(next)}
        </div>
      );
      i++;
      continue;
    }
    rows.push(render(c));
  }

  return (
    <div className="ss-cc">
      {category === 'spacing' ? (
        <CssSpacingBox declarations={declarations} onPreview={onPreview} onSaveMany={onSaveMany} />
      ) : (
        rows
      )}
    </div>
  );
}
