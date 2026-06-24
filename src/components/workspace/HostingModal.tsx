/**
 * HostingModal — native hosting-provider picker for a project.
 *
 * Replaces the old per-project hosting *plugins* (Vercel / Cloudflare / Netlify)
 * with a first-class native choice. Opened via Cmd+K → "Hosting". The selection
 * persists to `.shipstudio/project.json` (`hosting_provider`).
 *
 * Backwards-compat: on open we resolve the *effective* provider via
 * `detectHostingProvider`, which falls back to inferring from a real link config
 * (`.vercel` / `.netlify`) or an installed hosting plugin — so projects set up
 * before this existed pre-select the right provider automatically.
 *
 * @module components/HostingModal
 */

import { useEffect, useState } from 'react';
import { useModal } from '../../contexts/ModalContext';
import { useOptionalToast } from '../../contexts/ToastContext';
import { ModalFrame } from '../primitives/ModalFrame';
import { Spinner } from '../primitives/Spinner';
import {
  detectHostingProvider,
  getHostingProvider,
  setHostingProvider,
  type HostingProvider,
} from '../../lib/project';

interface HostingModalProps {
  /** Absolute path to the project directory */
  projectPath: string;
}

interface ProviderMeta {
  id: HostingProvider;
  name: string;
  tagline: string;
  /** Brand color used for the badge + selected accent. */
  color: string;
  /** Monogram shown in the badge. */
  mark: string;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: 'vercel',
    name: 'Vercel',
    tagline: 'Deploys via your GitHub integration on push.',
    color: 'var(--hosting-vercel)',
    mark: '▲',
  },
  {
    id: 'netlify',
    name: 'Netlify',
    tagline: 'Builds locally, then uploads with the Netlify CLI.',
    color: 'var(--hosting-netlify)',
    mark: 'N',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Pages',
    tagline: 'Builds locally, then deploys with Wrangler.',
    color: 'var(--hosting-cloudflare)',
    mark: 'C',
  },
];

export function HostingModal({ projectPath }: HostingModalProps) {
  const { isOpen, close } = useModal('hosting');
  const { showToast } = useOptionalToast();

  const [selected, setSelected] = useState<HostingProvider | null>(null);
  /** Whether `selected` came from an explicit prior choice vs. inference. */
  const [wasExplicit, setWasExplicit] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Resolve the effective + explicit provider whenever the modal opens.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    Promise.all([detectHostingProvider(projectPath), getHostingProvider(projectPath)])
      .then(([effective, explicit]) => {
        if (cancelled) return;
        setSelected(effective);
        setWasExplicit(explicit !== null);
      })
      .catch(() => {
        if (cancelled) return;
        setSelected(null);
        setWasExplicit(false);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, projectPath]);

  if (!isOpen) return null;

  const choose = async (provider: HostingProvider) => {
    if (isSaving) return;
    const previous = selected;
    setSelected(provider); // optimistic
    setIsSaving(true);
    try {
      await setHostingProvider(projectPath, provider);
      setWasExplicit(true);
      showToast(`Hosting set to ${PROVIDERS.find((p) => p.id === provider)?.name}`, 'success');
    } catch (err) {
      setSelected(previous); // revert on failure
      showToast(`Couldn't save hosting choice: ${String(err)}`, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Only surface the "detected" hint when the pre-selection was inferred, not
  // an explicit prior choice.
  const showDetectedHint = !isLoading && selected !== null && !wasExplicit;

  return (
    <ModalFrame isOpen={isOpen} onClose={close} title="Hosting" className="hosting-modal">
      <p className="hosting-modal-subtitle">Choose where this project deploys.</p>

      {isLoading ? (
        <div className="hosting-modal-loading">
          <Spinner />
        </div>
      ) : (
        <div className="hosting-provider-list" role="radiogroup" aria-label="Hosting provider">
          {PROVIDERS.map((p) => {
            const active = selected === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={active}
                className={`hosting-provider-card${active ? ' active' : ''}`}
                style={active ? { borderColor: p.color } : undefined}
                disabled={isSaving}
                onClick={() => void choose(p.id)}
              >
                <span className="hosting-provider-badge" style={{ background: p.color }}>
                  {p.mark}
                </span>
                <span className="hosting-provider-text">
                  <span className="hosting-provider-name">{p.name}</span>
                  <span className="hosting-provider-tagline">{p.tagline}</span>
                </span>
                <span className="hosting-provider-check" aria-hidden="true">
                  {active ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {showDetectedHint && (
        <p className="hosting-modal-detected">
          Detected from your existing setup — choosing confirms it.
        </p>
      )}
    </ModalFrame>
  );
}
