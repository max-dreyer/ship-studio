/**
 * Regression tests for `handleImportLocalFolder`'s expected-refusal routing.
 *
 * `register_external_project` refuses some folder picks by design (already
 * registered, home directory, not a project, …) — the backend marks those
 * `CommandError::Expected`, but the tag can't cross IPC, so the frontend
 * re-checks the guidance phrases (issue #518). Those refusals must surface as
 * *info* toasts and *warn* logs: an `'error'` toast re-reports through the
 * toast telemetry pipeline and a `logger.error` files a bug report — for
 * behavior that is working as intended (issue #535).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectLifecycle, type UseProjectLifecycleParams } from './useProjectLifecycle';

vi.mock('../lib/project', () => ({
  getAutoAcceptMode: vi.fn().mockResolvedValue(false),
  setAutoAcceptMode: vi.fn().mockResolvedValue(undefined),
  detectWorkspaces: vi.fn().mockResolvedValue([]),
  getWorkspaceSubpath: vi.fn().mockResolvedValue(''),
  setWorkspaceSubpath: vi.fn().mockResolvedValue(undefined),
  getDevServerDisabled: vi.fn().mockResolvedValue(false),
  setDevServerDisabled: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/github', () => ({
  getProjectGitHubStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock('./useIntegrationStatus', () => ({
  GITHUB_STATUS_FALLBACK: { connected: false },
}));
vi.mock('../lib/external-projects', () => ({
  registerExternalProject: vi.fn(),
  unregisterExternalProject: vi.fn().mockResolvedValue(undefined),
  isProjectExternal: vi.fn().mockResolvedValue(false),
}));
vi.mock('../lib/projectSessions', () => ({
  registerProjectSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/sessionRegistry', () => ({
  sessionRegistry: {
    getOrCreate: vi.fn(),
    resume: vi.fn(),
    getCustomTitles: vi.fn(() => new Map()),
    setTerminalTabs: vi.fn(),
  },
}));
vi.mock('../lib/accounts', () => ({
  assignActiveWorkspaceToNewProject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/agent', () => ({
  getDefaultAgentId: vi.fn(() => 'claude-code'),
}));
vi.mock('../lib/window', () => ({
  setWindowTitle: vi.fn().mockResolvedValue(undefined),
  getWindowLabel: vi.fn(() => 'main'),
  findAndReservePort: vi.fn().mockResolvedValue(3000),
  getProjectWindow: vi.fn().mockResolvedValue(null),
  focusWindowByLabel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../lib/analytics', () => ({
  trackEvent: vi.fn(),
  trackError: vi.fn(),
  setActiveProject: vi.fn(),
}));
vi.mock('../lib/terminalDiagnostics', () => ({
  extractTerminalError: vi.fn(() => null),
}));
vi.mock('../lib/projectIdentity', () => ({
  getProjectId: vi.fn(() => 'proj-id'),
}));
vi.mock('../lib/session', () => ({
  startProjectSession: vi.fn(),
  endProjectSession: vi.fn(() => null),
}));

import { invoke } from '@tauri-apps/api/core';
import { registerExternalProject } from '../lib/external-projects';
import { logger } from '../lib/logger';

type Fn = ReturnType<typeof vi.fn>;

function createParams(overrides?: Partial<UseProjectLifecycleParams>): UseProjectLifecycleParams {
  return {
    currentProject: null,
    setCurrentProject: vi.fn(),
    currentProjectPathRef: { current: null },
    setView: vi.fn(),
    setDevServerPort: vi.fn(),
    startServerForProject: vi.fn().mockResolvedValue('nextjs'),
    isServerRunning: vi.fn(() => false),
    restartDevServer: vi.fn().mockResolvedValue(undefined),
    stopServer: vi.fn().mockResolvedValue(undefined),
    clearNeedsInstall: vi.fn(),
    pasteToActiveTerminal: vi.fn(),
    terminalTabs: [],
    activeTerminalTab: 0,
    restoreTerminalTabs: vi.fn(),
    ensureProjectSeeded: vi.fn(),
    showToast: vi.fn(),
    setCleanupStatus: vi.fn(),
    clearScreenshotInterval: vi.fn(),
    startScreenshotInterval: vi.fn(),
    onPreviewReady: vi.fn(),
    setWorkspaceTab: vi.fn(),
    resetLayout: vi.fn(),
    setProjectGitHubStatus: vi.fn(),
    clearProjectStatuses: vi.fn(),
    fetchBranchInfo: vi.fn().mockResolvedValue(undefined),
    clearBranchState: vi.fn(),
    checkPluginSuggestion: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('handleImportLocalFolder — expected-refusal routing (#518/#535)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes a by-design refusal to an info toast and a warn log', async () => {
    vi.mocked(registerExternalProject).mockRejectedValue({
      type: 'Other',
      message: 'This project is already inside your projects folder. It will appear automatically.',
    });
    const params = createParams();
    const { result } = renderHook(() => useProjectLifecycle(params));

    await act(async () => {
      await result.current.handleImportLocalFolder();
    });

    expect(params.showToast).toHaveBeenCalledWith(
      'This project is already inside your projects folder. It will appear automatically.',
      'info'
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method -- inspecting the logger mock's calls, not invoking it bound
    expect(logger.warn as Fn).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- inspecting the logger mock's calls, not invoking it bound
    expect(logger.error as Fn).not.toHaveBeenCalled();
  });

  it('keeps the friendly already-registered message, as info', async () => {
    vi.mocked(registerExternalProject).mockRejectedValue({
      type: 'Other',
      message: 'This folder is already registered.',
    });
    const params = createParams();
    const { result } = renderHook(() => useProjectLifecycle(params));

    await act(async () => {
      await result.current.handleImportLocalFolder();
    });

    const [message, type] = vi.mocked(params.showToast).mock.calls[0];
    expect(type).toBe('info');
    expect(message).toContain('already in Ship Studio');
  });

  it('still surfaces genuine failures as error toasts and error logs', async () => {
    vi.mocked(registerExternalProject).mockRejectedValue({
      type: 'Io',
      message: 'disk exploded',
    });
    const params = createParams();
    const { result } = renderHook(() => useProjectLifecycle(params));

    await act(async () => {
      await result.current.handleImportLocalFolder();
    });

    expect(params.showToast).toHaveBeenCalledWith('I/O error: disk exploded', 'error');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- inspecting the logger mock's calls, not invoking it bound
    expect(logger.error as Fn).toHaveBeenCalled();
  });
});

describe('handleSelectProject — folder-gone toast routing (#640)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Make ensure_external_project_registered reject; everything else resolves. */
  function rejectRegistration(message: string) {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === 'ensure_external_project_registered'
        ? // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately a plain CommandError object, the shape under test
          Promise.reject({ type: 'Other', message })
        : Promise.resolve(undefined)
    );
  }

  it('shows the Expected "folder no longer exists" case as an info toast', async () => {
    rejectRegistration(
      "The folder '/x/legal-invoice' no longer exists — it may have been moved, renamed, or deleted outside Ship Studio"
    );
    const params = createParams();
    const { result } = renderHook(() => useProjectLifecycle(params));

    await act(async () => {
      await result.current.handleSelectProject({
        name: 'legal-invoice',
        path: '/x/legal-invoice',
        thumbnail: null,
      });
    });

    const [message, type] = vi.mocked(params.showToast).mock.calls[0];
    expect(message).toContain('its folder no longer exists');
    expect(type).toBe('info');
    // eslint-disable-next-line @typescript-eslint/unbound-method -- inspecting the logger mock's calls, not invoking it bound
    expect(logger.error as Fn).not.toHaveBeenCalled();
  });

  it('keeps the unrecognized-location refusal as an error toast', async () => {
    rejectRegistration('Invalid path in validate_project_path: /x/elsewhere');
    const params = createParams();
    const { result } = renderHook(() => useProjectLifecycle(params));

    await act(async () => {
      await result.current.handleSelectProject({
        name: 'elsewhere',
        path: '/x/elsewhere',
        thumbnail: null,
      });
    });

    const [message, type] = vi.mocked(params.showToast).mock.calls[0];
    expect(message).toContain("isn't a recognized project location");
    expect(type).toBe('error');
  });
});

