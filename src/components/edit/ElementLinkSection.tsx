/**
 * The "Link" section of the Settings tab — where a link's target is chosen
 * instead of typed as a raw `href`.
 *
 * Shown for link elements only. It writes plain attributes (`href`, `target`,
 * `download`) through the same drift-guarded source write the attribute rows
 * use, so nothing here is a special case in the backend.
 *
 * Three decisions worth knowing:
 *
 * Switching the kind clears the field and writes nothing. Carrying `/about`
 * over into "Email" would produce `mailto:/about`, and writing an empty value
 * would silently drop a link the user was only about to re-point.
 *
 * The pickers and the text field sit side by side. The picker is the fast path
 * for what the project actually has; the field still takes anything, because a
 * link to a page that doesn't exist yet is a completely normal thing to write.
 *
 * An `href` holding an expression (`href={route}`) is read-only. Overwriting it
 * would compile and quietly break every link the expression produced.
 *
 * @module components/edit/ElementLinkSection
 */

import { useState } from 'react';
import type { ElementSettings } from '../../hooks/useElementSettings';
import { useLinkTargets } from '../../hooks/useLinkTargets';
import {
  LINK_KINDS,
  buildHref,
  isDynamicHref,
  isPlainLinkTag,
  linkAttrName,
  parseHref,
  type LinkKind,
} from '../../lib/elementLink';

/** Tags whose `href` this section owns. */
const LINK_TAGS = ['a', 'area'];

export function isLinkElement(tag: string): boolean {
  return LINK_TAGS.includes(tag.toLowerCase());
}

