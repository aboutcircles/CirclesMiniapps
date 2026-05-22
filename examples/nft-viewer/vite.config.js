import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/ipfs': {
        target: 'https://ipfs.io',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ipfs/, ''),
      },
    },
  },
});