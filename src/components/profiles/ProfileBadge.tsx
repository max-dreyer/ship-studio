/**
 * ProfileBadge — shows the active profile for the current project.
 *
 * Displays a colored dot + profile name. Clicking opens the Profiles modal.
 * Renders nothing while the profile is loading.
 *
 * @module components/profiles/ProfileBadge
 */

import { useEffect, useState } from 'react';
import { useOpenModal } from '../../contexts/ModalContext';
import { listProfiles, getProjectProfileId, type Profile } from '../../lib/profiles';

interface ProfileBadgeProps {
  projectPath: string;
}

export function ProfileBadge({ projectPath }: ProfileBadgeProps) {
  const openModal = useOpenModal();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [profiles, profileId] = await Promise.all([
          listProfiles(),
          getProjectProfileId(projectPath),
        ]);
        if (!cancelled) {
          setProfile(profiles.find((p) => p.id === profileId) ?? profiles[0] ?? null);
        }
      } catch {
        // silently ignore — badge just won't render
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  if (!profile) return null;

  return (
    <button
      className="profile-badge"
      onClick={() => openModal('profiles')}
      title={`Profile: ${profile.name} — click to manage`}
    >
      <span className="profile-badge-dot" style={{ background: profile.color }} />
      {profile.name}
    </button>
  );
}
