/**
 * ProfilesModal — create and manage credential profiles.
 *
 * A profile groups all credentials for one context (Personal, Work, Company X…):
 * Anthropic API key, GitHub token, Vercel token, Figma token, OpenAI key, and
 * git identity. Each project is assigned to a profile; Ship Studio injects those
 * credentials automatically when running CLI tools for that project.
 *
 * @module components/profiles/ProfilesModal
 */

import { useEffect, useState, useCallback } from 'react';
import { ModalFrame } from '../primitives/ModalFrame';
import { Button } from '../primitives/Button';
import { Spinner } from '../primitives/Spinner';
import { useModal } from '../../contexts/ModalContext';
import {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  getProfileCredentialStatus,
  setProfileCredential,
  clearProfileCredential,
  CREDENTIAL_LABELS,
  PROFILE_COLORS,
  STATUS_FIELD_TO_KEY,
  SENSITIVE_KEYS,
  type Profile,
  type ProfileCredentialStatus,
  type CredentialKey,
} from '../../lib/profiles';
import { useOptionalToast } from '../../contexts/ToastContext';
import '../../styles/features/profiles-modal.css';

interface EditingCred {
  key: CredentialKey;
  value: string;
}

export function ProfilesModal() {
  const { isOpen, close } = useModal('profiles');
  const { showToast } = useOptionalToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Per-profile edit state
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(PROFILE_COLORS[0]);
  const [isSaving, setIsSaving] = useState(false);

  const [credStatus, setCredStatus] = useState<ProfileCredentialStatus | null>(null);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [editingCred, setEditingCred] = useState<EditingCred | null>(null);
  const [isSavingCred, setIsSavingCred] = useState(false);
  const [showValues, setShowValues] = useState<Set<CredentialKey>>(new Set());

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(PROFILE_COLORS[1]);

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null;

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listProfiles();
      setProfiles(list);
      if (!selectedId && list.length > 0) {
        setSelectedId(list[0].id);
      }
    } catch (e) {
      showToast(`Failed to load profiles: ${String(e)}`, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [selectedId, showToast]);

  const loadCredStatus = useCallback(async (profileId: string) => {
    setIsLoadingCreds(true);
    setCredStatus(null);
    try {
      const status = await getProfileCredentialStatus(profileId);
      setCredStatus(status);
    } finally {
      setIsLoadingCreds(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void loadProfiles();
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedProfile) {
      setEditName(selectedProfile.name);
      setEditColor(selectedProfile.color);
      setEditingCred(null);
      void loadCredStatus(selectedProfile.id);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveProfile = async () => {
    if (!selectedProfile || !editName.trim()) return;
    setIsSaving(true);
    try {
      const updated = await updateProfile(selectedProfile.id, editName, editColor);
      setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      showToast('Profile updated', 'success');
    } catch (e) {
      showToast(`Failed to update: ${String(e)}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedProfile || selectedProfile.isDefault) return;
    const confirmed = window.confirm(
      `Delete profile "${selectedProfile.name}"? Projects using it will be reassigned to Default.`
    );
    if (!confirmed) return;
    try {
      await deleteProfile(selectedProfile.id);
      const remaining = profiles.filter((p) => p.id !== selectedProfile.id);
      setProfiles(remaining);
      setSelectedId(remaining[0]?.id ?? null);
      showToast('Profile deleted', 'success');
    } catch (e) {
      showToast(`Failed to delete: ${String(e)}`, 'error');
    }
  };

  const handleCreateProfile = async () => {
    if (!newName.trim()) return;
    setIsSaving(true);
    try {
      const created = await createProfile(newName.trim(), newColor);
      setProfiles((prev) => [...prev, created]);
      setSelectedId(created.id);
      setIsCreating(false);
      setNewName('');
      setNewColor(PROFILE_COLORS[1]);
    } catch (e) {
      showToast(`Failed to create: ${String(e)}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCred = async () => {
    if (!selectedProfile || !editingCred || !editingCred.value.trim()) return;
    setIsSavingCred(true);
    try {
      await setProfileCredential(selectedProfile.id, editingCred.key, editingCred.value);
      setEditingCred(null);
      await loadCredStatus(selectedProfile.id);
      showToast('Credential saved', 'success');
    } catch (e) {
      showToast(`Failed to save: ${String(e)}`, 'error');
    } finally {
      setIsSavingCred(false);
    }
  };

  const handleClearCred = async (key: CredentialKey) => {
    if (!selectedProfile) return;
    try {
      await clearProfileCredential(selectedProfile.id, key);
      await loadCredStatus(selectedProfile.id);
      showToast('Credential removed', 'success');
    } catch (e) {
      showToast(`Failed to clear: ${String(e)}`, 'error');
    }
  };

  const toggleShowValue = (key: CredentialKey) => {
    setShowValues((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const credRows = credStatus
    ? (Object.entries(STATUS_FIELD_TO_KEY) as [keyof ProfileCredentialStatus, CredentialKey][])
    : [];

  return (
    <ModalFrame isOpen={isOpen} onClose={close} title="Profiles" className="profiles-modal-frame">
      <div className="profiles-modal">
        {/* ── Sidebar ── */}
        <aside className="profiles-sidebar">
          <div className="profiles-sidebar-list">
            {isLoading ? (
              <div
                style={{ display: 'flex', justifyContent: 'center', padding: 'var(--spacing-md)' }}
              >
                <Spinner size="sm" />
              </div>
            ) : (
              profiles.map((p) => (
                <button
                  key={p.id}
                  className={`profile-sidebar-item ${p.id === selectedId ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedId(p.id);
                    setIsCreating(false);
                  }}
                >
                  <span className="profile-color-dot" style={{ background: p.color }} />
                  <span className="profile-sidebar-item-name">{p.name}</span>
                </button>
              ))
            )}
          </div>
          <div className="profiles-sidebar-add">
            <Button
              variant="secondary"
              size="sm"
              block
              onClick={() => {
                setIsCreating(true);
                setSelectedId(null);
              }}
            >
              + New Profile
            </Button>
          </div>
        </aside>

        {/* ── Detail ── */}
        <div className="profiles-detail">
          {isCreating ? (
            <>
              <div className="profiles-detail-scroll">
                <div>
                  <div className="profiles-section-title">New Profile</div>
                  <div
                    className="profiles-header-row"
                    style={{ marginBottom: 'var(--spacing-md)' }}
                  >
                    <input
                      className="profiles-name-input"
                      placeholder="Profile name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void handleCreateProfile()}
                      autoFocus
                    />
                  </div>
                  <div className="profiles-section-title">Color</div>
                  <div className="profiles-color-picker">
                    {PROFILE_COLORS.map((c) => (
                      <button
                        key={c}
                        className={`profiles-color-swatch ${c === newColor ? 'selected' : ''}`}
                        style={{ background: c }}
                        onClick={() => setNewColor(c)}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div className="profiles-detail-footer">
                <Button variant="ghost" size="sm" onClick={() => setIsCreating(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void handleCreateProfile()}
                  disabled={!newName.trim() || isSaving}
                >
                  {isSaving ? <Spinner size="sm" /> : 'Create'}
                </Button>
              </div>
            </>
          ) : selectedProfile ? (
            <>
              <div className="profiles-detail-scroll">
                {/* Name + color */}
                <div>
                  <div className="profiles-section-title">Profile</div>
                  <div className="profiles-header-row">
                    <input
                      className="profiles-name-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      disabled={selectedProfile.isDefault}
                      placeholder="Profile name"
                    />
                  </div>
                  {!selectedProfile.isDefault && (
                    <div style={{ marginTop: 'var(--spacing-sm)' }}>
                      <div className="profiles-section-title">Color</div>
                      <div className="profiles-color-picker">
                        {PROFILE_COLORS.map((c) => (
                          <button
                            key={c}
                            className={`profiles-color-swatch ${c === editColor ? 'selected' : ''}`}
                            style={{ background: c }}
                            onClick={() => setEditColor(c)}
                            title={c}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Credentials */}
                <div>
                  <div className="profiles-section-title">Credentials</div>
                  {isLoadingCreds ? (
                    <Spinner size="sm" />
                  ) : (
                    <div className="profiles-cred-list">
                      {credRows.map(([statusField, key]) => {
                        const isSet = credStatus ? credStatus[statusField] : false;
                        const isEditing = editingCred?.key === key;
                        const isSensitive = SENSITIVE_KEYS.has(key);
                        const revealed = showValues.has(key);

                        return (
                          <div key={key} className="profiles-cred-row">
                            <span className="profiles-cred-label">{CREDENTIAL_LABELS[key]}</span>
                            <div className="profiles-cred-status">
                              {isEditing ? (
                                <div className="profiles-cred-input-row">
                                  <input
                                    className="profiles-cred-input"
                                    type={isSensitive && !revealed ? 'password' : 'text'}
                                    value={editingCred.value}
                                    onChange={(e) => setEditingCred({ key, value: e.target.value })}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') void handleSaveCred();
                                      if (e.key === 'Escape') setEditingCred(null);
                                    }}
                                    autoFocus
                                    placeholder={isSensitive ? '••••••••' : ''}
                                  />
                                  {isSensitive && (
                                    <button
                                      className="toolbar-icon-btn"
                                      style={{ padding: '2px 6px', fontSize: 11 }}
                                      onClick={() => toggleShowValue(key)}
                                      title={revealed ? 'Hide' : 'Show'}
                                    >
                                      {revealed ? 'Hide' : 'Show'}
                                    </button>
                                  )}
                                  <div className="profiles-cred-actions">
                                    <Button
                                      variant="primary"
                                      size="sm"
                                      onClick={() => void handleSaveCred()}
                                      disabled={!editingCred.value.trim() || isSavingCred}
                                    >
                                      {isSavingCred ? <Spinner size="sm" /> : 'Save'}
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setEditingCred(null)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <span
                                    className={`profiles-cred-badge ${isSet ? 'set' : 'unset'}`}
                                  >
                                    {isSet ? 'Set' : 'Not set'}
                                  </span>
                                  <div className="profiles-cred-actions">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setEditingCred({ key, value: '' })}
                                    >
                                      {isSet ? 'Update' : 'Set'}
                                    </Button>
                                    {isSet && (
                                      <Button
                                        variant="danger"
                                        size="sm"
                                        onClick={() => void handleClearCred(key)}
                                      >
                                        Clear
                                      </Button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="profiles-detail-footer">
                {selectedProfile.isDefault ? (
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
                    The Default profile cannot be renamed or deleted.
                  </span>
                ) : (
                  <Button variant="danger" size="sm" onClick={() => void handleDelete()}>
                    Delete Profile
                  </Button>
                )}
                {!selectedProfile.isDefault && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void handleSaveProfile()}
                    disabled={!editName.trim() || isSaving}
                  >
                    {isSaving ? <Spinner size="sm" /> : 'Save Changes'}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="profiles-empty">Select a profile or create a new one.</div>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}
