/**
 * Custom classes — frontend bindings for the Webflow-style custom-class backend
 * (`src-tauri/src/commands/custom_classes.rs`).
 *
 * A custom class is a named rule in the project's entry stylesheet, composed
 * from the same Tailwind tokens the editor's controls emit:
 *
 *   @layer components { .btn-primary { @apply px-4 py-2 rounded; } }
 *
 * Editing the rule's `@apply` list updates every element carrying the class.
 * Phase 0 exposes detection + read-only listing only.
 */

import { invoke } from '@tauri-apps/api/core';

/** Which Tailwind generation the project uses (`none` = no recognizable setup). */
export type TailwindVersion = 'v3' | 'v4' | 'none';

/** Where and how custom classes can be managed in this project. */
export interface TailwindSetup {
  version: TailwindVersion;
  /** POSIX-relative path to the Tailwind-importing stylesheet, or null if none
   *  could be located (custom classes need this file to compile `@apply`). */
  entryCss: string | null;
  /** Whether `entryCss` already has a writable `@layer components { … }` block. */
  componentsLayer: boolean;
}

/** One custom class parsed from the entry stylesheet. */
export interface CustomClass {
  /** Class name without the leading dot (e.g. `btn-primary`). */
  name: string;
  /** Utility tokens in its `@apply` list, in source order. */
  tokens: string[];
  /** True when the rule is a pure `@apply` list we can safely round-trip; false
   *  when it mixes raw declarations or nested rules. */
  editable: boolean;
}

/** Detect the project's Tailwind generation and locate its entry stylesheet. */
export function detectTailwindSetup(projectPath: string): Promise<TailwindSetup> {
  return invoke<TailwindSetup>('detect_tailwind_setup', { projectPath });
}

/** List the custom classes defined in the project's entry stylesheet (read-only). */
export function listCustomClasses(projectPath: string): Promise<CustomClass[]> {
  return invoke<CustomClass[]>('list_custom_classes', { projectPath });
}
