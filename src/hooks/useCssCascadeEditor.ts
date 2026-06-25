/**
 * Code-first CSS editor controller (vanilla-CSS projects) — the structured cascade
 * card GUI. Click an element → every author rule that styles it renders as a card
 * (in cascade order), each rule's properties as editable GUI rows, nested rules as
 * nested cards.
 *
 * Editing is **live + auto-saved**: a card edit mutates the rule's structured body
 * (`lib/cssBody`), which is serialized and (a) previewed in place in the iframe via
 * the CSSOM (`ss:previewRuleText`, debounced ~120ms) and (b) written to the source
 * `.css` via `apply_css_rule_text` (debounced ~600ms, drift-guarded). No Save buttons.
 *
 * Security: only messages from the preview iframe's own contentWindow are trusted.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ElementSignature } from '../lib/edit';
import {
  locateCssRules,
  applyCssRuleText,
  deleteCssRule,
  wrapCssRule,
  createCssRule,
  listStylesheets,
  listCssClasses,
  listCssSelectors,
  listCssVariables,
  renameCssSelector,
  renameCssAtRule,
  mergeCascade,
  rulesToLocate,
  rowKey,
  type MatchedRule,
  type RuleLocation,
  type CascadeRow,
} from '../lib/cssCascade';
import { parseRuleBody, serializeRuleBody, overriddenProps, type RuleBody } from '../lib/cssBody';
import { keyframesName } from '../lib/cssStructures';
import { logger } from '../lib/logger';
import { trackEvent } from '../lib/analytics';
import { asCommandError, formatCommandError } from '../lib/errors';

function toastText(err: unknown): string {
  return formatCommandError(asCommandError(err));
}

const PREVIEW_DEBOUNCE_MS = 120;
const SAVE_DEBOUNCE_MS = 600;

/** Approximate specificity of a simple selector (the element's own class/id/tag), for
 *  ordering draft cards within the cascade. */
function draftSpecificity(selector: string): [number, number, number] {
  if (selector.startsWith('#')) return [1, 0, 0];
  if (selector.startsWith('.')) return [0, 1, 0];
  return [0, 0, 1];
}

