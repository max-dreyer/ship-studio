/**
 * Modal for configuring project settings.
 *
 * Currently supports setting the dev server port.
 * The parent component handles persistence via Tauri commands.
 */

import { useState, useEffect, useCallback } from 'react';
import { InlineEditorConfigPanel } from './InlineEditorConfig';
import { ClientManagement } from './ClientManagement';
import type { Session } from '@supabase/supabase-js';
import '../styles/notifications.css';

interface ProjectSettingsModalProps {
  currentPort: number;
  onSave: (port: number) => void;
  onClose: () => void;
  /** Only shown for generic (non-web-framework) projects */
  customDevCommand?: string | null;
  onSaveDevCommand?: (command: string | null) => void;
  isWebProject?: boolean;
  /** Inline editor props (optional — shown when Supabase is configured) */
  inlineEditor?: {
    projectPath: string;
    repoUrl: string;
    githubRepoFullName: string;
    defaultBranch: string;
    remoteProjectId: string | null;
    session: Session | null;
    onProjectLinked: (projectId: string, studioId: string) => void;
    onToast: (message: string, type: 'success' | 'error') => void;
  };
}

export function ProjectSettingsModal({
  currentPort,
  onSave,
  onClose,
  customDevCommand,
  onSaveDevCommand,
  isWebProject,
  inlineEditor,
}: ProjectSettingsModalProps) {
  const [port, setPort] = useState(currentPort);
  const [devCommand, setDevCommand] = useState(customDevCommand ?? '');
  const showDevCommand = !isWebProject && onSaveDevCommand;

  const isValid = Number.isInteger(port) && port >= 1 && port <= 65535;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleSave = () => {
    if (isValid) {
      onSave(port);
      if (showDevCommand) {
        const trimmed = devCommand.trim();
        onSaveDevCommand(trimmed || null);
      }
    }
  };

  return (
    <div className="notification-settings-modal" onClick={onClose}>
      <div className="notification-settings-content" onClick={(e) => e.stopPropagation()}>
        <div className="notification-settings-header">
          <h2>Project Settings</h2>
          <p>Configure settings for this project.</p>
        </div>
        <div className="notification-settings-body">
          <div className="notification-setting-section">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                Dev Server Port
              </label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                min={1}
                max={65535}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && isValid) handleSave();
                }}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {!isValid && (
                <span style={{ fontSize: 12, color: 'var(--error, #ef4444)' }}>
                  Port must be between 1 and 65535
                </span>
              )}
              <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                The port Ship Studio uses to connect to your dev server. Default is 3000.
              </span>
            </div>
          </div>
          {showDevCommand && (
            <div className="notification-setting-section">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                  Dev Server Command
                </label>
                <input
                  type="text"
                  value={devCommand}
                  onChange={(e) => setDevCommand(e.target.value)}
                  placeholder="e.g., npm run dev, cargo run"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && isValid) handleSave();
                  }}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: 13,
                    fontFamily: 'var(--font-mono, monospace)',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  If set, this command will start automatically and can be restarted from the
                  toolbar. Leave blank to manage the dev server yourself in the terminal.
                </span>
              </div>
            </div>
          )}
          {inlineEditor && (
            <>
              <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
              <InlineEditorConfigPanel {...inlineEditor} />
              {inlineEditor.remoteProjectId && inlineEditor.session && (
                <>
                  <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                  <ClientManagement
                    projectId={inlineEditor.remoteProjectId}
                    session={inlineEditor.session}
                    onToast={inlineEditor.onToast}
                  />
                </>
              )}
            </>
          )}
        </div>
        <div className="notification-settings-footer">
          <button className="notification-settings-cancel" onClick={onClose}>
            Cancel
          </button>
          <button className="notification-settings-save" onClick={handleSave} disabled={!isValid}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
