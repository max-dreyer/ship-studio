import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  // Load env from the monorepo root (where the main .env lives)
  const env = loadEnv(mode, resolve(__dirname, '../..'), '');

  return {
    define: {
      __SHIPSTUDIO_SUPABASE_URL__: JSON.stringify(env.VITE_SUPABASE_URL || ''),
      __SHIPSTUDIO_SUPABASE_ANON_KEY__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
      __SHIPSTUDIO_API_BASE_URL__: JSON.stringify(env.VITE_SHIPSTUDIO_API_URL || ''),
    },
    build: {
      lib: {
        entry: resolve(__dirname, 'src/index.ts'),
        name: 'ShipStudioEditor',
        formats: ['iife'],
        fileName: () => 'inline-editor.js',
      },
      outDir: 'dist',
      minify: 'esbuild',
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  };
});
