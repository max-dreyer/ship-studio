/**
 * Main application component and state management.
 *
 * This is the root component that orchestrates:
 * - Application views (loading, setup, projects, workspace)
 * - Project management (opening, creating, dev server lifecycle)
 * - Terminal and preview panel coordination
 * - Periodic screenshot capture for thumbnails
 * - Git branch management and status polling
 *
 * ## State Architecture
 *
 * State has been extracted into custom hooks for better organization:
 * - `useToasts` - Toast notification state
 * - `useTerminalManagement` - Terminal tabs and session state
 * - `useIntegrationStatus` - GitHub/Claude integration state
 * - `useScreenshotManagement` - Screenshot capture, crop, and thumbnail state
 * - `useDevServer` - Dev server lifecycle, output buffering, project type
 * - `useWorkspaceLayout` - Layout tabs, log panels, compact mode, pin state
 * - `usePluginState` - Plugin terminal modal and suggestion popup
 * - `useWorkspaceModals` - Workspace modal visibility state (env editor, backups, assets, etc.)
 *
 * @module App
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useToasts } from './hooks/useToasts';
import { useTerminalManagement } from './hooks/useTerminalManagement';
import { usePlugins } from './hooks/usePlugins';
import { useIntegrationStatus } from './hooks/useIntegrationStatus';
import { useScreenshotManagement } from './hooks/useScreenshotManagement';
import { useDevServer } from './hooks/useDevServer';
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout';
import { usePluginState } from './hooks/usePluginState';
import { useWorkspaceModals } from './hooks/useWorkspaceModals';
import { useBranchManagement } from './hooks/useBranchManagement';
import { useNotifications } from './hooks/useNotifications';
import { useProjectLifecycle } from './hooks/useProjectLifecycle';
import { useAppSetup } from './hooks/useAppSetup';
import { ProjectsView } from './components/ProjectsView';
import { WorkspaceView } from './components/WorkspaceView';
import { OnboardingScreen } from './components/setup';
import { Project } from './lib/project';
import { markSetupComplete, getDefaultAgentId as fetchDefaultAgentId } from './lib/setup';
import { initDefaultAgent } from './lib/agent';
import { UpdateBanner } from './components/UpdateBanner';
import { logger } from './lib/logger';
import { trackEvent } from './lib/analytics';
import type { AppView } from './lib/types';
import './styles/index.css';

// Initialize logger
logger.init();

// Track app launch
void trackEvent('app_launched', { $screen_name: 'Dashboard' });

/** Props for the App component */
interface AppProps {
  /** Initial project path from URL parameter (for multi-window support) */
  initialProjectPath?: string | null;
}

