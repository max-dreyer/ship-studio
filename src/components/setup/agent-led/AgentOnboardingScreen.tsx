/**
 * Agent-led onboarding orchestrator.
 *
 * Inverts the classic wizard: Phase 0 gets exactly one AI agent installed and
 * signed in (the only part that can't be agent-led), then Phase 1 hands the
 * wheel to that agent to install everything else while the app verifies with
 * its own checks. The classic wizard remains one click away at all times via
 * the router's corner button.
 *
 * States: loading → pick (Phase 0) → guided (Phase 1) → complete.
 * Machines that are already fully set up fast-path to complete, mirroring the
 * classic wizard — except under SHIPSTUDIO_FORCE_ONBOARDING, where the pick
 * phase is always shown so the flow can be eyeballed on a dev machine.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgentStep } from '../steps/AgentStep';
import { CelebrationScreen } from '../CelebrationScreen';
import { OnboardingTerminal } from '../OnboardingTerminal';
import { GuidedSetupPhase } from './GuidedSetupPhase';
import { useAgentSetupActions } from './useAgentSetupActions';
import { Button } from '../../primitives/Button';
import { Spinner } from '../../primitives/Spinner';
import {
  SetupItem,
  FullSetupStatus,
  getFullSetupStatus,
  getReadyAgentPairs,
  setDefaultAgentId,
  SETUP_FRIENDLY_NAMES,
} from '../../../lib/setup';
import {
  getMissingRequiredItems,
  getOnboardingTestMode,
  isAgentLedSetupComplete,
  OnboardingTestMode,
} from '../../../lib/agentOnboarding';
import { initDefaultAgent, getAgentById } from '../../../lib/agent';
import { usePolling } from '../../../hooks/usePolling';
import { withTimeout, TimeoutError } from '../../../lib/withTimeout';
import { trackEvent, trackPageview } from '../../../lib/analytics';
import { logger } from '../../../lib/logger';

type Phase = 'loading' | 'pick' | 'guided' | 'complete';

const SETUP_STATUS_TIMEOUT_MS = 15_000;

// Session-scoped guard mirroring the classic wizard's setup_started dedupe
// (module scope survives StrictMode remounts, resets per app process).
let agentSetupStartedFired = false;

/** Agent-config id for a setup pair's binary id (claude → claude-code). */
function agentIdForBinary(binaryId: string): string {
  return binaryId === 'claude' ? 'claude-code' : binaryId;
}

interface AgentOnboardingScreenProps {
  /** Called when setup is complete and the user continues. */
  onComplete: () => void;
}

