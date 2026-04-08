/// <reference no-default-lib="true" />
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { base, build, files, prerendered, version } from '$service-worker';

const self = globalThis as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `app-cache-${version}`;
const RUNTIME_CACHE = `runtime-cache-${version}`;
const OFFLINE_URL = `${base}/offline`;

const PRECACHE_ASSETS = Array.from(
	new Set([
		...build,
		...files,
		...prerendered,
		OFFLINE_URL
	])
);

const JSON_PATHS = new Set([
	`${base}/miniapps.json`,
	`${base}/snapshot.json`
]);

self.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(APP_CACHE);
			await cache.addAll(PRECACHE_ASSETS);
			await self.skipWaiting();
		})()
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((key) => key !== APP_CACHE && key !== RUNTIME_CACHE)
					.map((key) => caches.delete(key))
			);
			await self.clients.claim();
		})()
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;

	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	if (url.origin !== self.location.origin) return;

	if (JSON_PATHS.has(url.pathname)) {
		event.respondWith(handleJson(request));
		return;
	}

	if (PRECACHE_ASSETS.includes(url.pathname)) {
		event.respondWith(servePrecached(url.pathname));
		return;
	}

	if (request.mode === 'navigate') {
		event.respondWith(handleNavigation(request));
		return;
	}

	if (request.destination === 'image' || url.pathname.startsWith(`${base}/app-logos/`)) {
		event.respondWith(handleStaticAsset(request));
		return;
	}
});

async function servePrecached(pathname: string): Promise<Response> {
	const cached = await caches.match(pathname);
	if (cached) return cached;
	return fetch(pathname);
}

async function handleNavigation(request: Request): Promise<Response> {
	const runtime = await caches.open(RUNTIME_CACHE);
	const cached = await caches.match(request);

	try {
		const response = await fetch(request);
		if (response.ok) {
			await runtime.put(request, response.clone());
		}
		return response;
	} catch (error) {
		if (cached) return cached;

		const offline = await caches.match(OFFLINE_URL);
		if (offline) return offline;

		throw error;
	}
}

async function handleJson(request: Request): Promise<Response> {
	const runtime = await caches.open(RUNTIME_CACHE);
	const cached = await caches.match(request);

	const network = fetch(request)
		.then(async (response) => {
			if (response.ok) {
				await runtime.put(request, response.clone());
			}
			return response;
		})
		.catch(() => null);

	if (cached) {
		void network;
		return cached;
	}

	const response = await network;
	if (response) return response;

	return new Response('Offline', {
		status: 503,
		statusText: 'Offline'
	});
}

async function handleStaticAsset(request: Request): Promise<Response> {
	const runtime = await caches.open(RUNTIME_CACHE);
	const cached = await caches.match(request);
	if (cached) return cached;

	const response = await fetch(request);
	if (response.ok) {
		await runtime.put(request, response.clone());
	}
	return response;
}
