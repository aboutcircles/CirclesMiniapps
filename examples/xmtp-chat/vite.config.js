import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Plugin to add CORS headers required for XMTP SDK
const corsHeadersPlugin = () => ({
  name: 'cors-headers',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

      // Set correct MIME type for WASM files
      if (req.url?.endsWith('.wasm')) {
        res.setHeader('Content-Type', 'application/wasm');
      }

      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), corsHeadersPlugin()],
  // Set base path for GitHub Pages deployment
  base: process.env.NODE_ENV === 'production' ? '/miniappDemo/xmtp-chat/' : '/',
  server: {
    port: 5182,
  },
  build: {
    outDir: 'dist',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  optimizeDeps: {
    include: ['protobufjs/minimal'],
    exclude: ['@xmtp/browser-sdk'],
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
    },
  },
  worker: {
    format: 'es',
  },
});
