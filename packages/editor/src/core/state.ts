/**
 * Editor state machine: idle → active → editing → submitting
 */

import type { InlineEditorConfig, EditSubmission } from '@shipstudio/shared';
import type { RealtimeChannel, User } from '@supabase/supabase-js';

type EditorPhase = 'idle' | 'active' | 'editing' | 'submitting';

interface State {
  phase: EditorPhase;
  config: InlineEditorConfig | null;
  projectId: string | null;
  studioId: string | null;
  user: User | null;
  pendingEdits: EditSubmission[];
  channel: RealtimeChannel | null;
}

const state: State = {
  phase: 'idle',
  config: null,
  projectId: null,
  studioId: null,
  user: null,
  pendingEdits: [],
  channel: null,
};

const listeners: Array<(phase: EditorPhase) => void> = [];

export const EditorState = {
  getPhase: () => state.phase,
  getConfig: () => state.config,
  getProjectId: () => state.projectId,
  getStudioId: () => state.studioId,
  getUser: () => state.user,
  getPendingEdits: () => state.pendingEdits,

  setConfig: (config: InlineEditorConfig) => {
    state.config = config;
  },

  setProjectId: (id: string) => {
    state.projectId = id;
  },

  setStudioId: (id: string) => {
    state.studioId = id;
  },

  setUser: (user: User) => {
    state.user = user;
  },

  setChannel: (channel: RealtimeChannel | null) => {
    state.channel = channel;
  },

  getChannel: () => state.channel,

  transition: (phase: EditorPhase) => {
    state.phase = phase;
    listeners.forEach((fn) => fn(phase));
  },

  addEdit: (edit: EditSubmission) => {
    state.pendingEdits.push(edit);
    listeners.forEach((fn) => fn(state.phase));
  },

  clearEdits: () => {
    state.pendingEdits = [];
    listeners.forEach((fn) => fn(state.phase));
  },

  onPhaseChange: (fn: (phase: EditorPhase) => void) => {
    listeners.push(fn);
    return () => {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  },

  destroy: () => {
    state.channel?.unsubscribe();
    state.phase = 'idle';
    state.config = null;
    state.projectId = null;
    state.studioId = null;
    state.user = null;
    state.pendingEdits = [];
    state.channel = null;
    listeners.length = 0;
  },
};
