/**
 * Hook for workspace layout state management.
 *
 * Manages: log panel visibility, preview visibility, workspace tabs,
 * compact mode view, and pin state.
 */

import { useState, useEffect, useCallback } from 'react';
import { setAlwaysOnTop, enterCompactMode, exitCompactMode, focusWindow } from '../lib/window';
import { logger } from '../lib/logger';

interface UseWorkspaceLayoutParams {
  /** Whether GitHub is connected for the current project */
  isGitHubConnected: boolean;
}

export function useWorkspaceLayout({ isGitHubConnected }: UseWorkspaceLayoutParams) {
  // Log panel visibility
  const [showDevServerLogs, setShowDevServerLogs] = useState(false);
  const [showHealthLogs, setShowHealthLogs] = useState(false);

  // Preview panel visibility
  const [isPreviewHidden, setIsPreviewHidden] = useState(false);

  // Workspace tab state (preview/code/branches/prs/edits)
  const [workspaceTab, setWorkspaceTab] = useState<
    'preview' | 'code' | 'branches' | 'prs' | 'edits'
  >('preview');

  // Compact mode view state
  const [compactView, setCompactView] = useState<'terminal' | 'branches' | 'prs'>('terminal');

  // Always-on-top pin state
  const [isPinned, setIsPinned] = useState(false);

  // Auto-unpin when window is resized to full mode width
  useEffect(() => {
    const COMPACT_BREAKPOINT = 550;

    const handleResize = () => {
      if (window.innerWidth > COMPACT_BREAKPOINT && isPinned) {
        setIsPinned(false);
        setAlwaysOnTop(false).catch((error) => {
          logger.error('Failed to auto-unpin window', { error });
        });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isPinned]);

  // Reset to preview tab if on branches/prs and GitHub is not connected
  // (keep 'code' and 'edits' tabs accessible without GitHub)
  useEffect(() => {
    if (!isGitHubConnected) {
      if (workspaceTab !== 'preview' && workspaceTab !== 'code' && workspaceTab !== 'edits') {
        setWorkspaceTab('preview');
      }
      if (compactView !== 'terminal') {
        setCompactView('terminal');
      }
    }
  }, [isGitHubConnected, workspaceTab, compactView]);

  // Toggle always-on-top pin
  const handlePinToggle = useCallback(async () => {
    const newPinned = !isPinned;
    setIsPinned(newPinned);
    try {
      await setAlwaysOnTop(newPinned);
    } catch (error) {
      logger.error('Failed to toggle always on top', { error });
      setIsPinned(!newPinned); // Revert on failure
    }
  }, [isPinned]);

  // Enter compact mode - resize window and open browser
  const handleEnterCompactMode = useCallback(async (devServerPort: number) => {
    try {
      await enterCompactMode();
      setIsPinned(true);

      setTimeout(() => {
        void (async () => {
          try {
            const { openUrl } = await import('@tauri-apps/plugin-opener');
            await openUrl(`http://localhost:${devServerPort}`);
            setTimeout(() => {
              void focusWindow().catch((error) => {
                logger.error('Failed to refocus window', { error });
              });
            }, 500);
          } catch (error) {
            logger.error('Failed to open browser', { error });
          }
        })();
      }, 100);
    } catch (error) {
      logger.error('Failed to enter compact mode', { error });
      throw error; // Let caller handle toast
    }
  }, []);

  // Exit compact mode and expand to full window
  const handleExpandToFull = useCallback(async () => {
    try {
      await exitCompactMode();
      setIsPinned(true);
    } catch (error) {
      logger.error('Failed to exit compact mode', { error });
    }
  }, []);

  // Reset layout state (when going back to projects)
  const resetLayout = useCallback(() => {
    setShowDevServerLogs(false);
    setShowHealthLogs(false);
  }, []);

  return {
    // Log panel
    showDevServerLogs,
    setShowDevServerLogs,
    showHealthLogs,
    setShowHealthLogs,

    // Preview
    isPreviewHidden,
    setIsPreviewHidden,

    // Tabs
    workspaceTab,
    setWorkspaceTab,
    compactView,
    setCompactView,

    // Pin / compact
    isPinned,
    handlePinToggle,
    handleEnterCompactMode,
    handleExpandToFull,

    // Reset
    resetLayout,
  };
}