/** Compare specificity tuples (a−b, MSB first). */
function specCmp(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** Insert a draft row into the cascade list (which is sorted highest-priority first),
 *  mutating in place: before the first ACTIVE row with lower specificity, but above the
 *  inactive-media block. */
function insertDraftByCascade(rows: CascadeRow[], draft: CascadeRow): void {
  const ds = draft.specificity;
  let i = rows.findIndex((r) => !r.inactiveMedia && specCmp(r.specificity, ds) < 0);
  if (i < 0) {
    const inactive = rows.findIndex((r) => r.inactiveMedia);
    i = inactive < 0 ? rows.length : inactive;
  }
  rows.splice(i, 0, draft);
}

export interface CascadeSelection {
  signature: ElementSignature;
  instanceCount: number;
}

interface Params {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  projectPath: string;
  enabled: boolean;
  onToast: (message: string, type?: 'success' | 'error') => void;
}

export function useCssCascadeEditor({ iframeRef, projectPath, enabled, onToast }: Params) {
  const [editModeOn, setEditModeOn] = useState(false);
  const editMode = enabled && editModeOn;

  const [selection, setSelection] = useState<CascadeSelection | null>(null);
  const [rows, setRows] = useState<CascadeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [bodies, setBodies] = useState<Record<string, RuleBody>>({});
  const [overridden, setOverridden] = useState<Record<string, Map<string, string>>>({});
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());
  // Project class names for selector autocomplete (loaded when edit mode opens).
  const [classSuggestions, setClassSuggestions] = useState<string[]>([]);
  // Every existing rule selector (full text), so "Add selector" can suggest what's
  // already defined and re-surface it on a match instead of erroring.
  const [existingSelectors, setExistingSelectors] = useState<string[]>([]);
  // Project CSS variables (`--foo`) for `var(--…)` value autocomplete.
  const [variableSuggestions, setVariableSuggestions] = useState<string[]>([]);

  // Per-rule source baseline (drift guard + diff) and latest body, in refs so the
  // debounced callbacks read fresh values without re-binding.
  const baselineInner = useRef<Record<string, string>>({});
  const bodiesRef = useRef<Record<string, RuleBody>>({});
  const previewTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const selTokenRef = useRef(0);
  // The last selected element's signature — replayed after an HMR reload so the
  // panel re-reads the element's current source (instant sync after edits).
  const lastSignatureRef = useRef<ElementSignature | null>(null);
  // Synthetic indices for optimistically-added rules (kept clear of real cascade
  // indices, which start at 0).
  const synthIndex = useRef(1_000_000);
  // Locally-created rules (via "Add selector") keyed by rowKey. They're kept pinned
  // in the panel across cascade refreshes — even if the new selector doesn't match
  // the element yet — so a freshly-added rule never silently vanishes. Cleared when
  // a different element is selected; an entry is dropped once the real cascade
  // includes it (confirmed).
  const createdRowsRef = useRef<Map<string, CascadeRow>>(new Map());
  // Keys of draft cards (the element's own selectors with no rule yet). A draft's rule
  // is created in source on its first saved property; until then it's display-only.
  const draftKeysRef = useRef<Set<string>>(new Set());
  const editModeOnRef = useRef(false);
  useEffect(() => {
    editModeOnRef.current = editModeOn;
  }, [editModeOn]);

  const rowByKey = useMemo(() => {
    const m = new Map<string, CascadeRow>();
    for (const r of rows) m.set(rowKey(r), r);
    return m;
  }, [rows]);
  const rowByKeyRef = useRef(rowByKey);
  rowByKeyRef.current = rowByKey;

  const post = useCallback(
    (msg: unknown) => iframeRef.current?.contentWindow?.postMessage(msg, '*'),
    [iframeRef]
  );

  const clearTimers = useCallback(() => {
    Object.values(previewTimers.current).forEach(clearTimeout);
    Object.values(saveTimers.current).forEach(clearTimeout);
    previewTimers.current = {};
    saveTimers.current = {};
  }, []);

  // Activate the in-iframe selection layer in CASCADE mode while editing; re-arm on HMR.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (editMode) {
      post({ type: 'ss:activate', cascade: true });
      // After an HMR reload, re-arm the layer AND replay the last selection so the
      // panel re-reads the element's current source (instant read after edits).
      const reactivate = () => {
        post({ type: 'ss:activate', cascade: true });
        const sig = lastSignatureRef.current;
        if (sig) setTimeout(() => post({ type: 'ss:reselect', signature: sig }), 60);
      };
      iframe?.addEventListener('load', reactivate);
      return () => iframe?.removeEventListener('load', reactivate);
    }
    post({ type: 'ss:deactivate' });
  }, [editMode, post, iframeRef]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Project class names + CSS variables for autocomplete.
  useEffect(() => {
    if (!editMode) return;
    let cancelled = false;
    void listCssClasses(projectPath)
      .then((cs) => !cancelled && setClassSuggestions(cs))
      .catch(() => undefined);
    void listCssSelectors(projectPath)
      .then((ss) => !cancelled && setExistingSelectors(ss))
      .catch(() => undefined);
    void listCssVariables(projectPath)
      .then((vs) => !cancelled && setVariableSuggestions(vs))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [editMode, projectPath]);

  // Receive the clicked element's signature + its cascade; build the card models.
  useEffect(() => {
    if (!editMode) return;
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as {
        type?: string;
        signature?: ElementSignature;
        count?: number;
        rules?: MatchedRule[];
      } | null;
      if (!d) return;

      if (d.type === 'ss:select' && d.signature) {
        lastSignatureRef.current = d.signature;
        ++selTokenRef.current;
        clearTimers();
        post({ type: 'ss:clearRulePreview' });
        setSelection({ signature: d.signature, instanceCount: d.count ?? 1 });
        createdRowsRef.current = new Map();
        setRows([]);
        setBodies({});
        bodiesRef.current = {};
        baselineInner.current = {};
        setOverridden({});
        setSavingKeys(new Set());
        setLoading(true);
        void trackEvent('visual_element_selected', { mode: 'css-code', tag: d.signature.tagName });
        return;
      }

      if (d.type === 'ss:cascade' && Array.isArray(d.rules)) {
        const matched = d.rules;
        const token = selTokenRef.current;
        void (async () => {
          try {
            const toLocate = rulesToLocate(matched);
            const locations: RuleLocation[] = toLocate.length
              ? await locateCssRules(
                  projectPath,
                  toLocate.map((x) => x.query)
                )
              : [];
            const locByIndex = new Map<number, RuleLocation>();
            toLocate.forEach((x, k) => locByIndex.set(x.index, locations[k]));
            if (selTokenRef.current !== token) return;
            const merged = mergeCascade(matched, locByIndex);

            const nextBodies: Record<string, RuleBody> = {};
            const nextOverridden: Record<string, Map<string, string>> = {};
            const nextBaseline: Record<string, string> = {};
            merged.forEach((row, i) => {
              const key = rowKey(row);
              nextOverridden[key] = overriddenProps(matched[i] ?? { declarations: [] });
              if (row.editable && row.innerText != null) {
                nextBodies[key] = parseRuleBody(row.innerText);
                nextBaseline[key] = row.innerText;
              }
            });

            // Pin locally-created rules the cascade doesn't include (a new selector
            // that doesn't match this element yet) so they never silently vanish.
            // Drop any that the real cascade now confirms (dedup by key).
            const mergedKeys = new Set(merged.map(rowKey));
            const extraRows: CascadeRow[] = [];
            for (const [key, createdRow] of createdRowsRef.current) {
              if (mergedKeys.has(key)) {
                createdRowsRef.current.delete(key);
                continue;
              }
              extraRows.push(createdRow);
              nextBodies[key] =
                bodiesRef.current[key] ?? parseRuleBody(createdRow.innerText ?? '\n');
              nextBaseline[key] = baselineInner.current[key] ?? createdRow.innerText ?? '\n';
              nextOverridden[key] = new Map();
            }
            const finalRows = [...extraRows, ...merged];

            // Draft cards: the element's own selectors (classes, then tag) with no base
            // rule yet — empty editable cards placed in cascade order. They aren't
            // written to source until the first property is saved (see saveRule).
            draftKeysRef.current = new Set();
            const sig = lastSignatureRef.current;
            if (sig) {
              let targetFile = finalRows.find((r) => r.editable && r.file)?.file;
              if (!targetFile) {
                try {
                  targetFile = (await listStylesheets(projectPath))[0];
                } catch {
                  targetFile = undefined;
                }
              }
              if (targetFile && selTokenRef.current === token) {
                const sigClasses = sig.className.split(/\s+/).filter(Boolean);
                const candidates = [
                  ...new Set([...sigClasses.map((c) => `.${c}`), sig.tagName].filter(Boolean)),
                ];
                const styledBase = new Set(
                  finalRows.filter((r) => !r.mediaText && r.selector).map((r) => r.selector)
                );
                for (const selector of candidates) {
                  if (styledBase.has(selector)) continue;
                  const draft: CascadeRow = {
                    index: ++synthIndex.current,
                    selector,
                    declarations: [],
                    specificity: draftSpecificity(selector),
                    mediaText: null,
                    mediaMinPx: null,
                    inactiveMedia: false,
                    layer: null,
                    origin: 'author',
                    editable: true,
                    file: targetFile,
                    line: 0,
                    innerText: '\n',
                    draft: true,
                  };
                  const key = rowKey(draft);
                  draftKeysRef.current.add(key);
                  nextBodies[key] = { items: [] };
                  nextBaseline[key] = '\n';
                  nextOverridden[key] = new Map();
                  insertDraftByCascade(finalRows, draft);
                }
              }
            }

            setRows(finalRows);
            setBodies(nextBodies);
            bodiesRef.current = nextBodies;
            baselineInner.current = nextBaseline;
            setOverridden(nextOverridden);
          } catch (err) {
            logger.error('[CssCascade] locate failed', { error: String(err) });
            if (selTokenRef.current === token) {
              setRows(mergeCascade(matched, new Map()));
              onToast(toastText(err), 'error');
            }
          } finally {
            if (selTokenRef.current === token) setLoading(false);
          }
        })();
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [editMode, projectPath, post, iframeRef, onToast, clearTimers]);

  /** Live-preview a rule's current body in place (in-iframe CSSOM). */
  const previewRule = useCallback(
    (key: string) => {
      const row = rowByKeyRef.current.get(key);
      const body = bodiesRef.current[key];
      if (!row || !row.editable || row.selector == null || !body) return;
      post({
        type: 'ss:previewRuleText',
        ruleKey: key,
        selector: row.selector,
        mediaText: row.mediaText,
        cssText: `${row.selector} {${serializeRuleBody(body)}}`,
      });
    },
    [post]
  );

  /** Persist a rule's current body to source (drift-guarded), then bake the preview. */
  const saveRule = useCallback(
    async (key: string) => {
      const row = rowByKeyRef.current.get(key);
      const body = bodiesRef.current[key];
      if (!row || !row.editable || row.file == null || row.selector == null || !body) return;
      const oldInner = baselineInner.current[key];
      const newInner = serializeRuleBody(body);
      if (oldInner === undefined || newInner === oldInner) return;
      setSavingKeys((prev) => new Set(prev).add(key));
      post({ type: 'ss:suppressReload' });
      try {
        // A draft's rule doesn't exist in source yet — create the (empty) rule on its
        // first real property, then write the body into it. After this it's a normal card.
        if (draftKeysRef.current.has(key)) {
          try {
            await createCssRule(projectPath, row.file, row.selector);
          } catch (err) {
            if (!String(err).includes('already exists')) throw err;
          }
          draftKeysRef.current.delete(key);
        }
        await applyCssRuleText(
          projectPath,
          row.file,
          row.selector,
          row.mediaText,
          oldInner,
          newInner
        );
        baselineInner.current[key] = newInner; // new drift baseline
        post({ type: 'ss:commitRulePreview', ruleKey: key });
        void trackEvent('visual_style_saved', { mode: 'css-code' });
      } catch (err) {
        // The source drifted from our baseline (a prior save's formatting, an HMR
        // re-read, an external edit). Re-read the current source and retry ONCE so
        // editing stays "instant" instead of hitting a drift wall.
        if (/source changed/i.test(toastText(err))) {
          try {
            const locs = await locateCssRules(projectPath, [
              { selector: row.selector, mediaText: row.mediaText, href: null },
            ]);
            const loc = locs[0];
            if (loc && loc.status === 'resolved') {
              await applyCssRuleText(
                projectPath,
                row.file,
                row.selector,
                row.mediaText,
                loc.inner_text,
                newInner
              );
              baselineInner.current[key] = newInner;
              post({ type: 'ss:commitRulePreview', ruleKey: key });
              return;
            }
          } catch {
            /* fall through to the toast below */
          }
        }
        logger.error('[CssCascade] write-back failed', { error: String(err) });
        onToast(toastText(err), 'error');
      } finally {
        setSavingKeys((prev) => {
          const n = new Set(prev);
          n.delete(key);
          return n;
        });
      }
    },
    [projectPath, onToast, post]
  );

  /** Delete a whole rule from source, drop its card, and remove it live. */
  const deleteRule = useCallback(
    async (key: string) => {
      const row = rowByKeyRef.current.get(key);
      if (!row || !row.editable || row.file == null || row.selector == null) return;
      clearTimeout(previewTimers.current[key]);
      clearTimeout(saveTimers.current[key]);
      post({ type: 'ss:suppressReload' });
      try {
        await deleteCssRule(
          projectPath,
          row.file,
          row.selector,
          row.mediaText,
          baselineInner.current[key] ?? ''
        );
        post({ type: 'ss:clearRulePreview', ruleKey: key });
        post({ type: 'ss:deleteRulePreview', selector: row.selector, mediaText: row.mediaText });
        setRows((prev) => prev.filter((r) => rowKey(r) !== key));
        setBodies((prev) => {
          const n = { ...prev };
          delete n[key];
          return n;
        });
        delete bodiesRef.current[key];
        delete baselineInner.current[key];
        void trackEvent('visual_style_saved', { mode: 'css-code', deleted: true });
      } catch (err) {
        logger.error('[CssCascade] delete failed', { error: String(err) });
        onToast(toastText(err), 'error');
      }
    },
    [projectPath, onToast, post]
  );

  /** Wrap a top-level rule in an at-rule (the `@` above the selector). For `@media`
   *  we optimistically update the card's media context so editing continues; HMR
   *  recompiles the moved rule. */
  const wrapRule = useCallback(
    async (key: string, atPrelude: string) => {
      const row = rowByKeyRef.current.get(key);
      if (!row || !row.editable || row.file == null || row.selector == null) return;
      post({ type: 'ss:suppressReload' });
      try {
        await wrapCssRule(
          projectPath,
          row.file,
          row.selector,
          row.mediaText,
          atPrelude,
          baselineInner.current[key] ?? ''
        );
        const m = atPrelude.trim();
        const cond = m.toLowerCase().startsWith('@media') ? m.slice('@media'.length).trim() : null;
        if (cond)
          setRows((prev) => prev.map((r) => (rowKey(r) === key ? { ...r, mediaText: cond } : r)));
        else onToast('Wrapped — reselect the element to keep editing.', 'success');
        void trackEvent('visual_style_saved', { mode: 'css-code', wrapped: true });
      } catch (err) {
        logger.error('[CssCascade] wrap failed', { error: String(err) });
        onToast(toastText(err), 'error');
      }
    },
    [projectPath, onToast, post]
  );

  /** Create a brand-new rule for `selector` and add it as an editable card you can
   *  style immediately (optimistic — the real cascade refreshes on HMR/reselect). */
  const addSelector = useCallback(
    async (selector: string) => {
      const sel = selector.trim();
      if (!sel) return;

      // Already shown as a base rule? Don't duplicate or error — it's right there.
      const alreadyShown = [...rowByKeyRef.current.values()].some(
        (r) => r.editable && r.selector === sel && !r.mediaText
      );
      if (alreadyShown) return;

      let targetFile = [...rowByKeyRef.current.values()].find((r) => r.editable && r.file)?.file;
      if (!targetFile) {
        try {
          targetFile = (await listStylesheets(projectPath))[0];
        } catch {
          targetFile = undefined;
        }
      }
      if (!targetFile) {
        onToast('No stylesheet found to add the rule to.', 'error');
        return;
      }

      // Pin a rule into the panel as an editable card. Created rules persist across
      // cascade refreshes (see createdRowsRef) so they never silently vanish.
      const pin = (file: string, innerText: string) => {
        const newRow: CascadeRow = {
          index: ++synthIndex.current,
          selector: sel,
          declarations: [],
          specificity: [0, 0, 0],
          mediaText: null,
          mediaMinPx: null,
          inactiveMedia: false,
          layer: null,
          origin: 'author',
          editable: true,
          file,
          line: 0,
          innerText,
        };
        const key = rowKey(newRow);
        const body = parseRuleBody(innerText);
        createdRowsRef.current.set(key, newRow);
        setRows((prev) => [newRow, ...prev.filter((r) => rowKey(r) !== key)]);
        setBodies((prev) => ({ ...prev, [key]: body }));
        bodiesRef.current[key] = body;
        baselineInner.current[key] = innerText;
        setOverridden((prev) => ({ ...prev, [key]: new Map() }));
      };

      post({ type: 'ss:suppressReload' });
      try {
        await createCssRule(projectPath, targetFile, sel);
        pin(targetFile, '\n');
        void trackEvent('visual_style_saved', { mode: 'css-code', created_rule: true });
      } catch (err) {
        const msg = String(err);
        // The rule already exists in source but doesn't match this element (so it
        // isn't in the cascade). Surface the real rule for editing instead of erroring
        // — typing an existing selector should just open it.
        if (msg.includes('already exists')) {
          try {
            const [loc] = await locateCssRules(projectPath, [
              { selector: sel, mediaText: null, href: null },
            ]);
            if (loc?.status === 'resolved') {
              pin(loc.file, loc.inner_text);
              return;
            }
          } catch {
            /* fall through to a soft message below */
          }
          // It exists but we couldn't pin it here (e.g. it lives in a sheet we can't
          // open). Don't show a scary validation error — explain plainly.
          onToast(`“${sel}” already exists — open it from its stylesheet.`, 'error');
          return;
        }
        logger.error('[CssCascade] add selector failed', { error: msg });
        onToast(toastText(err), 'error');
      }
    },
    [projectPath, onToast, post]
  );

  /** Change a rule's selector to anything (complex selectors included). Re-keys the
   *  local state so editing continues; HMR/reselect refreshes whether it still
   *  matches the element. */
  const renameSelector = useCallback(
    async (key: string, newSelector: string) => {
      const row = rowByKeyRef.current.get(key);
      const ns = newSelector.trim();
      if (!row || !row.editable || row.file == null || row.selector == null) return;
      if (!ns || ns === row.selector) return;
      post({ type: 'ss:suppressReload' });
      try {
        await renameCssSelector(
          projectPath,
          row.file,
          row.selector,
          row.mediaText,
          baselineInner.current[key] ?? '',
          ns
        );
        const newRow: CascadeRow = { ...row, selector: ns };
        const newKey = rowKey(newRow);
        // Move the per-rule state to the new key.
        if (bodiesRef.current[key]) {
          bodiesRef.current[newKey] = bodiesRef.current[key];
          delete bodiesRef.current[key];
        }
        if (baselineInner.current[key] !== undefined) {
          baselineInner.current[newKey] = baselineInner.current[key];
          delete baselineInner.current[key];
        }
        setRows((prev) => prev.map((r) => (rowKey(r) === key ? newRow : r)));
        setBodies((prev) => {
          if (!(key in prev)) return prev;
          const n = { ...prev };
          n[newKey] = n[key];
          delete n[key];
          return n;
        });
        setOverridden((prev) => {
          if (!(key in prev)) return prev;
          const n = { ...prev };
          n[newKey] = n[key];
          delete n[key];
          return n;
        });
        void trackEvent('visual_style_saved', { mode: 'css-code', renamed: true });
      } catch (err) {
        logger.error('[CssCascade] rename failed', { error: String(err) });
        onToast(toastText(err), 'error');
      }
    },
    [projectPath, onToast, post]
  );

  /** Change the `@media` condition wrapping a rule. Re-keys on the new media; HMR
   *  refreshes the (shared) wrapper's sibling rules. */
  const renameAtRule = useCallback(
    async (key: string, newMedia: string) => {
      const row = rowByKeyRef.current.get(key);
      const nm = newMedia.trim();
      if (!row || !row.editable || row.file == null || row.selector == null || !nm) return;
      if (nm === row.mediaText) return;
      post({ type: 'ss:suppressReload' });
      try {
        await renameCssAtRule(
          projectPath,
          row.file,
          row.selector,
          row.mediaText,
          baselineInner.current[key] ?? '',
          nm
        );
        const minMatch = /min-width\s*:\s*([\d.]+)px/i.exec(nm);
        const newRow: CascadeRow = {
          ...row,
          mediaText: nm,
          mediaMinPx: minMatch ? Math.round(parseFloat(minMatch[1])) : null,
        };
        const newKey = rowKey(newRow);
        if (bodiesRef.current[key]) {
          bodiesRef.current[newKey] = bodiesRef.current[key];
          delete bodiesRef.current[key];
        }
        if (baselineInner.current[key] !== undefined) {
          baselineInner.current[newKey] = baselineInner.current[key];
          delete baselineInner.current[key];
        }
        setRows((prev) => prev.map((r) => (rowKey(r) === key ? newRow : r)));
        setBodies((prev) => {
          if (!(key in prev)) return prev;
          const n = { ...prev };
          n[newKey] = n[key];
          delete n[key];
          return n;
        });
        setOverridden((prev) => {
          if (!(key in prev)) return prev;
          const n = { ...prev };
          n[newKey] = n[key];
          delete n[key];
          return n;
        });
        void trackEvent('visual_style_saved', { mode: 'css-code', renamedAtRule: true });
      } catch (err) {
        logger.error('[CssCascade] rename at-rule failed', { error: String(err) });
        onToast(toastText(err), 'error');
      }
    },
    [projectPath, onToast, post]
  );

  /** Update one card's body model → debounced live preview + auto-save. */
  const setBody = useCallback(
    (key: string, body: RuleBody) => {
      bodiesRef.current = { ...bodiesRef.current, [key]: body };
      setBodies((prev) => ({ ...prev, [key]: body }));
      clearTimeout(previewTimers.current[key]);
      previewTimers.current[key] = setTimeout(() => previewRule(key), PREVIEW_DEBOUNCE_MS);
      clearTimeout(saveTimers.current[key]);
      saveTimers.current[key] = setTimeout(() => void saveRule(key), SAVE_DEBOUNCE_MS);
    },
    [previewRule, saveRule]
  );

  const toggleEditMode = useCallback(() => {
    const turningOn = !editModeOnRef.current;
    editModeOnRef.current = turningOn;
    void trackEvent(turningOn ? 'visual_edit_started' : 'visual_edit_stopped', {
      mode: 'css-code',
    });
    if (!turningOn) {
      clearTimers();
      lastSignatureRef.current = null;
    }
    setEditModeOn((prev) => {
      if (prev) {
        setSelection(null);
        setRows([]);
        setBodies({});
        bodiesRef.current = {};
        baselineInner.current = {};
        setOverridden({});
        setSavingKeys(new Set());
      }
      return !prev;
    });
  }, [clearTimers]);

  // `@keyframes` names defined in the project — suggested as `animation` values.
  const animationSuggestions = useMemo(
    () => existingSelectors.map(keyframesName).filter((n): n is string => n !== null),
    [existingSelectors]
  );

  return {
    editMode,
    toggleEditMode,
    selection,
    rows,
    bodies,
    overridden,
    setBody,
    deleteRule,
    wrapRule,
    addSelector,
    renameSelector,
    renameAtRule,
    classSuggestions,
    existingSelectors,
    variableSuggestions,
    animationSuggestions,
    loading,
    savingKeys,
  };
}
