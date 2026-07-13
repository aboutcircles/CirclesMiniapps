import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			fallback: '404.html'
		}),
		// Poll version.json so long-lived tabs / installed PWAs notice deploys;
		// the root layout reloads when the app returns to the foreground.
		version: { pollInterval: 60_000 }
	}
};

export default config;
