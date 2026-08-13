/**
 * Comment mode: the state behind pinning notes to preview elements and handing
 * them to the agent.
 *
 * Owns the note list, the pending composer, and the conversation with the
 * preview iframe. The iframe is the only thing that can resolve a `dom_path`
 * to a position on screen, so pins work as a request/response: we send the
 * `{id, domPath}` pairs we care about, it answers with where they are now.
 *
 * Sending is deliberately two-phase. The notes go to the terminal first, and
 * only the ids the terminal confirms are marked sent — a paste that never
 * landed must not quietly empty the user's list.
 *
 * @module hooks/usePreviewComments
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addPreviewComment,
  buildAgentMessage,
  clearSentPreviewComments,
  deletePreviewComment,
  listPreviewComments,
  markPreviewCommentsSent,
  reanchorPreviewComment,
  updatePreviewComment,
  type PreviewComment,
} from '../lib/comments';
import { asCommandError, formatCommandError } from '../lib/errors';
import { logger } from '../lib/logger';

/** Where a pin sits in the preview, in iframe coordinates. */
export interface PinPosition {
  id: string;
  x: number;
  y: number;
  /** False when the iframe could no longer find the element. */
  found: boolean;
}

/** A click on an element while comment mode is armed. */
export interface PendingNote {
  domPath: string;
  label: string;
  /** True when the path also matches siblings — the note may drift. */
  ambiguous: boolean;
  /** Where the composer opens, in iframe coordinates. */
  x: number;
  y: number;
  /** Set when re-anchoring an existing note rather than creating one. */
  movingId?: string;
}

interface Params {
  projectPath: string;
  /** Current preview URL, stored with each note so the panel can group. */
  pageUrl: string;
  enabled: boolean;
  /** Send text to the agent terminal. Resolves false if nothing received it. */
  onSendToAgent?: (text: string) => boolean | Promise<boolean>;
  onToast?: (message: string, kind?: 'success' | 'error') => void;
}

/** Messages we send into the preview. */
type HostMessage =
  | { type: 'ss:comments:arm'; armed: boolean }
  | { type: 'ss:comments:track'; pins: { id: string; domPath: string }[] };

