/**
 * Hook for managing client edits state with Supabase Realtime subscriptions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSupabase, isSupabaseConfigured } from '../lib/supabase';
import { fetchEdits, countPendingEdits, approveEdit, rejectEdit } from '../lib/inline-edits';
import type { InlineEdit, EditStatus } from '@shipstudio/shared';
import { logger } from '../lib/logger';

interface UseClientEditsParams {
  projectId: string | null;
  userId: string | null;
}

export function useClientEdits({ projectId, userId }: UseClientEditsParams) {
  const [edits, setEdits] = useState<InlineEdit[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<EditStatus | 'all'>('all');
  const hasLoadedRef = useRef(false);

  // Fetch edits (only show loading spinner on initial load)
  const refresh = useCallback(async () => {
    if (!projectId || !isSupabaseConfigured()) return;

    if (!hasLoadedRef.current) {
      setLoading(true);
    }
    try {
      const status = filter === 'all' ? undefined : filter;
      const [fetchedEdits, count] = await Promise.all([
        fetchEdits(projectId, status),
        countPendingEdits(projectId),
      ]);
      setEdits(fetchedEdits);
      setPendingCount(count);
      hasLoadedRef.current = true;
    } catch (err) {
      logger.error('Failed to fetch edits', { error: err });
    } finally {
      setLoading(false);
    }
  }, [projectId, filter]);

  // Initial fetch
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Supabase Realtime subscription
  useEffect(() => {
    if (!projectId || !isSupabaseConfigured()) return;

    const supabase = getSupabase();
    const channel = supabase
      .channel(`project-edits-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'inline_edits',
          filter: `project_id=eq.${projectId}`,
        },
        () => {
          // Refresh on any change
          void refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [projectId, refresh]);

  const handleApprove = useCallback(
    async (editId: string) => {
      if (!userId) return;
      try {
        await approveEdit(editId, userId);
        // Realtime subscription will trigger refresh automatically
      } catch (err) {
        logger.error('Failed to approve edit', { error: err });
        throw err;
      }
    },
    [userId]
  );

  const handleReject = useCallback(
    async (editId: string, note?: string) => {
      if (!userId) return;
      try {
        await rejectEdit(editId, userId, note);
        // Realtime subscription will trigger refresh automatically
      } catch (err) {
        logger.error('Failed to reject edit', { error: err });
        throw err;
      }
    },
    [userId]
  );

  return {
    edits,
    pendingCount,
    loading,
    filter,
    setFilter,
    refresh,
    handleApprove,
    handleReject,
  };
}
