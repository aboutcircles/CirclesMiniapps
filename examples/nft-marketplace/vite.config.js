import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5184 },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
    global: 'globalThis',
  },
});
