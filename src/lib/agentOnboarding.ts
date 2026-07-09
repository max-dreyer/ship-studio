/**
 * Agent-led onboarding: the agent does the setup work, the app verifies it.
 *
 * The flow inverts the classic wizard. Phase 0 gets exactly one AI agent
 * installed + signed in (the only part that can't be agent-led). Phase 1
 * spawns that agent in a terminal with a prescriptive setup prompt and lets
 * it install everything else (Homebrew/winget, Node, Git, GitHub CLI, GitHub
 * sign-in) while a checklist polls `get_full_setup_status` — the backend's
 * real checks, never the agent's own claims, decide when setup is complete.
 *
 * @module lib/agentOnboarding
 */

import { invoke } from '@tauri-apps/api/core';
import { SetupItem, isSetupItemReady, isWindows, TerminalCommand } from './setup';

// ============ Test-mode API ============

/** How the app was launched, for swapping real side effects in test modes. */
export interface OnboardingTestMode {
  /** `SHIPSTUDIO_FORCE_SETUP` is set — statuses are mocked; run the scripted demo. */
  mock: boolean;
  /** `SHIPSTUDIO_FORCE_ONBOARDING` is set — real checks, wizard forced open. */
  forceOnboarding: boolean;
}

export async function getOnboardingTestMode(): Promise<OnboardingTestMode> {
  return invoke<OnboardingTestMode>('get_onboarding_test_mode');
}

/**
 * Flip one item to ready in the backend's mock state (mock mode only).
 * The demo agent session calls this on a timeline so the checklist UI is
 * exercised end-to-end without touching the host machine.
 */
export async function mockMarkSetupItemReady(itemId: string): Promise<void> {
  return invoke('mock_mark_setup_item_ready', { itemId });
}

// ============ Required items & completion ============

/**
 * Everything the guided phase is responsible for, in install order. The agent
 * pair itself is handled in Phase 0 and checked separately; Vercel stays
 * optional (connectable later from the dashboard), matching the classic
 * wizard's skippable hosting step.
 */
export const AGENT_LED_REQUIRED_ITEM_IDS = [
  'homebrew',
  'node',
  'npm_fix',
  'git',
  'gh',
  'gh_auth',
] as const;

/**
 * Required items that are present in the status and not yet ready.
 * Absent items count as ready (`npm_fix` only exists while ~/.npm is broken).
 */
export function getMissingRequiredItems(items: SetupItem[]): SetupItem[] {
  return AGENT_LED_REQUIRED_ITEM_IDS.map((id) => items.find((i) => i.id === id)).filter(
    (item): item is SetupItem => item !== undefined && item.status !== 'ready'
  );
}

/**
 * The agent-led flow is complete when every required item is ready AND the
 * chosen agent pair is ready. Computed from items (not `allReady`) so it
 * stays truthful under SHIPSTUDIO_FORCE_ONBOARDING, which pins `allReady`
 * to false while onboarding is open.
 */
export function isAgentLedSetupComplete(items: SetupItem[], agentBinaryId: string): boolean {
  const requiredReady = AGENT_LED_REQUIRED_ITEM_IDS.every((id) => isSetupItemReady(items, id));
  const pairReady =
    items.find((i) => i.id === agentBinaryId)?.status === 'ready' &&
    items.find((i) => i.id === `${agentBinaryId}_auth`)?.status === 'ready';
  return requiredReady && pairReady;
}

// ============ Guided prompt ============

/**
 * Per-item install instructions the agent is told to use, phrased as prompt
 * fragments. These mirror the classic wizard's canonical commands
 * (TERMINAL_COMMANDS / installPackages in lib/setup.ts) — the agent gets the
 * wizard's logic as instructions instead of code, so it doesn't improvise.
 */