describe('handleToggleDevServer', () => {
  const project = { path: '/p/site', name: 'site' } as UseProjectLifecycleParams['currentProject'];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stops the running server when switching off', async () => {
    const { getDevServerDisabled, setDevServerDisabled } = await import('../lib/project');
    vi.mocked(getDevServerDisabled).mockResolvedValue(false);
    const params = createParams({ currentProject: project });

    const { result } = renderHook(() => useProjectLifecycle(params));
    await act(async () => {
      await result.current.handleToggleDevServer();
    });

    expect(setDevServerDisabled).toHaveBeenCalledWith('/p/site', true);
    expect(params.stopServer).toHaveBeenCalledWith('/p/site');
    expect(params.startServerForProject).not.toHaveBeenCalled();
  });

  it('runs the full start path when switching back on', async () => {
    // Not restartDevServer: stopping drops the project's state entry, so a
    // restart finds no project type, takes none of its branches, and returns
    // having started nothing — the preview then stays empty.
    const { getDevServerDisabled, setDevServerDisabled } = await import('../lib/project');
    vi.mocked(getDevServerDisabled).mockResolvedValue(true);
    const params = createParams({ currentProject: project });

    const { result } = renderHook(() => useProjectLifecycle(params));
    await act(async () => {
      await result.current.handleToggleDevServer();
    });

    expect(setDevServerDisabled).toHaveBeenCalledWith('/p/site', false);
    // Path and name are what matter here; the port comes from helpers this
    // suite mocks away, so asserting its type would test the mock.
    const call = vi.mocked(params.startServerForProject).mock.calls[0];
    expect(call[0]).toBe('/p/site');
    expect(call[1]).toBe('site');
    expect(params.restartDevServer).not.toHaveBeenCalled();
    // The preview reads the port from here; without it the pane has no target.
    expect(params.setDevServerPort).toHaveBeenCalled();
  });
});