function App({ initialProjectPath }: AppProps) {
  const [view, setView] = useState<AppView>('loading');
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const previewRef = useRef<import('./components/Preview').PreviewHandle | null>(null);
  const currentProjectPathRef = useRef<string | null>(null);

  // Terminal tabs management
  const {
    terminalTabs,
    activeTerminalTab,
    terminalSessionId,
    terminalRefsMap,
    maxTerminalTabs,
    setActiveTerminalTab,
    addTerminalTab,
    closeTerminalTab,
    resetTerminals,
    focusActiveTerminal,
    pasteToActiveTerminal,
    switchTabAgent,
    getActiveTabAgent,
  } = useTerminalManagement();

  // Cleanup dev server when window is closed (prevents orphaned processes)
  useEffect(() => {
    const handleBeforeUnload = () => {
      // Stop the dev server synchronously as best we can
      if (devServerRef.current) {
        try {
          devServerRef.current.pty.kill();
        } catch {
          // Ignore errors during cleanup
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- devServerRef is a stable ref declared later in the file
  }, []);

  // Dev server and health check management
  const {
    devServerRef,
    healthPanelRef,
    devServerPort,
    setDevServerPort,
    projectType,
    isRestartingDevServer,
    customDevCommand,
    devServerOutputRef,
    devServerOutputVersion,
    healthOutputRef,
    healthOutputVersion,
    handleHealthOutput,
    handleRestartDevServer: restartDevServer,
    startServerForProject,
    stopServer,
    saveCustomDevCommand,
  } = useDevServer();

  // Notification settings, attention tabs, agent status sound alerts
  const {
    notificationSettings,
    showNotificationSettings,
    setShowNotificationSettings,
    attentionTabs,
    setAttentionTabs,
    createTabStatusHandler,
    handleSaveNotificationSettings,
  } = useNotifications({ activeTerminalTab });

  // Integration states consolidated via reducer for atomic updates
  const {
    integrations,
    isInitialCheckDone,
    refreshAllCliStatuses,
    setProjectGitHubStatus,
    clearProjectStatuses,
    authTerminalConfig,
    handleGitHubConnect: handleGitHubConnectFromOverlay,
    handleAuthTerminalExit,
    closeAuthTerminal,
  } = useIntegrationStatus();

  // Screenshot management
  const {
    isCapturing,
    isCropMode,
    setIsCropMode,
    isCropCapturing,
    isFullPageCapturing,
    screenshotPreviewPath,
    setScreenshotPreviewPath,
    showScreenshotModal,
    setShowScreenshotModal,
    handleCaptureScreenshot,
    handleCaptureFullPage,
    handleCropStart,
    handleCropComplete,
    handleCropCancel,
    handlePreviewReady: onPreviewReady,
    startScreenshotInterval,
    clearScreenshotInterval,
  } = useScreenshotManagement({
    previewRef,
    devServerPort,
    pasteToActiveTerminal,
    currentProjectPathRef,
  });

  // Workspace layout
  const {
    showDevServerLogs,
    setShowDevServerLogs,
    showHealthLogs,
    setShowHealthLogs,
    isPreviewHidden,
    setIsPreviewHidden,
    workspaceTab,
    setWorkspaceTab,
    compactView,
    setCompactView,
    isPinned,
    handlePinToggle,
    handleEnterCompactMode: enterCompact,
    handleExpandToFull,
    resetLayout,
  } = useWorkspaceLayout({
    isGitHubConnected: integrations.projectGithub?.status === 'connected',
  });

  // Plugin state
  const {
    pluginTerminal,
    pluginTerminalExited,
    openPluginTerminal,
    closePluginTerminal,
    handlePluginTerminalExit,
    pluginSuggestion,
    setPluginSuggestion,
    pluginSuggestionInstalling,
    checkPluginSuggestion,
    installSuggestedPlugin,
  } = usePluginState();

  // Workspace modal visibility state
  const {
    showEnvEditor,
    openEnvEditor,
    closeEnvEditor,
    showBackupsModal,
    openBackupsModal,
    closeBackupsModal,
    showAssetsPanel,
    openAssetsPanel,
    closeAssetsPanel,
    isEducationMode,
    setIsEducationMode,
    closeEducation,
    showHelpModal,
    openHelpModal,
    closeHelpModal,
    showSkillsModal,
    openSkillsModal,
    closeSkillsModal,
    showMcpModal,
    openMcpModal,
    closeMcpModal,
    showPluginManager,
    openPluginManager,
    closePluginManager,
    showDevCommandModal,
    openDevCommandModal,
    closeDevCommandModal,
    showProjectSettings,
    openProjectSettings,
    closeProjectSettings,
  } = useWorkspaceModals({ focusActiveTerminal });

  // Toast notifications
  const { toasts, showToast, dismissToast } = useToasts();

  // Branch management (state, polling, conflict handlers)
  const {
    currentBranch,
    branches,
    openPRs,
    hasUncommittedChanges,
    changedFiles,
    showSubmitReview,
    setShowSubmitReview,
    isBranchSwitching,
    gitError,
    setGitError,
    showConflictResolution,
    setShowConflictResolution,
    fetchBranchInfo,
    checkGitStatus,
    handleBranchSwitch,
    handlePublishError,
    handleResolveConflicts,
    handleConflictsResolved,
    clearBranchState,
  } = useBranchManagement({
    currentProject,
    previewRef,
    healthPanelRef,
    showToast,
  });

  // Plugin system
  const {
    plugins: loadedPlugins,
    getSlotPlugins,
    reloadPlugins,
  } = usePlugins(currentProject?.path ?? null);

  // Project lifecycle (selection, creation, import, publish, compact mode, etc.)
  const {
    autoAcceptMode,
    showCreateModal,
    setShowCreateModal,
    importView,
    setImportView,
    setCurrentPreviewPage,
    isPublishing,
    setIsPublishing,
    forcePublishOpen,
    setForcePublishOpen,
    isCompactPublishOpen,
    setIsCompactPublishOpen,
    showAutoAcceptWarning,
    setShowAutoAcceptWarning,
    handleSelectProject,
    handleBackToProjects,
    handleProjectCreated,
    handleImportProject,
    handleProjectImported,
    handleImportLocalFolder,
    handleCreateProject,
    handleRestartDevServer,
    handleEnterCompactMode: enterCompactMode,
    handleGitHubStatusChange,
    handlePreviewReady,
    sendToClaude,
    handleTerminalExit,
    handleToolbarAutoAcceptToggle,
    handleAutoAcceptWarningAccept,
  } = useProjectLifecycle({
    currentProject,
    setCurrentProject,
    currentProjectPathRef,
    setView,
    devServerRef,
    devServerPort,
    setDevServerPort,
    startServerForProject,
    stopServer,
    restartDevServer,
    enterCompact,
    resetTerminals,
    pasteToActiveTerminal,
    showToast,
    clearScreenshotInterval,
    startScreenshotInterval,
    onPreviewReady,
    setShowDevServerLogs,
    setWorkspaceTab,
    resetLayout,
    setProjectGitHubStatus,
    clearProjectStatuses,
    fetchBranchInfo,
    clearBranchState,
    checkPluginSuggestion,
  });

  // Save port handler: persist, update state, close modal, restart dev server
  const handleSavePort = async (newPort: number) => {
    if (!currentProject) return;
    try {
      await invoke('set_dev_server_port', { projectPath: currentProject.path, port: newPort });
      setDevServerPort(newPort);
      closeProjectSettings();
      await restartDevServer(currentProject.path, newPort);
      showToast('Port updated and server restarted', 'success');
    } catch {
      showToast('Failed to save port setting', 'error');
    }
  };

  // Wrapper for compact mode that also clears education mode (UI state stays in App)
  const handleEnterCompactMode = async () => {
    setIsEducationMode(false);
    await enterCompactMode();
  };

  // App setup, onboarding, HMR recovery, auto-open, keyboard shortcuts
  const { projectsLoading, setProjectsLoading } = useAppSetup({
    view,
    setView,
    initialProjectPath,
    setCurrentProject,
    setDevServerPort,
    handleSelectProject,
    refreshAllCliStatuses,
    setProjectGitHubStatus,
    fetchBranchInfo,
    openHelpModal,
  });

  // Stable callbacks for ProjectsView (prevents re-render cascade through ProjectList → ProjectCard)
  const stableSelectProject = useCallback(
    (project: Project) => {
      void handleSelectProject(project);
    },
    [handleSelectProject]
  );

  const stableImportLocalFolder = useCallback(() => {
    void handleImportLocalFolder();
  }, [handleImportLocalFolder]);

  const stableCloseCreateModal = useCallback(() => setShowCreateModal(false), [setShowCreateModal]);

  const stableAuthTerminalExit = useCallback(
    (exitCode: number | null) => {
      void handleAuthTerminalExit(exitCode, currentProject?.path);
    },
    [handleAuthTerminalExit, currentProject?.path]
  );

  // Stable callback for WorkspaceView auth terminal exit
  const stableWorkspaceAuthExit = useCallback(
    (exitCode: number | null, projectPath?: string) => {
      void handleAuthTerminalExit(exitCode, projectPath);
    },
    [handleAuthTerminalExit]
  );

  // Plugin data for PluginSlot components (defined before early returns so all views can use them)
  const pluginProject = useMemo(
    () =>
      currentProject
        ? {
            name: currentProject.name,
            path: currentProject.path,
            currentBranch: currentBranch || 'main',
            hasUncommittedChanges,
            devServerUrl: `http://localhost:${String(devServerPort)}`,
            gitRemoteUrl: integrations.projectGithub?.github_url ?? undefined,
          }
        : null,
    [
      currentProject,
      currentBranch,
      hasUncommittedChanges,
      devServerPort,
      integrations.projectGithub?.github_url,
    ]
  );

  const pluginActions = useMemo(
    () => ({
      showToast,
      refreshGitStatus: () => {
        if (currentProject) void fetchBranchInfo(currentProject.path);
      },
      refreshBranches: () => {
        if (currentProject) void fetchBranchInfo(currentProject.path);
      },
      focusTerminal: focusActiveTerminal,
      openUrl: (url: string) => {
        void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url));
      },
      openTerminal: openPluginTerminal,
    }),
    [showToast, currentProject, fetchBranchInfo, focusActiveTerminal, openPluginTerminal]
  );

  const pluginTheme = useMemo(
    () => ({
      bgPrimary: 'var(--bg-primary)',
      bgSecondary: 'var(--bg-secondary)',
      bgTertiary: 'var(--bg-tertiary)',
      textPrimary: 'var(--text-primary)',
      textSecondary: 'var(--text-secondary)',
      textMuted: 'var(--text-muted)',
      border: 'var(--border)',
      accent: 'var(--accent, #10b981)',
      accentHover: 'var(--accent-hover)',
      action: 'var(--action)',
      actionHover: 'var(--action-hover)',
      actionText: 'var(--action-text)',
      error: 'var(--error)',
      success: 'var(--success)',
    }),
    []
  );

  if (view === 'loading') {
    return (
      <div className="app loading">
        <img src="/ship_studio_full_noshadow.svg" alt="Ship Studio" className="app-logo" />
        <div className="spinner" />
      </div>
    );
  }

  if (view === 'onboarding') {
    const handleOnboardingComplete = async () => {
      // Re-hydrate default agent cache (may have been set during onboarding)
      const defaultAgent = await fetchDefaultAgentId();
      initDefaultAgent(defaultAgent);
      // Persist that setup is complete so future launches are fast
      await markSetupComplete();
      // Refresh CLI states and go to projects directly (don't re-enter onboarding)
      await refreshAllCliStatuses();
      setView('projects');
    };

    return (
      <div className="app">
        <UpdateBanner />
        <OnboardingScreen onComplete={() => void handleOnboardingComplete()} />
      </div>
    );
  }

  if (view === 'projects') {
    return (
      <ProjectsView
        onSelectProject={stableSelectProject}
        onCreateProject={handleCreateProject}
        onImportProject={handleImportProject}
        onImportLocalFolder={stableImportLocalFolder}
        isGitHubAuthenticated={integrations.github.cliStatus.authenticated}
        githubUsername={integrations.github.username}
        isAuthCheckDone={isInitialCheckDone}
        onGitHubConnect={handleGitHubConnectFromOverlay}
        showCreateModal={showCreateModal}
        onCloseCreateModal={stableCloseCreateModal}
        onProjectCreated={handleProjectCreated}
        importView={importView}
        setImportView={setImportView}
        onProjectImported={handleProjectImported}
        authTerminalConfig={authTerminalConfig}
        closeAuthTerminal={closeAuthTerminal}
        onAuthTerminalExit={stableAuthTerminalExit}
        pluginProject={pluginProject}
        pluginActions={pluginActions}
        pluginTheme={pluginTheme}
        getSlotPlugins={getSlotPlugins}
        projectsLoading={projectsLoading}
        onLoadingChange={setProjectsLoading}
      />
    );
  }

  if (view === 'project-loading') {
    return (
      <div className="app loading">
        <div className="spinner" />
        <p>Opening {currentProject?.name}...</p>
      </div>
    );
  }

  // Workspace view
  return (
    <WorkspaceView
      currentProject={currentProject!}
      previewRef={previewRef}
      terminal={{
        terminalTabs,
        activeTerminalTab,
        terminalSessionId,
        terminalRefsMap,
        maxTerminalTabs,
        setActiveTerminalTab,
        addTerminalTab,
        closeTerminalTab,
        focusActiveTerminal,
        switchTabAgent,
        getActiveTabAgent,
      }}
      devServer={{
        hasDevServer: !!devServerRef.current,
        healthPanelRef,
        devServerPort,
        projectType,
        isRestartingDevServer,
        customDevCommand,
        devServerOutput: devServerOutputRef.current,
        devServerOutputVersion,
        healthOutput: healthOutputRef.current,
        healthOutputVersion,
        handleHealthOutput,
      }}
      notifications={{
        notificationSettings,
        showNotificationSettings,
        setShowNotificationSettings,
        attentionTabs,
        setAttentionTabs,
        createTabStatusHandler,
        handleSaveNotificationSettings,
      }}
      integrationStatus={{
        integrations,
        handleGitHubConnect: handleGitHubConnectFromOverlay,
        authTerminalConfig,
        closeAuthTerminal,
        handleAuthTerminalExit: stableWorkspaceAuthExit,
      }}
      screenshots={{
        isCapturing,
        isCropMode,
        setIsCropMode,
        isCropCapturing,
        isFullPageCapturing,
        screenshotPreviewPath,
        setScreenshotPreviewPath,
        showScreenshotModal,
        setShowScreenshotModal,
        handleCaptureScreenshot,
        handleCaptureFullPage,
        handleCropStart,
        handleCropComplete,
        handleCropCancel,
      }}
      layout={{
        showDevServerLogs,
        setShowDevServerLogs,
        showHealthLogs,
        setShowHealthLogs,
        isPreviewHidden,
        setIsPreviewHidden,
        workspaceTab,
        setWorkspaceTab,
        compactView,
        setCompactView,
        isPinned,
        handlePinToggle,
        handleExpandToFull,
      }}
      pluginState={{
        pluginTerminal,
        pluginTerminalExited,
        closePluginTerminal,
        handlePluginTerminalExit,
        pluginSuggestion,
        setPluginSuggestion,
        pluginSuggestionInstalling,
        installSuggestedPlugin,
      }}
      modals={{
        showEnvEditor,
        openEnvEditor,
        closeEnvEditor,
        showBackupsModal,
        openBackupsModal,
        closeBackupsModal,
        showAssetsPanel,
        openAssetsPanel,
        closeAssetsPanel,
        isEducationMode,
        setIsEducationMode,
        closeEducation,
        showHelpModal,
        openHelpModal,
        closeHelpModal,
        showSkillsModal,
        openSkillsModal,
        closeSkillsModal,
        showMcpModal,
        openMcpModal,
        closeMcpModal,
        showPluginManager,
        openPluginManager,
        closePluginManager,
        showDevCommandModal,
        openDevCommandModal,
        closeDevCommandModal,
        showProjectSettings,
        openProjectSettings,
        closeProjectSettings,
      }}
      toasts={{ toasts, showToast, dismissToast }}
      branchMgmt={{
        currentBranch,
        branches,
        openPRs,
        hasUncommittedChanges,
        changedFiles,
        showSubmitReview,
        setShowSubmitReview,
        isBranchSwitching,
        gitError,
        setGitError,
        showConflictResolution,
        setShowConflictResolution,
        fetchBranchInfo,
        checkGitStatus,
        handleBranchSwitch,
        handlePublishError,
        handleResolveConflicts,
        handleConflictsResolved,
      }}
      plugins={{ loadedPlugins, getSlotPlugins, reloadPlugins }}
      lifecycle={{
        autoAcceptMode,
        setCurrentPreviewPage,
        isPublishing,
        setIsPublishing,
        forcePublishOpen,
        setForcePublishOpen,
        isCompactPublishOpen,
        setIsCompactPublishOpen,
        showAutoAcceptWarning,
        setShowAutoAcceptWarning,
        handleBackToProjects,
        handleRestartDevServer,
        handleGitHubStatusChange,
        handlePreviewReady,
        sendToClaude,
        handleTerminalExit,
        handleToolbarAutoAcceptToggle,
        handleAutoAcceptWarningAccept,
        handleSaveDevCommand: (cmd: string | null) => {
          if (currentProject) void saveCustomDevCommand(currentProject.path, cmd);
        },
        handleSavePort: (port: number) => void handleSavePort(port),
      }}
      pluginProject={pluginProject}
      pluginActions={pluginActions}
      pluginTheme={pluginTheme}
      handleEnterCompactMode={handleEnterCompactMode}
    />
  );
}

export default App;
