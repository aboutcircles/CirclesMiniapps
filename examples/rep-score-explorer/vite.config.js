import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { fileURLToPath, URL } from 'node:url';

// Self-contained standalone build of the Rep Score Explorer (deployed to Vercel,
// surfaced in the wallet at /admin/rep-score-explorer). The data layer under
// src/lib/repscore and the components under src/components are copied verbatim
// from the in-repo embedded route so this folder deploys on its own.
export default defineConfig({
  plugins: [
    svelte(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events'],
      globals: { Buffer: true, global: true, process: true }
    })
  ],
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url))
    }
  },
  optimizeDeps: {
    esbuildOptions: { define: { global: 'globalThis' } }
  }
});
