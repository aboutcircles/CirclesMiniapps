// Vitest config kept separate from vite.config.ts to avoid loading the
// SvelteKit plugin (which expects a routable app environment) for pure
// unit tests. Only picks up files matching *.test.{js,ts}.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['src/**/*.test.{js,ts}'],
		environment: 'node'
	}
});