function itemInstruction(itemId: string, win: boolean): string | null {
  switch (itemId) {
    case 'homebrew':
      return win
        ? 'the winget package manager: it ships with Windows via "App Installer" — check with `winget --version`, and if missing, tell the user to install "App Installer" from the Microsoft Store, then verify again'
        : 'Homebrew: run `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` — warn the user first that macOS will ask for their computer password and that nothing appears on screen while they type it';
    case 'node':
      return win
        ? 'Node.js: run `winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements`'
        : 'Node.js: run `brew install node` (batch it with git/gh into one `brew install` when those are also missing; if Homebrew was installed moments ago, run `eval "$(/opt/homebrew/bin/brew shellenv)"` first on Apple Silicon, or use /usr/local/bin/brew on Intel)';
    case 'npm_fix':
      return win
        ? 'fix npm cache permissions: run `icacls "$env:USERPROFILE\\.npm" /grant "$env:USERNAME:(OI)(CI)F" /T` in PowerShell'
        : 'fix npm cache permissions: run `sudo chown -R $(whoami) ~/.npm` (this needs the computer password again)';
    case 'git':
      return win
        ? 'Git: run `winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements`'
        : 'Git: run `brew install git`';
    case 'gh':
      return win
        ? 'GitHub CLI: run `winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements`'
        : 'GitHub CLI: run `brew install gh`';
    case 'gh_auth':
      return 'GitHub sign-in: run `gh auth login --web --git-protocol https` — tell the user a browser will open where they sign in or create a free GitHub account, and that they should come back here afterwards';
    default:
      return null;
  }
}

/** Friendly names for the prompt's "missing" summary. */
const PROMPT_ITEM_NAMES: Record<string, string> = {
  homebrew: 'a package manager',
  node: 'Node.js',
  npm_fix: 'working npm permissions',
  git: 'Git',
  gh: 'the GitHub CLI',
  gh_auth: 'a GitHub sign-in',
};

/**
 * Build the single-message setup prompt for the guided phase.
 *
 * Deliberately a single line: multi-line argv survives every PTY spawn shape
 * (including the Windows cmd.exe-wrapped .cmd shims) only if there are no
 * newlines to re-parse. Deliberately prescriptive: exact commands, verify
 * before moving on, plain language — the classic wizard rewritten as
 * instructions. The app's own checks decide completion, and the prompt says
 * so, so the agent doesn't overclaim.
 */
export function buildGuidedSetupPrompt(missing: SetupItem[]): string {
  const win = isWindows();
  const names = missing.map((i) => PROMPT_ITEM_NAMES[i.id] ?? i.id).join(', ');
  const steps = missing
    .map((i) => itemInstruction(i.id, win))
    .filter((s): s is string => s !== null)
    .map((s, idx) => `${String(idx + 1)}) ${s}`)
    .join('; ');

  return (
    'You are helping a brand-new Ship Studio user get their computer ready. ' +
    'Ship Studio is a desktop app for building websites with AI agents, and you are that agent — this is their first impression of you, so be warm, brief, and clear. ' +
    'Assume the user is not technical: before each step, say what you are about to do in one short sentence. ' +
    `Their machine is missing: ${names}. ` +
    `Set these up one at a time, in this exact order, using exactly these commands: ${steps}. ` +
    'When you are asked to approve a command permission, reassure the user it is safe to approve the commands listed above. ' +
    'After each step, verify it actually worked (run the tool with --version, or `gh auth status` for the sign-in) before moving on — a clean exit is a claim, not proof. ' +
    'If a command fails, read the error, explain it in plain words, and fix it; if the user has to do something themselves (type a password, click through a browser), tell them exactly what to expect. ' +
    'Do not install or change anything beyond the tools listed above. ' +
    'When everything is verified, tell the user they are all set and to look at the checklist beside this window — Ship Studio runs its own checks and will turn every item green, then show a Continue button.'
  );
}

// ============ Agent spawn mapping ============

/**
 * How to launch each agent CLI as an interactive session seeded with a
 * prompt. Verified against each CLI's --help: claude, codex and cursor-agent
 * take the initial prompt as a positional argument; opencode's positional is
 * a project directory, so it takes `--prompt` instead.
 */
export function guidedAgentSpawn(agentBinaryId: string, prompt: string): TerminalCommand {
  if (agentBinaryId === 'opencode') {
    return { command: 'opencode', args: ['--prompt', prompt] };
  }
  const binary = agentBinaryId === 'cursor' ? 'cursor-agent' : agentBinaryId;
  return { command: binary, args: [prompt] };
}
