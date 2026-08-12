/**
 * File-type classification for the Code tab's tree.
 *
 * VS Code makes a file list scannable by colouring each row's icon by type,
 * which is what lets you find the stylesheet in a folder of thirty files
 * without reading a single name. This maps a filename to one of a small set of
 * kinds; the colour for each lives in CSS (`--fi-*` tokens in code-mode.css),
 * so the palette stays with the rest of the theme.
 *
 * Deliberately small: a kind exists only where the colour earns its place.
 * Everything unrecognised falls back to `plain`, which inherits the row's
 * text colour rather than inventing a hue.
 *
 * @module lib/fileIcons
 */

export type FileKind =
  | 'ts'
  | 'js'
  | 'style'
  | 'markup'
  | 'data'
  | 'doc'
  | 'image'
  | 'media'
  | 'font'
  | 'config'
  | 'lock'
  | 'rust'
  | 'shell'
  | 'plain';

/** Extension → kind. Longest match wins, so `.d.ts` beats `.ts`. */
const BY_EXTENSION: Record<string, FileKind> = {
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  css: 'style',
  scss: 'style',
  sass: 'style',
  less: 'style',
  html: 'markup',
  htm: 'markup',
  astro: 'markup',
  vue: 'markup',
  svelte: 'markup',
  xml: 'markup',
  svg: 'markup',
  json: 'data',
  jsonc: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'data',
  csv: 'data',
  md: 'doc',
  mdx: 'doc',
  txt: 'doc',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  ico: 'image',
  mp4: 'media',
  webm: 'media',
  mov: 'media',
  mp3: 'media',
  wav: 'media',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  rs: 'rust',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
};

/** Exact filenames that outrank their extension. */
const BY_NAME: Record<string, FileKind> = {
  'package.json': 'config',
  'tsconfig.json': 'config',
  'package-lock.json': 'lock',
  'pnpm-lock.yaml': 'lock',
  'yarn.lock': 'lock',
  'cargo.lock': 'lock',
  'cargo.toml': 'config',
  '.gitignore': 'config',
  '.env': 'config',
  dockerfile: 'config',
  'readme.md': 'doc',
};

/**
 * Classify a file by name. Directories are the caller's business — a folder
 * has its own icon and never reaches this.
 */
export function fileKind(filename: string): FileKind {
  const name = filename.trim().toLowerCase();
  if (!name) return 'plain';

  const byName = BY_NAME[name];
  if (byName) return byName;

  // Dotfiles with no further extension (.prettierrc) read as config.
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0) return name.startsWith('.') ? 'config' : 'plain';

  // Anything ending in .config.<ext> or an rc file is configuration first.
  if (/(^|\.)(eslintrc|prettierrc|babelrc|npmrc|nvmrc)$/.test(name)) return 'config';
  if (/\.config\.[a-z]+$/.test(name)) return 'config';

  return BY_EXTENSION[name.slice(lastDot + 1)] ?? 'plain';
}