export function usePreviewComments({
  projectPath,
  pageUrl,
  enabled,
  onSendToAgent,
  onToast,
}: Params) {
  const [comments, setComments] = useState<PreviewComment[]>([]);
  const [pending, setPending] = useState<PendingNote | null>(null);
  const [positions, setPositions] = useState<PinPosition[]>([]);
  const [sending, setSending] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  /** Attach the iframe the preview is currently showing. */
  const setIframe = useCallback((el: HTMLIFrameElement | null) => {
    iframeRef.current = el;
  }, []);

  const post = useCallback((message: HostMessage) => {
    iframeRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  const refresh = useCallback(async () => {
    if (!projectPath) return;
    try {
      setComments(await listPreviewComments(projectPath));
    } catch (err) {
      logger.warn('[comments] could not load notes', {
        error: formatCommandError(asCommandError(err)),
      });
    }
  }, [projectPath]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Arm or disarm the in-page click handler with the mode.
  useEffect(() => {
    post({ type: 'ss:comments:arm', armed: enabled });
    if (!enabled) {
      setPending(null);
      setPositions([]);
    }
  }, [enabled, post]);

  /** Notes on the page currently shown — the only ones with a visible pin. */
  const onThisPage = useMemo(
    () => comments.filter((c) => (c.url || '/') === (pageUrl || '/')),
    [comments, pageUrl]
  );

  // Ask the iframe where this page's notes currently are.
  useEffect(() => {
    if (!enabled) return;
    post({
      type: 'ss:comments:track',
      pins: onThisPage.map((c) => ({ id: c.id, domPath: c.dom_path })),
    });
  }, [enabled, onThisPage, post]);

  // Replies from the preview: a click to comment on, or fresh pin positions.
  useEffect(() => {
    if (!enabled) return;
    const onMessage = (e: MessageEvent) => {
      const data = e.data as
        | {
            type: 'ss:comments:clicked';
            domPath: string;
            label: string;
            ambiguous?: boolean;
            x: number;
            y: number;
          }
        | { type: 'ss:comments:positions'; positions: PinPosition[] }
        | undefined;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'ss:comments:clicked') {
        setPending({
          domPath: data.domPath,
          label: data.label,
          ambiguous: !!data.ambiguous,
          x: data.x,
          y: data.y,
        });
      } else if (data.type === 'ss:comments:positions') {
        setPositions(data.positions);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [enabled]);

  const cancelPending = useCallback(() => setPending(null), []);

  /** Save the composer's text, either as a new note or a re-anchor. */
  const commitPending = useCallback(
    async (text: string) => {
      if (!pending) return;
      const trimmed = text.trim();
      if (!trimmed) {
        setPending(null);
        return;
      }
      try {
        if (pending.movingId) {
          await reanchorPreviewComment(
            projectPath,
            pending.movingId,
            pending.domPath,
            pending.label
          );
        } else {
          await addPreviewComment(projectPath, {
            // crypto.randomUUID is available in the webview and in jsdom 22+.
            id: crypto.randomUUID(),
            dom_path: pending.domPath,
            url: pageUrl || '/',
            label: pending.label,
            text: trimmed,
            added_at: Date.now(),
            sent: false,
          });
        }
        setPending(null);
        await refresh();
      } catch (err) {
        onToast?.(formatCommandError(asCommandError(err)), 'error');
      }
    },
    [onToast, pageUrl, pending, projectPath, refresh]
  );

  const editNote = useCallback(
    async (id: string, text: string) => {
      try {
        await updatePreviewComment(projectPath, id, text);
        await refresh();
      } catch (err) {
        onToast?.(formatCommandError(asCommandError(err)), 'error');
      }
    },
    [onToast, projectPath, refresh]
  );

  const removeNote = useCallback(
    async (id: string) => {
      try {
        await deletePreviewComment(projectPath, id);
        await refresh();
      } catch (err) {
        onToast?.(formatCommandError(asCommandError(err)), 'error');
      }
    },
    [onToast, projectPath, refresh]
  );

  /** Start moving an existing note; the next preview click re-anchors it. */
  const startMove = useCallback(
    (id: string) => {
      const note = comments.find((c) => c.id === id);
      if (!note) return;
      if (note.sent) {
        onToast?.(
          "That note has already gone to the agent, so it can't be moved. Delete it and leave a new one.",
          'error'
        );
        return;
      }
      setPending({
        domPath: note.dom_path,
        label: note.label,
        ambiguous: false,
        x: 0,
        y: 0,
        movingId: id,
      });
    },
    [comments, onToast]
  );

  const unsent = useMemo(() => comments.filter((c) => !c.sent), [comments]);

  /**
   * Hand the unsent notes to the agent.
   *
   * Marks them sent only if the terminal reports it took the text. A send that
   * reached nothing leaves every note where it was.
   */
  const sendToAgent = useCallback(async () => {
    if (unsent.length === 0 || !onSendToAgent) return;
    setSending(true);
    try {
      const delivered = await onSendToAgent(buildAgentMessage(unsent));
      if (!delivered) {
        onToast?.('Nothing received the notes, so they were left unsent.', 'error');
        return;
      }
      await markPreviewCommentsSent(
        projectPath,
        unsent.map((c) => c.id)
      );
      await refresh();
      onToast?.(unsent.length === 1 ? 'Note sent' : `${unsent.length} notes sent`, 'success');
    } catch (err) {
      onToast?.(formatCommandError(asCommandError(err)), 'error');
    } finally {
      setSending(false);
    }
  }, [onSendToAgent, onToast, projectPath, refresh, unsent]);

  const clearSent = useCallback(async () => {
    try {
      await clearSentPreviewComments(projectPath);
      await refresh();
    } catch (err) {
      onToast?.(formatCommandError(asCommandError(err)), 'error');
    }
  }, [onToast, projectPath, refresh]);

  return {
    comments,
    onThisPage,
    unsent,
    positions,
    pending,
    sending,
    setIframe,
    cancelPending,
    commitPending,
    editNote,
    removeNote,
    startMove,
    sendToAgent,
    clearSent,
    refresh,
  };
}
