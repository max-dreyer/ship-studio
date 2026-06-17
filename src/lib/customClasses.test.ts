/**
 * Tests for the custom-classes wrapper (src/lib/customClasses.ts).
 *
 * Verifies each wrapper calls invoke() with the right command name and arg
 * shape, and returns the resolved value unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TailwindSetup, CustomClass } from './customClasses';
import { detectTailwindSetup, listCustomClasses } from './customClasses';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('lib/customClasses', () => {
  let core: typeof import('@tauri-apps/api/core');

  beforeEach(async () => {
    vi.clearAllMocks();
    core = await import('@tauri-apps/api/core');
  });

  describe('detectTailwindSetup', () => {
    it('invokes "detect_tailwind_setup" with projectPath and returns the setup', async () => {
      const setup: TailwindSetup = {
        version: 'v4',
        entryCss: 'src/index.css',
        componentsLayer: true,
      };
      vi.mocked(core.invoke).mockResolvedValue(setup);

      const result = await detectTailwindSetup('/abs/project');

      expect(core.invoke).toHaveBeenCalledTimes(1);
      expect(core.invoke).toHaveBeenCalledWith('detect_tailwind_setup', {
        projectPath: '/abs/project',
      });
      expect(result).toEqual(setup);
    });

    it('passes through a "none" setup with a null entry stylesheet', async () => {
      const setup: TailwindSetup = { version: 'none', entryCss: null, componentsLayer: false };
      vi.mocked(core.invoke).mockResolvedValue(setup);

      await expect(detectTailwindSetup('/p')).resolves.toEqual(setup);
    });
  });

  describe('listCustomClasses', () => {
    it('invokes "list_custom_classes" with projectPath and returns the classes', async () => {
      const classes: CustomClass[] = [
        { name: 'btn-primary', tokens: ['px-4', 'py-2', 'rounded'], editable: true },
        { name: 'legacy', tokens: ['p-2'], editable: false },
      ];
      vi.mocked(core.invoke).mockResolvedValue(classes);

      const result = await listCustomClasses('/abs/project');

      expect(core.invoke).toHaveBeenCalledTimes(1);
      expect(core.invoke).toHaveBeenCalledWith('list_custom_classes', {
        projectPath: '/abs/project',
      });
      expect(result).toEqual(classes);
    });

    it('returns an empty array when the project has no custom classes', async () => {
      vi.mocked(core.invoke).mockResolvedValue([]);
      await expect(listCustomClasses('/p')).resolves.toEqual([]);
    });

    it('propagates backend errors to the caller', async () => {
      vi.mocked(core.invoke).mockRejectedValue(new Error('boom'));
      await expect(listCustomClasses('/p')).rejects.toThrow('boom');
    });
  });
});