export function AgentOnboardingScreen({ onComplete }: AgentOnboardingScreenProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [items, setItems] = useState<SetupItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [chosenBinaryId, setChosenBinaryId] = useState<string | null>(null);
  const [testMode, setTestMode] = useState<OnboardingTestMode>({
    mock: false,
    forceOnboarding: false,
  });

  const fetchStatus = useCallback(async (): Promise<FullSetupStatus | null> => {
    try {
      const status = await withTimeout(
        getFullSetupStatus(),
        SETUP_STATUS_TIMEOUT_MS,
        'Setup status check'
      );
      setItems(status.items);
      setError(null);
      return status;
    } catch (err) {
      logger.warn('Agent onboarding: failed to fetch setup status', { error: err });
      setError(
        err instanceof TimeoutError
          ? 'Setup check timed out — click Retry. If this persists, restart Ship Studio.'
          : 'Failed to check setup status. Please try again.'
      );
      return null;
    }
  }, []);

  const updateItemStatus = useCallback((itemId: string, updates: Partial<SetupItem>) => {
    setItems((prev) => prev.map((item) => (item.id === itemId ? { ...item, ...updates } : item)));
  }, []);

  const actions = useAgentSetupActions({ fetchStatus, updateItemStatus, mock: testMode.mock });

  // Initial load: test mode + status, then route.
  useEffect(() => {
    const init = async () => {
      const mode = await getOnboardingTestMode().catch(() => ({
        mock: false,
        forceOnboarding: false,
      }));
      setTestMode(mode);
      const status = await fetchStatus();
      if (!status) {
        setPhase('pick'); // show the error banner with Retry
        return;
      }
      if (!agentSetupStartedFired) {
        agentSetupStartedFired = true;
        void trackEvent('setup_started', { entry_path: 'agent_led', entry_step: null });
      }

      // Fast path: a fully set-up machine goes straight to celebration, same
      // as the classic wizard — except under force-onboarding, where showing
      // the pick phase is the whole point of launching with the env var.
      const readyPair = getReadyAgentPairs(status.items)[0];
      if (
        !mode.forceOnboarding &&
        readyPair &&
        getMissingRequiredItems(status.items).length === 0
      ) {
        const agentId = agentIdForBinary(readyPair.binaryId);
        await setDefaultAgentId(agentId);
        initDefaultAgent(agentId);
        setChosenBinaryId(readyPair.binaryId);
        void trackEvent('onboarding_completed', {
          agents: [agentId],
          entry_path: 'agent_led_fast_path',
          $screen_name: 'Onboarding',
        });
        setPhase('complete');
        return;
      }
      trackPageview('Onboarding - Agent Pick');
      setPhase('pick');
    };
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live verification while the agent works: poll real checks (or mock state
  // in demo mode) so the checklist ticks green as the agent installs things.
  usePolling(fetchStatus, {
    intervalMs: 3000,
    enabled:
      phase === 'guided' && !(chosenBinaryId && isAgentLedSetupComplete(items, chosenBinaryId)),
    name: 'agentOnboardingStatus',
  });

  const readyPairs = useMemo(() => getReadyAgentPairs(items), [items]);
  const canContinue =
    readyPairs.length === 1 || (readyPairs.length > 1 && selectedAgentId !== null);

  const handleStartGuided = useCallback(async () => {
    const agentId =
      readyPairs.length > 1 && selectedAgentId
        ? selectedAgentId
        : readyPairs[0]
          ? agentIdForBinary(readyPairs[0].binaryId)
          : null;
    if (!agentId) return;

    await setDefaultAgentId(agentId);
    initDefaultAgent(agentId);
    const binaryId = agentId === 'claude-code' ? 'claude' : agentId;
    setChosenBinaryId(binaryId);

    const missing = getMissingRequiredItems(items);
    if (missing.length === 0) {
      void trackEvent('onboarding_completed', {
        agents: [agentId],
        entry_path: 'agent_led',
        $screen_name: 'Onboarding',
      });
      setPhase('complete');
      return;
    }
    void trackEvent('agent_guided_setup_started', {
      agent_id: agentId,
      missing_items: missing.map((i) => i.id),
      demo: testMode.mock,
    });
    trackPageview('Onboarding - Agent Guided Setup');
    setPhase('guided');
  }, [readyPairs, selectedAgentId, items, testMode.mock]);

  const handleVerified = useCallback(() => {
    void trackEvent('onboarding_completed', {
      agents: chosenBinaryId ? [agentIdForBinary(chosenBinaryId)] : [],
      entry_path: 'agent_led',
      $screen_name: 'Onboarding',
    });
    setPhase('complete');
  }, [chosenBinaryId]);

  if (phase === 'loading') {
    return (
      <div className="onboarding-screen onboarding-loading">
        <Spinner size="lg" style={{ color: 'var(--text-muted)' }} />
        <p>Checking setup status...</p>
      </div>
    );
  }

  if (phase === 'complete') {
    const hostingConnected =
      items.find((i) => i.id === 'vercel')?.status === 'ready' &&
      items.find((i) => i.id === 'vercel_auth')?.status === 'ready';
    return <CelebrationScreen onContinue={onComplete} hostingConnected={hostingConnected} />;
  }

  const chosenAgentDisplayName = chosenBinaryId
    ? getAgentById(agentIdForBinary(chosenBinaryId)).displayName
    : '';

  return (
    <div className="onboarding-screen">
      <div className={`onboarding-content ${phase === 'guided' ? 'agent-guided-content' : ''}`}>
        <div className="onboarding-header">
          <img src="/ship_studio_full_noshadow.svg" alt="Ship Studio" className="onboarding-logo" />
          {phase === 'pick' && (
            <>
              <h1>Meet your setup crew</h1>
              <p className="onboarding-reassurance">
                Pick an AI agent — it installs everything else and walks you through the rest.
              </p>
            </>
          )}
        </div>

        {error && (
          <div className="onboarding-error">
            <p>{error}</p>
            <Button variant="secondary" onClick={() => void fetchStatus()}>
              Retry
            </Button>
          </div>
        )}

        {phase === 'pick' && (
          <>
            <AgentStep
              items={items}
              onItemAction={(id) => void actions.handleItemAction(id)}
              activeItemId={actions.activeItemId}
              terminalActive={actions.terminalConfig !== null}
              onAgentSelect={setSelectedAgentId}
              selectedAgentId={selectedAgentId}
            />
            <div className="wizard-nav">
              <div className="wizard-nav-spacer" />
              {!canContinue && (
                <span className="wizard-nav-hint">
                  {readyPairs.length > 1
                    ? 'Choose your agent to continue'
                    : 'Install and connect an agent to continue'}
                </span>
              )}
              <button
                className="wizard-nav-next"
                onClick={() => void handleStartGuided()}
                disabled={
                  !canContinue || actions.activeItemId !== null || actions.terminalConfig !== null
                }
              >
                Start guided setup
              </button>
            </div>
          </>
        )}

        {phase === 'guided' && chosenBinaryId && (
          <GuidedSetupPhase
            agentBinaryId={chosenBinaryId}
            agentDisplayName={chosenAgentDisplayName}
            items={items}
            demoMode={testMode.mock}
            onVerified={handleVerified}
          />
        )}

        {/* Terminal modal for Phase 0 install/connect commands (same chrome
            as the classic wizard — shared CSS classes from setup.css). */}
        {actions.terminalConfig && (
          <div className="onboarding-terminal-overlay">
            <div className="onboarding-terminal-modal">
              <div className="onboarding-terminal-header">
                <span className="onboarding-terminal-title">
                  {SETUP_FRIENDLY_NAMES[actions.terminalConfig.itemId] ||
                    actions.terminalConfig.itemId}
                </span>
                <button
                  className="onboarding-terminal-cancel"
                  onClick={actions.handleTerminalCancel}
                >
                  {actions.terminalExitCode ? 'Close' : 'Cancel'}
                </button>
              </div>
              <OnboardingTerminal
                command={actions.terminalConfig.command}
                args={actions.terminalConfig.args}
                onExit={(exitCode, outputTail) =>
                  void actions.handleTerminalExit(exitCode, outputTail)
                }
              />
              <div className="onboarding-terminal-hint">
                <strong>If you're asked for a password</strong>, type it and press Enter. It stays
                hidden as you type — no dots or characters appear — but it is being entered.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
