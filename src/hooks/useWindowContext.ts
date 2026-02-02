/**
 * Hook for accessing the current window's context.
 *
 * Provides the window label and related utilities for multi-window support.
 * Each window has a unique label (e.g., "main", "main-2", "main-3") that
 * is used to track which project is open in which window.
 *
 * @module hooks/useWindowContext
 */

import { useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Hook that returns the current window's label.
 *
 * The label is used to:
 * - Register which project is open in this window
 * - Track PTY processes per window for cleanup
 * - Prevent the same project from being opened in multiple windows
 *
 * @returns Object containing the window label (defaults to "main")
 */
export function useWindowContext() {
  // Initialize synchronously to avoid race conditions where actions
  // might happen before the useEffect runs (e.g., clicking a project
  // immediately after window opens would use 'main' instead of 'main-2')
  const [windowLabel] = useState(() => {
    try {
      return getCurrentWebviewWindow().label;
    } catch {
      // Fallback to 'main' if Tauri isn't ready or we're in browser context
      return 'main';
    }
  });

  return { windowLabel };
}
