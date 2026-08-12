/**
 * File-type classification for the Code tab's tree.
 *
 * Focus: the cases where the extension alone would mislead — a lockfile is not
 * data, a config file is not its extension, and a dotfile has no extension at
 * all.
 */

import { describe, it, expect } from 'vitest';
import { fileKind } from './fileIcons';

describe('fileKind', () => {
  it('classifies by extension', () => {
    expect(fileKind('App.tsx')).toBe('ts');
    expect(fileKind('main.js')).toBe('js');
    expect(fileKind('base.css')).toBe('style');
    expect(fileKind('index.html')).toBe('markup');
    expect(fileKind('page.astro')).toBe('markup');
    expect(fileKind('data.yaml')).toBe('data');
    expect(fileKind('notes.md')).toBe('doc');
    expect(fileKind('logo.svg')).toBe('markup');
    expect(fileKind('hero.png')).toBe('image');
    expect(fileKind('lib.rs')).toBe('rust');
    expect(fileKind('deploy.sh')).toBe('shell');
  });

  it('is case-insensitive', () => {
    expect(fileKind('README.MD')).toBe('doc');
    expect(fileKind('Component.TSX')).toBe('ts');
  });

  it('lets a known filename outrank its extension', () => {
    // Both are .json, but one is a lockfile you never open by choice.
    expect(fileKind('package.json')).toBe('config');
    expect(fileKind('package-lock.json')).toBe('lock');
    expect(fileKind('pnpm-lock.yaml')).toBe('lock');
  });

  it('treats rc and .config files as configuration', () => {
    expect(fileKind('.prettierrc')).toBe('config');
    expect(fileKind('vite.config.ts')).toBe('config');
    expect(fileKind('eslint.config.js')).toBe('config');
  });

  it('treats a bare dotfile as configuration', () => {
    expect(fileKind('.env')).toBe('config');
    expect(fileKind('.gitignore')).toBe('config');
  });

  it('falls back to plain rather than inventing a colour', () => {
    expect(fileKind('LICENSE')).toBe('plain');
    expect(fileKind('some.unknownext')).toBe('plain');
    expect(fileKind('')).toBe('plain');
  });
});
