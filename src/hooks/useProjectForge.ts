/**
 * Resolves which forge a project belongs to, for terminology and capability
 * decisions in the UI.
 *
 * Falls back to {@link DEFAULT_FORGE} until the backend answers, so components
 * render immediately with GitHub wording rather than flashing empty labels. For
 * a GitHub project — still the common case — that placeholder is already the
 * right answer and nothing visibly changes when the real one lands.
 *
 * @module hooks/useProjectForge
 */

import { useEffect } from 'react';
import { useAsyncState } from './useAsyncState';
import { ForgeInfo, DEFAULT_FORGE, fetchProjectForge } from '../lib/forge';

/**
 * @param projectPath Project to resolve. An empty path skips the lookup and
 *   keeps the default, which is what an unopened workspace should show.
 */
export function useProjectForge(projectPath: string | null | undefined): ForgeInfo {
  const { data, execute } = useAsyncState<ForgeInfo, [string]>(fetchProjectForge, {
    initial: DEFAULT_FORGE,
  });

  useEffect(() => {
    if (!projectPath) return;
    // useAsyncState owns the mount guard, so a slow answer for a project the
    // user has already navigated away from can't overwrite the current one.
    void execute(projectPath);
  }, [projectPath, execute]);

  return data ?? DEFAULT_FORGE;
}
