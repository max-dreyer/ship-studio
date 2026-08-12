/**
 * Browser detection and URL opening utilities.
 *
 * Provides functions for:
 * - Checking which browsers are installed on the system
 * - Opening URLs in a specific browser
 *
 * @module lib/browser
 */

import { invoke } from '@tauri-apps/api/core';

/** Information about an available browser */
export interface BrowserInfo {
  /** Unique identifier (e.g., "chrome", "safari") */
  id: string;
  /** Display name (e.g., "Google Chrome", "Safari") */
  name: string;
}

/**
 * Check which browsers are available on the system.
 * @returns List of installed browsers
 */
export async function checkBrowserAvailability(): Promise<BrowserInfo[]> {
  // Bundle-based discovery finds every installed browser, including ones in
  // ~/Applications and ones nobody put on a list. It is macOS-only; elsewhere
  // it returns nothing and the older path-checking command still applies.
  try {
    const discovered = await invoke<BrowserInfo[]>('discover_browsers');
    if (discovered.length > 0) return discovered;
  } catch {
    // Fall through — an older backend simply doesn't have the command.
  }
  return invoke<BrowserInfo[]>('check_browser_availability');
}

/**
 * Open a URL in a specific browser.
 * @param url - The URL to open
 * @param browserId - The browser identifier (e.g., "chrome", "safari")
 */
export async function openUrlInBrowser(url: string, browserId: string): Promise<void> {
  return invoke('open_url_in_browser', { url, browserId });
}
