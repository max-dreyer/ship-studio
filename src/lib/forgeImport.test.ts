import { describe, it, expect } from 'vitest';
import { GITHUB, GITLAB } from './forge';
import {
  filterRepos,
  sharedOwnerCopy,
  sortReposByActivity,
  repositoryPlural,
  visibilityLabel,
  type ForgeRepo,
} from './forgeImport';

function repo(overrides: Partial<ForgeRepo> = {}): ForgeRepo {
  return {
    name: 'web',
    fullPath: 'acme/web',
    url: 'https://gitlab.com/acme/web',
    sshUrl: 'git@gitlab.com:acme/web.git',
    isPrivate: true,
    visibility: null,
    description: null,
    primaryLanguage: null,
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('visibilityLabel', () => {
  it("uses the forge's own word when it sent one", () => {
    // "Internal" is visible to everyone signed in to the instance. Calling it
    // "Private" would misstate who can see the code.
    expect(visibilityLabel(repo({ visibility: 'internal' }))).toBe('Internal');
    expect(visibilityLabel(repo({ visibility: 'private' }))).toBe('Private');
  });

  it('falls back to the private flag when no word was sent', () => {
    expect(visibilityLabel(repo({ visibility: null, isPrivate: true }))).toBe('Private');
  });

  it('shows no label for a public repo', () => {
    expect(visibilityLabel(repo({ visibility: 'public', isPrivate: false }))).toBeNull();
    expect(visibilityLabel(repo({ visibility: null, isPrivate: false }))).toBeNull();
  });
});

describe('terminology', () => {
  it('follows each forge instead of hardcoding GitHub', () => {
    expect(repositoryPlural(GITLAB)).toBe('Projects');
    expect(repositoryPlural(GITHUB)).toBe('Repositories');
  });

  it('describes shared access as each forge actually defines it', () => {
    // GitLab's --member covers every membership, the user's own projects
    // included, so the label must not promise "somebody else's repos".
    expect(sharedOwnerCopy(GITLAB).title).toBe('Member access');
    expect(sharedOwnerCopy(GITHUB).title).toBe('Collaborator access');
  });
});

describe('sortReposByActivity', () => {
  it('puts the most recently active first', () => {
    const sorted = sortReposByActivity([
      repo({ name: 'old', updatedAt: '2026-01-01T00:00:00Z' }),
      repo({ name: 'new', updatedAt: '2026-08-01T00:00:00Z' }),
    ]);
    expect(sorted.map((r) => r.name)).toEqual(['new', 'old']);
  });

  it('leaves the input array untouched', () => {
    const input = [
      repo({ name: 'old', updatedAt: '2026-01-01T00:00:00Z' }),
      repo({ name: 'new', updatedAt: '2026-08-01T00:00:00Z' }),
    ];
    sortReposByActivity(input);
    expect(input.map((r) => r.name)).toEqual(['old', 'new']);
  });
});

describe('filterRepos', () => {
  const repos = [
    repo({ name: 'web', fullPath: 'acme/web', description: 'Marketing site' }),
    repo({ name: 'api', fullPath: 'acme/backend/api', description: null }),
  ];

  it('returns everything for an empty query', () => {
    expect(filterRepos(repos, '   ')).toHaveLength(2);
  });

  it('matches name, namespace path, and description case-insensitively', () => {
    expect(filterRepos(repos, 'WEB').map((r) => r.name)).toEqual(['web']);
    // The subgroup path is searchable: on GitLab it's often the only thing that
    // tells two similarly-named projects apart.
    expect(filterRepos(repos, 'backend').map((r) => r.name)).toEqual(['api']);
    expect(filterRepos(repos, 'marketing').map((r) => r.name)).toEqual(['web']);
  });

  it('returns nothing when a repo has no description to match', () => {
    expect(filterRepos(repos, 'nonexistent')).toEqual([]);
  });
});
