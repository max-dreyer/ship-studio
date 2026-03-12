/**
 * Client management panel — invite clients, list current clients,
 * view pending invitations.
 */

import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '../lib/supabase';
import { InviteClientModal } from './InviteClientModal';
import type { ProjectClient, ProjectInvite } from '@shipstudio/shared';
import type { Session } from '@supabase/supabase-js';

interface ClientManagementProps {
  projectId: string;
  session: Session;
  onToast: (message: string, type: 'success' | 'error') => void;
}

export function ClientManagement({ projectId, session, onToast }: ClientManagementProps) {
  const [clients, setClients] = useState<ProjectClient[]>([]);
  const [invites, setInvites] = useState<ProjectInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  const fetchClients = useCallback(async () => {
    const supabase = getSupabase();

    const [clientsRes, invitesRes] = await Promise.all([
      supabase
        .from('project_clients')
        .select('*, profile:profiles(email, full_name, avatar_url)')
        .eq('project_id', projectId),
      supabase
        .from('invites')
        .select('*')
        .eq('project_id', projectId)
        .is('accepted_at', null)
        .order('created_at', { ascending: false }),
    ]);

    if (clientsRes.data) setClients(clientsRes.data as unknown as ProjectClient[]);
    if (invitesRes.data) setInvites(invitesRes.data as ProjectInvite[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void fetchClients(); // eslint-disable-line react-hooks/set-state-in-effect -- intentional: fetch data on mount
  }, [fetchClients]);

  const handleRemoveClient = useCallback(
    async (clientId: string) => {
      const supabase = getSupabase();
      const { error } = await supabase.from('project_clients').delete().eq('id', clientId);

      if (error) {
        onToast('Failed to remove client', 'error');
      } else {
        onToast('Client removed', 'success');
        await fetchClients();
      }
    },
    [fetchClients, onToast]
  );

  if (loading) {
    return (
      <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13 }}>Loading clients…</div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
          Clients ({clients.filter((c) => c.role === 'editor').length})
        </label>
        <button
          className="btn-secondary"
          onClick={() => setShowInvite(true)}
          style={{ padding: '4px 12px', fontSize: 12 }}
        >
          Invite Client
        </button>
      </div>

      {/* Client list */}
      {clients.filter((c) => c.role === 'editor').length === 0 && invites.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16 }}>
          No clients yet. Invite someone to start editing.
        </p>
      )}

      {clients
        .filter((c) => c.role === 'editor')
        .map((client) => (
          <div
            key={client.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              background: 'var(--bg-primary)',
              borderRadius: 6,
              border: '1px solid var(--border)',
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                {client.profile?.full_name || client.profile?.email || 'Unknown'}
              </div>
              {client.profile?.email && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {client.profile.email}
                </div>
              )}
            </div>
            <button
              onClick={() => void handleRemoveClient(client.id)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                fontSize: 16,
                padding: '0 4px',
              }}
              title="Remove client"
            >
              ×
            </button>
          </div>
        ))}

      {/* Pending invites */}
      {invites.length > 0 && (
        <>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Pending Invites
          </label>
          {invites.map((invite) => (
            <div
              key={invite.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                background: 'var(--bg-primary)',
                borderRadius: 6,
                border: '1px dashed var(--border)',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{invite.email}</span>
              <span
                style={{
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  background: 'var(--bg-tertiary)',
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                Pending
              </span>
            </div>
          ))}
        </>
      )}

      {/* Invite modal */}
      {showInvite && (
        <InviteClientModal
          projectId={projectId}
          accessToken={session.access_token}
          onClose={() => setShowInvite(false)}
          onInvited={() => {
            setShowInvite(false);
            void fetchClients();
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}
