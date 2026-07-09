/**
 * Tests for the agent-led onboarding library: guided prompt construction,
 * agent spawn mapping, and completion helpers. The prompt is the contract
 * between the app and the agent doing the setup work — regressions here turn
 * into an agent improvising installs on a stranger's machine.
 */

import { describe, it, expect, vi } from 'vitest';
import type { SetupItem } from './setup';

// Pin the platform: the prompt embeds per-OS commands and CI runs on
// different hosts. macOS is asserted here; the Windows variant is covered by
// the win-specific test below via the mocked switch.
const isWindowsMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('./setup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./setup')>();
  return { ...actual, isWindows: isWindowsMock };
});

import {
  AGENT_LED_REQUIRED_ITEM_IDS,
  buildGuidedSetupPrompt,
  getMissingRequiredItems,
  guidedAgentSpawn,
  isAgentLedSetupComplete,
} from './agentOnboarding';

function item(id: string, status: SetupItem['status']): SetupItem {
  return { id, friendlyName: id, status };
}

const FRESH_MISSING: SetupItem[] = [
  item('homebrew', 'not_installed'),
  item('node', 'not_installed'),
  item('git', 'not_installed'),
  item('gh', 'not_installed'),
  item('gh_auth', 'not_installed'),
];

describe('buildGuidedSetupPrompt', () => {
  it('is a single line — newlines break Windows cmd.exe-wrapped spawns', () => {
    const prompt = buildGuidedSetupPrompt(FRESH_MISSING);
    expect(prompt).not.toContain('\n');
  });

  it('includes exact canonical commands for every missing macOS item', () => {
    isWindowsMock.mockReturnValue(false);
    const prompt = buildGuidedSetupPrompt(FRESH_MISSING);
    expect(prompt).toContain(
      '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    );
    expect(prompt).toContain('brew install node');
    expect(prompt).toContain('gh auth login --web --git-protocol https');
  });

  it('uses winget commands on Windows', () => {
    isWindowsMock.mockReturnValue(true);
    const prompt = buildGuidedSetupPrompt(FRESH_MISSING);
    expect(prompt).toContain('winget install --id OpenJS.NodeJS.LTS');
    expect(prompt).toContain('winget install --id Git.Git');
    expect(prompt).toContain('winget install --id GitHub.cli');
    expect(prompt).not.toContain('brew install');
    isWindowsMock.mockReturnValue(false);
  });

  it('only lists items that are actually missing', () => {
    const prompt = buildGuidedSetupPrompt([item('gh_auth', 'not_authenticated')]);
    expect(prompt).toContain('gh auth login');
    expect(prompt).not.toContain('Homebrew');
    expect(prompt).not.toContain('brew install');
  });

  it('numbers steps in install order', () => {
    const prompt = buildGuidedSetupPrompt(FRESH_MISSING);
    const homebrewPos = prompt.indexOf('1) Homebrew');
    const ghAuthPos = prompt.indexOf('5) GitHub sign-in');
    expect(homebrewPos).toBeGreaterThan(-1);
    expect(ghAuthPos).toBeGreaterThan(homebrewPos);
  });

  it('tells the agent verification is the app’s job, not its own claim', () => {
    const prompt = buildGuidedSetupPrompt(FRESH_MISSING);
    expect(prompt).toContain('a clean exit is a claim, not proof');
    expect(prompt).toContain('Ship Studio runs its own checks');
  });

  it('forbids work beyond the listed tools', () => {
    const prompt = buildGuidedSetupPrompt(FRESH_MISSING);
    expect(prompt).toContain('Do not install or change anything beyond the tools listed above');
  });

  it('appends the chosen host CLI as the final step', () => {
    const vercel = buildGuidedSetupPrompt(FRESH_MISSING, 'vercel');
    expect(vercel).toContain('6) Vercel CLI: run `npm install -g vercel --force`');
    expect(vercel).toContain('vercel login');

    const cloudflare = buildGuidedSetupPrompt(FRESH_MISSING, 'cloudflare');
    expect(cloudflare).toContain(
      '6) Cloudflare Wrangler CLI: run `npm install -g wrangler --force`'
    );
    expect(cloudflare).toContain('wrangler login');
    expect(cloudflare).not.toContain('vercel');
  });

  it('omits hosting entirely when skipped', () => {
    const prompt = buildGuidedSetupPrompt(FRESH_MISSING, null);
    expect(prompt).not.toContain('wrangler');
    expect(prompt).not.toContain('Vercel');
  });

  it('still produces a hosting-only prompt when nothing else is missing', () => {
    const prompt = buildGuidedSetupPrompt([], 'cloudflare');
    expect(prompt).toContain('1) Cloudflare Wrangler CLI');
    expect(prompt).toContain('the Cloudflare Wrangler CLI (their hosting provider)');
  });

  it('becomes a verify-only pass when nothing at all is missing', () => {
    const prompt = buildGuidedSetupPrompt([], null);
    expect(prompt).toContain('appears to be installed already');
    expect(prompt).toContain('gh auth status');
    expect(prompt).not.toContain('Their machine is missing');
    expect(prompt).not.toContain('\n');
  });

  it('names already-installed tools so the agent confirms them to the user', () => {
    const prompt = buildGuidedSetupPrompt([item('gh_auth', 'not_authenticated')], null, [
      item('git', 'ready'),
      item('node', 'ready'),
    ]);
    expect(prompt).toContain('already detected these as installed and working: Git, Node.js');
    expect(prompt).toContain('Their machine is missing: a GitHub sign-in');
  });
});

describe('guidedAgentSpawn', () => {
  it('passes the prompt as a positional arg for claude, codex and cursor', () => {
    expect(guidedAgentSpawn('claude', 'PROMPT')).toEqual({ command: 'claude', args: ['PROMPT'] });
    expect(guidedAgentSpawn('codex', 'PROMPT')).toEqual({ command: 'codex', args: ['PROMPT'] });
    expect(guidedAgentSpawn('cursor', 'PROMPT')).toEqual({
      command: 'cursor-agent',
      args: ['PROMPT'],
    });
  });

  it('uses --prompt for opencode, whose positional is a project directory', () => {
    expect(guidedAgentSpawn('opencode', 'PROMPT')).toEqual({
      command: 'opencode',
      args: ['--prompt', 'PROMPT'],
    });
  });
});

describe('getMissingRequiredItems', () => {
  it('returns required items that are present and not ready, in install order', () => {
    const items = [
      item('gh_auth', 'not_authenticated'),
      item('homebrew', 'not_installed'),
      item('node', 'ready'),
      item('claude', 'not_installed'), // agent items are not "required" here
    ];
    expect(getMissingRequiredItems(items).map((i) => i.id)).toEqual(['homebrew', 'gh_auth']);
  });

  it('treats absent items as ready (npm_fix disappears once fixed)', () => {
    const items = AGENT_LED_REQUIRED_ITEM_IDS.filter((id) => id !== 'npm_fix').map((id) =>
      item(id, 'ready')
    );
    expect(getMissingRequiredItems(items)).toEqual([]);
  });
});

describe('isAgentLedSetupComplete', () => {
  const allRequiredReady = AGENT_LED_REQUIRED_ITEM_IDS.filter((id) => id !== 'npm_fix').map((id) =>
    item(id, 'ready')
  );

  it('requires the chosen agent pair on top of the required items', () => {
    expect(isAgentLedSetupComplete(allRequiredReady, 'claude')).toBe(false);
    const withPair = [...allRequiredReady, item('claude', 'ready'), item('claude_auth', 'ready')];
    expect(isAgentLedSetupComplete(withPair, 'claude')).toBe(true);
  });

  it('fails when a required item is not ready, even with the agent ready', () => {
    const items = [
      ...allRequiredReady.filter((i) => i.id !== 'gh_auth'),
      item('gh_auth', 'not_authenticated'),
      item('claude', 'ready'),
      item('claude_auth', 'ready'),
    ];
    expect(isAgentLedSetupComplete(items, 'claude')).toBe(false);
  });

  it('only checks the chosen agent, not every agent', () => {
    const items = [
      ...allRequiredReady,
      item('claude', 'ready'),
      item('claude_auth', 'ready'),
      item('codex', 'not_installed'),
    ];
    expect(isAgentLedSetupComplete(items, 'claude')).toBe(true);
    expect(isAgentLedSetupComplete(items, 'codex')).toBe(false);
  });

  it('null agent ("Other") gates on required items only', () => {
    expect(isAgentLedSetupComplete(allRequiredReady, null)).toBe(true);
    const items = [
      ...allRequiredReady.filter((i) => i.id !== 'gh_auth'),
      item('gh_auth', 'not_authenticated'),
    ];
    expect(isAgentLedSetupComplete(items, null)).toBe(false);
  });
});
