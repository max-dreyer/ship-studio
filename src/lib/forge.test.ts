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
  moveProjectToForge,
  mirrorProjectToForge,
  getDefaultForge,
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

describe('moving and mirroring', () => {
  it('sends the options through to the move command', async () => {
    let seen: unknown;
    mockIPC((cmd, args) => {
      if (cmd === 'move_project_to_forge') {
        seen = args;
        return { url: 'https://gitlab.com/me/app', remoteName: 'origin', previousOriginUrl: null };
      }
      return undefined;
    });
    const result = await moveProjectToForge({
      projectPath: '/p',
      forgeId: 'gitlab',
      repoName: 'app',
      isPrivate: true,
      remoteName: 'origin',
    });
    expect(result.remoteName).toBe('origin');
    expect(seen).toMatchObject({ options: { forgeId: 'gitlab', repoName: 'app' } });
  });

  it('surfaces the previous origin so a move can be undone', async () => {
    mockIPC((cmd) =>
      cmd === 'mirror_project_to_forge'
        ? undefined
        : {
            url: 'https://gitlab.com/me/app',
            remoteName: 'origin',
            previousOriginUrl: 'git@github.com:me/app.git',
          }
    );
    const result = await moveProjectToForge({
      projectPath: '/p',
      forgeId: 'gitlab',
      repoName: 'app',
      isPrivate: true,
      remoteName: 'origin',
    });
    expect(result.previousOriginUrl).toBe('git@github.com:me/app.git');
  });

  it('reports the remote a mirror actually landed on', async () => {
    // The backend renames a mirror asked to write "origin", so the caller has
    // to read the answer rather than assume what it sent.
    mockIPC(() => ({
      url: 'https://gitlab.com/me/app',
      remoteName: 'gitlab',
      previousOriginUrl: null,
    }));
    const result = await mirrorProjectToForge({
      projectPath: '/p',
      forgeId: 'gitlab',
      repoName: 'app',
      isPrivate: false,
      remoteName: 'origin',
    });
    expect(result.remoteName).toBe('gitlab');
  });

  it('lets a failed move reject so the UI can show why', async () => {
    mockIPC(() => {
      throw new Error('name taken');
    });
    await expect(
      moveProjectToForge({
        projectPath: '/p',
        forgeId: 'gitlab',
        repoName: 'app',
        isPrivate: true,
        remoteName: 'origin',
      })
    ).rejects.toBeTruthy();
  });
});

describe('getDefaultForge', () => {
  it('resolves the stored id', async () => {
    mockIPC((cmd) => (cmd === 'get_default_forge_id' ? 'gitlab' : undefined));
    expect((await getDefaultForge()).id).toBe('gitlab');
  });

  it('falls back to the default when nothing is stored', async () => {
    mockIPC(() => null);
    expect((await getDefaultForge()).id).toBe(DEFAULT_FORGE.id);
  });

  it('falls back when the lookup fails', async () => {
    mockIPC(() => {
      throw new Error('nope');
    });
    expect((await getDefaultForge()).id).toBe(DEFAULT_FORGE.id);
  });
});
