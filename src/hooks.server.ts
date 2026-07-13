import type { Handle } from '@sveltejs/kit';

// Resolve app.html's %manifest% placeholder while pages are prerendered, so the
// initial HTML of each page carries the right web-app manifest. The dAMS pilot
// must install with its own manifest (start_url /pilots/dams) — a link swapped
// in client-side comes too late for the browser's install-time evaluation and
// pinned the Miniapps manifest to home-screen shortcuts.
export function manifestFor(pathname: string): string {
	return pathname === '/pilots/dams' ? '/pilots/dams.webmanifest' : '/manifest.webmanifest';
}

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%manifest%', manifestFor(event.url.pathname))
	});
};
