import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// Consolidated Circles miniapps SPA.
// Single entry (index.html); routing is client-side (hash router) and each
// miniapp (group / org / invitations) is lazily imported and mounted into a
// shared container. The buffer polyfill + global shim are required by the
// invitation flow (private-key handling) and by some @aboutcircles SDK paths.
export default defineConfig({
  base: './',
  plugins: [
    nodePolyfills({
      include: ['buffer'],
      globals: { Buffer: true },
    }),
  ],
  server: {
    port: 5180,
  },
  define: {
    global: 'globalThis',
  },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy SDK + vendor code so each app's first paint stays light.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('@aboutcircles/miniapp-sdk')) return 'circles-miniapp';
          if (id.includes('@aboutcircles/sdk')) return 'circles-sdk';
          if (id.includes('@safe-global/safe-deployments')) return 'safe-deployments';
          if (id.includes('viem')) return 'viem';
          if (id.includes('marked')) return 'markdown';
          return 'vendor';
        },
      },
    },
  },
  optimizeDeps: {
    include: ['buffer'],
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    },
  },
});
