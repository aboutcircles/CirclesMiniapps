import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit(),
		nodePolyfills({
			include: ['buffer', 'process', 'util', 'stream', 'events'],
			globals: { Buffer: true, global: true, process: true }
		})
	],
	server: {
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
