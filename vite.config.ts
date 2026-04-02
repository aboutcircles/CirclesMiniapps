import { sveltekit } from '@sveltejs/kit/vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { defineConfig } from 'vite';

const isLocal = process.env.LOCAL_DEV === 'true';
const baseUrl = process.env.NODE_ENV !== 'production' ? 'circles-dev.gnosis.io' : 'circles.gnosis.io';

export default defineConfig({
	plugins: [
		sveltekit(),
		nodePolyfills({
			include: ['buffer', 'process', 'util', 'stream', 'events'],
			globals: { Buffer: true, global: true, process: true }
		})
	],
	server: isLocal
		? { host: 'localhost', port: 5173 }
		: {
			host: baseUrl,
			port: 443,
			https: {
				key: `./${baseUrl}-key.pem`,
				cert: `./${baseUrl}.pem`
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
