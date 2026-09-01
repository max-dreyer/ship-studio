/**
 * What the Link section can offer as a target: this project's pages and the
 * files in its assets folder.
 *
 * Both are read from disk, not from the running preview, so the pickers work
 * before the dev server is up. Loaded on first use rather than with the panel:
 * a project with a large assets folder shouldn't pay for a list nobody opened.
 *
 * A failed lookup leaves the list empty and says so. The URL field stays
 * editable either way — a picker that can't load must not take the ability to
 * type a path with it.
 *
 * @module hooks/useLinkTargets
 */

import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listAssets, getAssetsRoot, DEFAULT_ASSETS_ROOT } from '../lib/assets';
import type { PageInfo } from './usePreviewConnection';
import { logger } from '../lib/logger';
import { asCommandError, formatCommandError } from '../lib/errors';

export interface LinkTargets {
  /** Routes this project serves, e.g. `/`, `/about`, `/blog/[slug]`. */
  pages: string[];
  /** Files under the assets root, as the paths they're served at (`/logo.svg`). */
  files: string[];
  /** The folder `files` came from, for a hint the user can check against. */
  assetsRoot: string;
  loading: boolean;
  /** Set when a lookup failed, so the section can say the list is incomplete. */
  error: string | null;
}

type Loaded = Omit<LinkTargets, 'loading'>;

const NOTHING: Loaded = { pages: [], files: [], assetsRoot: DEFAULT_ASSETS_ROOT, error: null };

export function useLinkTargets(projectPath: string, enabled: boolean): LinkTargets {
  // Keyed by project so a result that arrives after the user switched projects
  // is ignored rather than shown against the wrong one.
  const [loaded, setLoaded] = useState<{ key: string; targets: Loaded } | null>(null);

  useEffect(() => {
    if (!enabled || !projectPath) return;
    let cancelled = false;

    const load = async () => {
      // Settled, not all: a project with no pages directory should still get
      // its file list, and vice versa.
      const [pages, assets, root] = await Promise.allSettled([
        invoke<PageInfo[]>('list_pages', { projectPath }),
        listAssets(projectPath),
        getAssetsRoot(projectPath),
      ]);
      if (cancelled) return;

      const failures = [pages, assets, root].filter((r) => r.status === 'rejected');
      for (const failure of failures) {
        logger.warn('[LinkTargets] could not load link targets', {
          error: formatCommandError(asCommandError(failure.reason)),
        });
      }

      setLoaded({
        key: projectPath,
        targets: {
          pages: pages.status === 'fulfilled' ? pages.value.map((p) => p.route) : [],
          files:
            assets.status === 'fulfilled'
              ? assets.value
                  .filter((a) => !a.isDirectory)
                  .map((a) => `/${a.path}`)
                  .sort((a, b) => a.localeCompare(b))
              : [],
          assetsRoot: root.status === 'fulfilled' ? root.value : DEFAULT_ASSETS_ROOT,
          error: failures.length > 0 ? 'Some targets could not be listed.' : null,
        },
      });
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [projectPath, enabled]);

  const fresh = loaded?.key === projectPath ? loaded.targets : null;
  return fresh
    ? { ...fresh, loading: false }
    : { ...NOTHING, loading: enabled && projectPath.length > 0 };
}
