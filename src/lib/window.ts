/**
 * Window management utilities for multi-window support.
 *
 * These functions interact with the Rust backend to track which projects
 * are open in which windows, preventing conflicts when multiple windows
 * are open.
 *
 * @module lib/window
 */

import { invoke } from '@tauri-apps/api/core';

/**
 * Get all currently open projects and their windows.
 *
 * @returns A map of window label to project path
 */
export async function getOpenProjects(): Promise<Record<string, string>> {
  return invoke<Record<string, string>>('get_open_projects');
}

/**
 * Check if a project is open in any window.
 *
 * @param projectPath - The path of the project to check
 * @returns The window label if open, null otherwise
 */
export async function isProjectOpen(projectPath: string): Promise<string | null> {
  return invoke<string | null>('is_project_open', { projectPath });
}

/**
 * Register that a project is now open in a specific window.
 *
 * This should be called when opening a project. It will fail if the
 * project is already open in another window.
 *
 * @param windowLabel - The label of the window opening the project
 * @param projectPath - The path of the project being opened
 * @throws Error if the project is already open in another window
 */
export async function registerProjectOpen(windowLabel: string, projectPath: string): Promise<void> {
  return invoke<void>('register_project_open', { windowLabel, projectPath });
}

/**
 * Unregister the project for a window.
 *
 * This should be called when closing a project (going back to the
 * project list) or when the window is closed.
 *
 * @param windowLabel - The label of the window to unregister
 */
export async function unregisterProject(windowLabel: string): Promise<void> {
  return invoke<void>('unregister_project', { windowLabel });
}

/**
 * Register the dev server port for a window.
 *
 * This is used to track which port each window's dev server is using.
 *
 * @param windowLabel - The label of the window
 * @param port - The port number being used
 */
export async function registerWindowPort(windowLabel: string, port: number): Promise<void> {
  return invoke<void>('register_window_port', { windowLabel, port });
}

/**
 * Atomically allocate and register a port for this window.
 *
 * This combines finding an available port and registering it in a single
 * operation to prevent race conditions where multiple windows could get
 * the same port.
 *
 * @param windowLabel - The label of the window
 * @param preferredPort - The preferred port number (will find next available if taken)
 * @returns The allocated port number
 */
export async function allocateWindowPort(
  windowLabel: string,
  preferredPort: number
): Promise<number> {
  return invoke<number>('allocate_window_port', { windowLabel, preferredPort });
}

/**
 * Create a new Ship Studio window.
 *
 * @returns The label of the newly created window
 */
export async function createNewWindow(): Promise<string> {
  return invoke<string>('create_new_window');
}

/**
 * Register which window owns a PTY process.
 *
 * This should be called after spawn_pty returns the PTY ID.
 * It enables per-window cleanup when a window is closed.
 *
 * @param ptyId - The PTY ID returned by spawn_pty
 * @param windowLabel - The label of the window that owns this PTY
 */
export async function registerPtyWindow(ptyId: number, windowLabel: string): Promise<void> {
  return invoke<void>('register_pty_window', { ptyId, windowLabel });
}