export function ElementLinkSection({
  settings,
  heading = true,
}: {
  settings: ElementSettings;
  /** Draw the section's own "Link" label. Off inside the Tailwind panel, where
   *  the collapsible `PropSection` around it already carries the title. */
  heading?: boolean;
}) {
  const { attributes, sourceTag, setAttributes, canEditAttributes, attrsError, projectPath, busy } =
    settings;

  const attr = (name: string) => attributes.find((a) => a.name.toLowerCase() === name)?.value ?? '';
  const hasAttr = (name: string) => attributes.some((a) => a.name.toLowerCase() === name);

  // Which attribute holds the target: `href` almost everywhere, `to` on React
  // Router's link components.
  const hrefAttr = linkAttrName(attributes);
  const href = attr(hrefAttr);
  const dynamic = isDynamicHref(href);
  // A component that renders a link but carries no target attribute of its own
  // (`<CTA>`, `<Button>`): the URL lives inside the component, and an `href`
  // written here would be an attribute nothing reads.
  const targetInComponent =
    canEditAttributes && !isPlainLinkTag(sourceTag.toLowerCase()) && !hasAttr(hrefAttr);
  const editable = canEditAttributes && !dynamic && !targetInComponent;

  const [kind, setKind] = useState<LinkKind>(() => parseHref(href).kind);
  const [value, setValue] = useState(() => parseHref(href).value);
  const [subject, setSubject] = useState(() => parseHref(href).subject ?? '');
  // Re-seed only when the href changed underneath us — a different element
  // selected, or our own write landing. React's "adjust state while rendering"
  // pattern rather than an effect: an effect would paint the previous
  // element's link for one frame before correcting itself.
  const [seededHref, setSeededHref] = useState(href);
  if (seededHref !== href) {
    const parsed = parseHref(href);
    setSeededHref(href);
    setKind(parsed.kind);
    setValue(parsed.value);
    setSubject(parsed.subject ?? '');
  }

  const targets = useLinkTargets(projectPath, editable);
  const options = kind === 'page' ? targets.pages : kind === 'file' ? targets.files : [];
  const meta = LINK_KINDS.find((k) => k.id === kind) ?? LINK_KINDS[0];

  /** Write href (and the flags that only make sense with one) in one go. */
  const commit = (next: { value?: string; subject?: string }) => {
    const nextValue = next.value ?? value;
    const nextSubject = next.subject ?? subject;
    const nextHref = buildHref({ kind, value: nextValue, subject: nextSubject });
    if (nextHref === href) return;
    const changes: { name: string; value: string | null }[] = [
      { name: hrefAttr, value: nextHref || null },
    ];
    // A link with no target can't open in a new tab or download anything.
    if (!nextHref) {
      changes.push({ name: 'target', value: null }, { name: 'download', value: null });
    }
    setAttributes(changes);
  };

  const switchKind = (nextKind: LinkKind) => {
    setKind(nextKind);
    setValue('');
    setSubject('');
    if (nextKind !== 'file' && hasAttr('download')) {
      setAttributes([{ name: 'download', value: null }]);
    }
  };

  const setNewTab = (on: boolean) =>
    setAttributes([{ name: 'target', value: on ? '_blank' : null }]);
  const setDownload = (on: boolean) => setAttributes([{ name: 'download', value: on ? '' : null }]);

  const removeLink = () =>
    setAttributes([
      { name: hrefAttr, value: null },
      { name: 'target', value: null },
      { name: 'download', value: null },
    ]);

  return (
    <section className="ss-settings__group ss-link">
      {heading && <h4 className="ss-settings__label">Link</h4>}

      {dynamic ? (
        <p className="ss-link__locked">
          This link comes from code: <code>{href}</code>. Change it there — writing a URL over the
          expression would break every link it produces.
        </p>
      ) : targetInComponent ? (
        <p className="ss-link__locked">
          The target comes from the <code>{sourceTag}</code> component, not from this spot in the
          markup. Change it where the component builds its link.
        </p>
      ) : !canEditAttributes ? (
        // The backend's reason names the actual obstacle (several identical
        // tags, a generated class), which is the only version worth showing.
        <p className="ss-settings__empty">
          {attrsError ?? "This element's markup can't be edited here."}
        </p>
      ) : (
        <>
          <div className="ss-link__kinds" role="group" aria-label="Link type">
            {LINK_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className={`ss-link__kind${kind === k.id ? ' is-active' : ''}`}
                aria-pressed={kind === k.id}
                disabled={busy}
                onClick={() => switchKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>

          {(kind === 'page' || kind === 'file') && (
            <select
              className="ss-link__picker"
              value={options.includes(value) ? value : ''}
              disabled={busy || options.length === 0}
              aria-label={kind === 'page' ? 'Pick a page' : 'Pick a file'}
              onChange={(e) => {
                setValue(e.target.value);
                commit({ value: e.target.value });
              }}
            >
              <option value="">
                {targets.loading
                  ? 'Loading…'
                  : options.length === 0
                    ? kind === 'page'
                      ? 'No pages found'
                      : `No files in ${targets.assetsRoot}/`
                    : kind === 'page'
                      ? 'Pick a page…'
                      : `Pick a file from ${targets.assetsRoot}/…`}
              </option>
              {options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}

          <input
            className="ss-link__input"
            value={value}
            spellCheck={false}
            autoComplete="off"
            disabled={busy}
            placeholder={meta.placeholder}
            aria-label={`${meta.label} target`}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => commit({})}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit({});
              else if (e.key === 'Escape') setValue(parseHref(href).value);
            }}
          />

          {kind === 'email' && (
            <input
              className="ss-link__input"
              value={subject}
              spellCheck={false}
              autoComplete="off"
              disabled={busy}
              placeholder="Subject (optional)"
              aria-label="Email subject"
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => commit({})}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit({});
              }}
            />
          )}

          {targets.error && (kind === 'page' || kind === 'file') && (
            <p className="ss-link__note">{targets.error} Type the path instead.</p>
          )}

          <label className="ss-link__toggle">
            <input
              type="checkbox"
              checked={attr('target') === '_blank'}
              disabled={busy || !href}
              onChange={(e) => setNewTab(e.target.checked)}
            />
            Open in a new tab
          </label>

          {kind === 'file' && (
            <label className="ss-link__toggle">
              <input
                type="checkbox"
                checked={hasAttr('download')}
                disabled={busy || !href}
                onChange={(e) => setDownload(e.target.checked)}
              />
              Download instead of opening
            </label>
          )}

          {href && (
            <div className="ss-link__current">
              <code>{href}</code>
              <button type="button" disabled={busy} onClick={removeLink}>
                Remove
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
