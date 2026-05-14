import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.js', 'api/**/*.test.js'],
    exclude: ['node_modules/**', 'contracts/**', 'dist/**'],
    environment: 'node',
  },
});
