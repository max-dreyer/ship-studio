import { describe, it, expect, afterEach, vi } from 'vitest';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import {
  GITHUB,
  GITLAB,
  FORGEJO,
  ALL_FORGES,
  DEFAULT_FORGE,
  getForgeById,
  fetchProjectForge,
  pullRequestPlural,
  pullRequestLower,
} from './forge';

afterEach(() => {
  clearMocks();
  vi.restoreAllMocks();
});

describe('forge configs', () => {
  it('gives each forge a unique id', () => {
    const ids = ALL_FORGES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses GitLab terminology for GitLab', () => {
    expect(GITLAB.pullRequestTerm).toBe('Merge Request');
    expect(GITLAB.pullRequestShort).toBe('MR');
    expect(GITLAB.organizationTerm).toBe('Group');
  });

  it('keeps GitHub terminology unchanged', () => {
    expect(GITHUB.pullRequestTerm).toBe('Pull Request');
    expect(GITHUB.pullRequestShort).toBe('PR');
    expect(GITHUB.organizationTerm).toBe('Organization');
  });

  it('marks Forgejo as having no CLI', () => {
    // The UI must hide PR actions for it rather than offering ones that fail.
    expect(FORGEJO.hasCli).toBe(false);
    expect(GITHUB.hasCli).toBe(true);
    expect(GITLAB.hasCli).toBe(true);
  });

  it('does not promise hosting auto-deploy for Forgejo', () => {
    // Neither Vercel nor Cloudflare deploys from Forgejo on push.
    expect(FORGEJO.hostingAutoDeploy).toBe(false);
  });

  it('defaults to GitHub, so nothing changes for existing projects', () => {
    expect(DEFAULT_FORGE.id).toBe('github');
  });
});

describe('getForgeById', () => {
  it('finds each known forge', () => {
    expect(getForgeById('gitlab').id).toBe('gitlab');
    expect(getForgeById('forgejo').id).toBe('forgejo');
  });

  it('falls back to the default for an unknown id', () => {
    // A project tagged by a newer build must keep working, not break the UI.
    expect(getForgeById('bitbucket').id).toBe(DEFAULT_FORGE.id);
    expect(getForgeById('').id).toBe(DEFAULT_FORGE.id);
  });
});

describe('terminology helpers', () => {
  it('pluralizes both terms', () => {
    expect(pullRequestPlural(GITHUB)).toBe('Pull Requests');
    expect(pullRequestPlural(GITLAB)).toBe('Merge Requests');
  });

  it('lowercases for mid-sentence use', () => {
    expect(pullRequestLower(GITLAB)).toBe('merge request');
  });
});

describe('fetchProjectForge', () => {
  it('returns what the backend resolved', async () => {
    mockIPC((cmd) => {
      if (cmd === 'get_project_forge') return GITLAB;
      return undefined;
    });
    const forge = await fetchProjectForge('/some/project');
    expect(forge.id).toBe('gitlab');
  });

  it('falls back to the default when the command rejects', async () => {
    mockIPC(() => {
      throw new Error('no such project');
    });
    const forge = await fetchProjectForge('/some/project');
    expect(forge.id).toBe(DEFAULT_FORGE.id);
  });

  it('falls back when the command resolves with nothing usable', async () => {
    // Reading a term off undefined would crash the component that called this.
    mockIPC(() => undefined);
    const forge = await fetchProjectForge('/some/project');
    expect(forge.id).toBe(DEFAULT_FORGE.id);
    expect(forge.pullRequestTerm).toBe('Pull Request');
  });
});
