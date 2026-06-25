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
import { logger } from '../lib/logger';
import { trackEvent } from '../lib/analytics';
import { asCommandError, formatCommandError } from '../lib/errors';

function toastText(err: unknown): string {
  return formatCommandError(asCommandError(err));
}

const PREVIEW_DEBOUNCE_MS = 120;
const SAVE_DEBOUNCE_MS = 600;

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

  // Project class names for selector autocomplete.
  useEffect(() => {
    if (!editMode) return;
    let cancelled = false;
    void listCssClasses(projectPath)
      .then((cs) => !cancelled && setClassSuggestions(cs))
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
            setRows(merged);
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
      const existing = [...rowByKeyRef.current.values()].find((r) => r.editable && r.file)?.file;
      let targetFile = existing;
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
      post({ type: 'ss:suppressReload' });
      try {
        await createCssRule(projectPath, targetFile, sel);
        const index = ++synthIndex.current;
        const newRow: CascadeRow = {
          index,
          selector: sel,
          declarations: [],
          specificity: [0, 0, 0],
          mediaText: null,
          mediaMinPx: null,
          inactiveMedia: false,
          layer: null,
          origin: 'author',
          editable: true,
          file: targetFile,
          line: 0,
          innerText: '\n',
        };
        const key = rowKey(newRow);
        const body = parseRuleBody('\n');
        setRows((prev) => [newRow, ...prev]);
        setBodies((prev) => ({ ...prev, [key]: body }));
        bodiesRef.current[key] = body;
        baselineInner.current[key] = '\n';
        setOverridden((prev) => ({ ...prev, [key]: new Map() }));
        void trackEvent('visual_style_saved', { mode: 'css-code', created_rule: true });
      } catch (err) {
        logger.error('[CssCascade] add selector failed', { error: String(err) });
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
    loading,
    savingKeys,
  };
}
