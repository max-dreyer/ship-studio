/**
 * Inline editor config panel — rendered inside ProjectSettingsModal.
 *
 * Allows developers to enable/disable the inline editor, configure
 * allowed domains, copy the script tag, and manage editing mode.
 */

import { useState, useCallback, useEffect } from 'react';
import {
  enableInlineEditor,
  getEditorConfig,
  updateEditorConfig,
  generateScriptTag,
  getInstallationForRepo,
  getGitHubAppInstallUrl,
  type GitHubInstallation,
} from '../lib/inline-editor';
import type { InlineEditorConfig } from '@shipstudio/shared';
import type { Session } from '@supabase/supabase-js';

interface InlineEditorConfigProps {
  projectPath: string;
  repoUrl: string;
  githubRepoFullName: string;
  defaultBranch: string;
  remoteProjectId: string | null;
  session: Session | null;
  onProjectLinked: (projectId: string, studioId: string) => void;
  onToast: (message: string, type: 'success' | 'error') => void;
}

export function InlineEditorConfigPanel({
  repoUrl,
  githubRepoFullName,
  defaultBranch,
  remoteProjectId,
  session,
  onProjectLinked,
  onToast,
}: InlineEditorConfigProps) {
  const [config, setConfig] = useState<InlineEditorConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [domainInput, setDomainInput] = useState('');
  const [githubInstallation, setGithubInstallation] = useState<GitHubInstallation | null>(null);
  const [checkingGithub, setCheckingGithub] = useState(false);

  // Load existing config
  useEffect(() => {
    if (!remoteProjectId || !session) return;

    setLoading(true);
    getEditorConfig(remoteProjectId)
      .then((cfg) => setConfig(cfg))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [remoteProjectId, session]);

  // Check GitHub App installation when auto-apply is enabled
  useEffect(() => {
    if (!config?.auto_apply || !githubRepoFullName || !session) return;

    setCheckingGithub(true);
    getInstallationForRepo(githubRepoFullName)
      .then((install) => setGithubInstallation(install))
      .catch(() => setGithubInstallation(null))
      .finally(() => setCheckingGithub(false));
  }, [config?.auto_apply, githubRepoFullName, session]);

  const handleConnectGitHub = useCallback(async () => {
    const url = getGitHubAppInstallUrl();
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  }, []);

  const handleEnable = useCallback(async () => {
    if (!session?.access_token) {
      onToast('Please sign in first', 'error');
      return;
    }

    setEnabling(true);
    try {
      const result = await enableInlineEditor(
        {
          repo_url: repoUrl,
          github_repo_full_name: githubRepoFullName,
          default_branch: defaultBranch,
          allowed_domains: [],
        },
        session.access_token
      );

      setConfig(result.config);
      onProjectLinked(result.project_id, result.studio_id);
      onToast('Inline editor enabled!', 'success');
    } catch (err) {
      onToast(err instanceof Error ? err.message : 'Failed to enable', 'error');
    } finally {
      setEnabling(false);
    }
  }, [session, repoUrl, githubRepoFullName, defaultBranch, onProjectLinked, onToast]);

  const handleToggle = useCallback(async () => {
    if (!config) return;

    const prev = config;
    setConfig({ ...config, is_enabled: !config.is_enabled });
    try {
      await updateEditorConfig(config.id, { is_enabled: !config.is_enabled });
    } catch {
      setConfig(prev);
      onToast('Failed to update config', 'error');
    }
  }, [config, onToast]);

  const handleAddDomain = useCallback(async () => {
    if (!config || !domainInput.trim()) return;

    const newDomains = [...(config.allowed_domains || []), domainInput.trim()];
    try {
      const updated = await updateEditorConfig(config.id, {
        allowed_domains: newDomains,
      });
      setConfig(updated);
      setDomainInput('');
      onToast('Domain added', 'success');
    } catch {
      onToast('Failed to add domain', 'error');
    }
  }, [config, domainInput, onToast]);

  const handleRemoveDomain = useCallback(
    async (domain: string) => {
      if (!config) return;

      const newDomains = (config.allowed_domains || []).filter((d) => d !== domain);
      try {
        const updated = await updateEditorConfig(config.id, {
          allowed_domains: newDomains,
        });
        setConfig(updated);
      } catch {
        onToast('Failed to remove domain', 'error');
      }
    },
    [config, onToast]
  );

  const handleAutoApplyToggle = useCallback(async () => {
    if (!config) return;

    const prev = config;
    setConfig({ ...config, auto_apply: !config.auto_apply });
    try {
      await updateEditorConfig(config.id, { auto_apply: !config.auto_apply });
    } catch {
      setConfig(prev);
      onToast('Failed to update auto-apply setting', 'error');
    }
  }, [config, onToast]);

  const copyScriptTag = useCallback(() => {
    if (!config) return;
    void navigator.clipboard.writeText(generateScriptTag(config.studio_id));
    onToast('Script tag copied!', 'success');
  }, [config, onToast]);

  if (loading) {
    return (
      <div className="notification-setting-section">
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading config…</p>
      </div>
    );
  }

  // Not yet enabled
  if (!config) {
    return (
      <div className="notification-setting-section">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
            Inline Editor
          </label>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Let clients edit text, images, and metadata directly on your live site. Edits are
            captured as diffs for your review.
          </span>
          <button
            className="btn-primary"
            onClick={() => void handleEnable()}
            disabled={enabling || !session}
            style={{ marginTop: 4, alignSelf: 'flex-start', padding: '6px 16px' }}
          >
            {enabling ? 'Enabling…' : 'Enable Inline Editor'}
          </button>
          {!session && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Sign in to Ship Studio to enable this feature.
            </span>
          )}
        </div>
      </div>
    );
  }

  // Enabled — show config
  return (
    <div className="notification-setting-section">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
            Inline Editor
          </label>
          <button
            className={config.is_enabled ? 'btn-primary' : 'btn-secondary'}
            onClick={() => void handleToggle()}
            style={{ padding: '4px 12px', fontSize: 12 }}
          >
            {config.is_enabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        {/* Studio ID */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Studio ID</label>
          <code
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              background: 'var(--bg-primary)',
              padding: '4px 8px',
              borderRadius: 4,
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {config.studio_id}
          </code>
        </div>

        {/* Script Tag */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Script Tag</label>
          <div
            style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 8,
              fontSize: 11,
              fontFamily: 'var(--font-mono, monospace)',
              color: 'var(--text-secondary)',
              whiteSpace: 'pre',
              lineHeight: 1.4,
              cursor: 'pointer',
            }}
            onClick={copyScriptTag}
            title="Click to copy"
          >
            {generateScriptTag(config.studio_id)}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Click to copy. Paste this into your site&apos;s HTML.
          </span>
        </div>

        {/* Allowed Domains */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Allowed Domains</label>
          {(config.allowed_domains || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {config.allowed_domains.map((domain) => (
                <span
                  key={domain}
                  style={{
                    background: 'var(--bg-tertiary)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  {domain}
                  <button
                    onClick={() => void handleRemoveDomain(domain)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: 14,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              type="text"
              value={domainInput}
              onChange={(e) => setDomainInput(e.target.value)}
              placeholder="example.com or *.example.com"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAddDomain();
              }}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: 4,
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: 12,
                outline: 'none',
              }}
            />
            <button
              className="btn-secondary"
              onClick={() => void handleAddDomain()}
              style={{ padding: '4px 10px', fontSize: 12 }}
            >
              Add
            </button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Leave empty to allow all domains. Use *.domain.com for wildcards.
          </span>
        </div>

        {/* Auto-Apply */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Automatically Apply Updates
            </label>
            <button
              className={config.auto_apply ? 'btn-primary' : 'btn-secondary'}
              onClick={() => void handleAutoApplyToggle()}
              style={{ padding: '4px 12px', fontSize: 12 }}
            >
              {config.auto_apply ? 'On' : 'Off'}
            </button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            When enabled, client edits are automatically applied to your codebase without manual
            review. When disabled, edits stay in the review queue until you approve them.
          </span>

          {/* GitHub Connection Status (shown when auto-apply is on) */}
          {config.auto_apply && (
            <div
              style={{
                marginTop: 4,
                padding: '8px 10px',
                borderRadius: 6,
                border: `1px solid ${githubInstallation ? 'var(--border)' : 'rgba(234, 179, 8, 0.3)'}`,
                background: githubInstallation ? 'var(--bg-primary)' : 'rgba(234, 179, 8, 0.05)',
              }}
            >
              {checkingGithub ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Checking GitHub connection...
                </span>
              ) : githubInstallation ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#22c55e',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    Connected to <strong>{githubInstallation.github_account_login}</strong>
                    {githubInstallation.repository_selection === 'all'
                      ? ' (all repos)'
                      : ` (${githubRepoFullName})`}
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'rgb(234, 179, 8)', lineHeight: 1.4 }}>
                    Auto-apply requires the Ship Studio GitHub App to be installed on{' '}
                    <strong>{githubRepoFullName}</strong> so it can create pull requests.
                  </span>
                  <button
                    className="btn-primary"
                    onClick={() => void handleConnectGitHub()}
                    style={{ alignSelf: 'flex-start', padding: '4px 12px', fontSize: 11 }}
                  >
                    Connect GitHub
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
