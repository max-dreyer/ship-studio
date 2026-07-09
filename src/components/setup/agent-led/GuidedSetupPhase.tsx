/**
 * Phase 1 of the agent-led onboarding: the chosen agent runs in a terminal
 * with a prescriptive setup prompt and installs everything the machine is
 * missing, while the checklist beside it verifies with the app's own checks.
 *
 * The agent drives; the app verifies. Completion is decided exclusively by
 * `isAgentLedSetupComplete` over freshly polled items — never by the agent
 * declaring success.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { OnboardingTerminal } from '../OnboardingTerminal';
import { DemoAgentTerminal } from './DemoAgentTerminal';
import { SetupChecklist } from './SetupChecklist';
import { Button } from '../../primitives/Button';
import { SetupItem } from '../../../lib/setup';
import {
  buildGuidedSetupPrompt,
  getMissingRequiredItems,
  guidedAgentSpawn,
  isAgentLedSetupComplete,
} from '../../../lib/agentOnboarding';
import { trackEvent } from '../../../lib/analytics';

interface GuidedSetupPhaseProps {
  /** Binary id of the agent chosen in Phase 0 (e.g. "claude"). */
  agentBinaryId: string;
  /** Display name of the chosen agent (e.g. "Claude Code"). */
  agentDisplayName: string;
  /** Live setup items — the owner polls these while this phase is mounted. */
  items: SetupItem[];
  /** Mock mode: play the scripted demo instead of spawning a real agent. */
  demoMode: boolean;
  /** Called when the user clicks Continue after everything is verified. */
  onVerified: () => void;
}

export function GuidedSetupPhase({
  agentBinaryId,
  agentDisplayName,
  items,
  demoMode,
  onVerified,
}: GuidedSetupPhaseProps) {
  // Freeze the missing list per agent session: the prompt describes the work
  // as it stood when the session started. A restart recomputes it, so an
  // agent relaunched after partial progress only gets the remaining items.
  const missingRef = useRef<SetupItem[] | null>(null);
  missingRef.current ??= getMissingRequiredItems(items);
  const [session, setSession] = useState(0);
  const [agentExit, setAgentExit] = useState<number | null>(null);

  const complete = isAgentLedSetupComplete(items, agentBinaryId);

  const spawn = useMemo(
    () => guidedAgentSpawn(agentBinaryId, buildGuidedSetupPrompt(missingRef.current ?? [])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentBinaryId, session]
  );

  const handleAgentExit = useCallback((exitCode: number | null) => {
    setAgentExit(exitCode ?? 0);
  }, []);

  const handleRestart = useCallback(() => {
    missingRef.current = null; // recompute from current items on next render
    setAgentExit(null);
    setSession((s) => s + 1);
    void trackEvent('agent_guided_setup_restarted', { agent_id: agentBinaryId });
  }, [agentBinaryId]);

  return (
    <div className="agent-guided-phase">
      <div className="agent-guided-header">
        <h2 className="wizard-step-title">
          {complete ? 'Everything is set up and verified' : `${agentDisplayName} is setting you up`}
        </h2>
        <p className="wizard-step-subtitle">
          {complete
            ? 'All checks passed — you’re ready to start building.'
            : 'Follow along in the terminal — your agent explains each step and will tell you if it needs anything (like a password or a browser sign-in).'}
        </p>
      </div>

      <div className="agent-guided-layout">
        <div className="agent-guided-terminal">
          {demoMode ? (
            <DemoAgentTerminal />
          ) : (
            <OnboardingTerminal
              key={session}
              command={spawn.command}
              args={spawn.args}
              onExit={handleAgentExit}
            />
          )}
          {!complete && agentExit !== null && !demoMode && (
            <div className="agent-guided-exit-notice">
              <span>The agent session ended before setup finished.</span>
              <Button variant="secondary" size="sm" onClick={handleRestart}>
                Restart the agent
              </Button>
            </div>
          )}
        </div>

        <div className="agent-guided-sidebar">
          <SetupChecklist
            items={items}
            agentBinaryId={agentBinaryId}
            agentDisplayName={agentDisplayName}
          />
          {complete && (
            <div className="agent-guided-complete">
              <p>Every check passed — verified by Ship Studio itself, not just the agent.</p>
              <Button variant="primary" block onClick={onVerified}>
                Continue
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
