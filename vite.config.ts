import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { defineConfig } from 'vite';

const isDev = process.env.NODE_ENV !== 'production';

export default defineConfig({
  plugins: [
    sveltekit(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events'],
      globals: { Buffer: true, global: true, process: true }
    })
  ],
  server: isDev
    ? {
        host: 'circles-dev.gnosis.io',
        port: 443,
        https: {
          key: './circles-dev.gnosis.io-key.pem',
          cert: './circles-dev.gnosis.io.pem'
        }
      }
    : {
        host: 'circles.gnosis.io',
        port: 443,
        https: {
          key: './circles.gnosis.io-key.pem',
          cert: './circles.gnosis.io.pem'
        }
      },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: 'globalThis' }
    }
  },
  resolve: {
    alias: {
      process: 'process/browser',
      buffer: 'buffer',
      util: 'util'
    }
  }
});
