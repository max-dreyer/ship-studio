/**
 * Element Settings controller — backs the "Settings" tab of the cascade editor
 * (Stacki's Style/Settings split). Edits the selected element's MARKUP rather than
 * its CSS:
 *   - CLASSES: add/remove via the className resolver/editor (`lib/edit`), with a
 *     live `ss:mutate` so the page updates immediately. Fully editable.
 *   - TAG / ATTRIBUTES: read from the element's source HTML (`lib/edit-html`) and
 *     shown for reference. (Editing tag/attributes is a fast-follow — markup
 *     rewrites need care.)
 *
 * Security: only the preview iframe's own contentWindow is trusted.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  resolveClassnameSource,
  applyClassnameEdit,
  applyClassnameEditMulti,
  type ElementSignature,
} from '../lib/edit';
import { resolveElementHtml } from '../lib/edit-html';
import { logger } from '../lib/logger';
import { trackEvent } from '../lib/analytics';
import { asCommandError, formatCommandError } from '../lib/errors';

function toastText(err: unknown): string {
  return formatCommandError(asCommandError(err));
}

export interface ElementAttr {
  name: string;
  value: string;
}

export interface ElementSettings {
  tag: string;
  classes: string[];
  attributes: ElementAttr[];
  addClass: (name: string) => void;
  removeClass: (name: string) => void;
  busy: boolean;
}

/** Parse the attributes of an element's opening tag (excluding `class`, which the
 *  CLASSES editor owns). Best-effort, string/quote aware via a global regex. */
function parseAttributes(html: string): ElementAttr[] {
  const open = /^<([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(html.trim());
  if (!open) return [];
  const attrsPart = open[2];
  const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  const out: ElementAttr[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrsPart)) !== null) {
    const name = m[1];
    if (name.toLowerCase() === 'class') continue;
    out.push({ name, value: m[2] ?? m[3] ?? m[4] ?? '' });
  }
  return out;
}

interface Params {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  projectPath: string;
  enabled: boolean;
  signature: ElementSignature | null;
  onToast: (message: string, type?: 'success' | 'error') => void;
}

export function useElementSettings({
  iframeRef,
  projectPath,
  enabled,
  signature,
  onToast,
}: Params): ElementSettings {
  const [classes, setClasses] = useState<string[]>([]);
  const [attributes, setAttributes] = useState<ElementAttr[]>([]);
  const [busy, setBusy] = useState(false);

  const sigRef = useRef<ElementSignature | null>(signature);
  sigRef.current = signature;
  const tag = signature?.tagName ?? '';

  const post = useCallback(
    (msg: unknown) => iframeRef.current?.contentWindow?.postMessage(msg, '*'),
    [iframeRef]
  );

  // Seed classes from the signature; resolve the element's markup for attributes.
  useEffect(() => {
    if (!enabled || !signature) {
      setClasses([]);
      setAttributes([]);
      return;
    }
    setClasses(signature.className.split(/\s+/).filter(Boolean));
    let cancelled = false;
    void resolveElementHtml(projectPath, signature)
      .then((res) => !cancelled && setAttributes(parseAttributes(res.html)))
      .catch(() => !cancelled && setAttributes([]));
    return () => {
      cancelled = true;
    };
  }, [enabled, projectPath, signature]);

  /** Rewrite the element's `class` attribute in source (and live in the preview). */
  const writeClassAttr = useCallback(
    async (nextClass: string): Promise<boolean> => {
      const sig = sigRef.current;
      if (!sig) return false;
      const res = await resolveClassnameSource(projectPath, sig);
      if (res.status !== 'resolved' && res.status !== 'multi') {
        onToast("Can't edit this element's classes in source — change them in code.", 'error');
        return false;
      }
      const prev = res.class_name;
      if (nextClass === prev) return true;
      post({ type: 'ss:suppressReload' });
      if (res.status === 'resolved') {
        await applyClassnameEdit(projectPath, res.file, res.line, prev, nextClass);
      } else {
        await applyClassnameEditMulti(projectPath, res.locations, prev, nextClass);
      }
      const nextSig = { ...sig, className: nextClass };
      sigRef.current = nextSig;
      post({ type: 'ss:mutate', className: nextClass, rules: [] });
      post({ type: 'ss:commit' });
      return true;
    },
    [projectPath, onToast, post]
  );

  const addClass = useCallback(
    async (name: string) => {
      const n = name.trim().replace(/^\./, '');
      if (!n || classes.includes(n)) return;
      setBusy(true);
      try {
        const next = [...classes, n];
        if (await writeClassAttr(next.join(' '))) {
          setClasses(next);
          void trackEvent('visual_class_added', { mode: 'css-code' });
        }
      } catch (err) {
        logger.error('[ElementSettings] add class failed', { error: String(err) });
        onToast(toastText(err), 'error');
      } finally {
        setBusy(false);
      }
    },
    [classes, writeClassAttr, onToast]
  );

  const removeClass = useCallback(
    async (name: string) => {
      setBusy(true);
      try {
        const next = classes.filter((c) => c !== name);
        if (await writeClassAttr(next.join(' '))) {
          setClasses(next);
          void trackEvent('visual_class_removed', { mode: 'css-code' });
        }
      } catch (err) {
        logger.error('[ElementSettings] remove class failed', { error: String(err) });
        onToast(toastText(err), 'error');
      } finally {
        setBusy(false);
      }
    },
    [classes, writeClassAttr, onToast]
  );

  return {
    tag,
    classes,
    attributes,
    addClass: (n) => void addClass(n),
    removeClass: (n) => void removeClass(n),
    busy,
  };
}
