<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { wallet } from '$lib/wallet.svelte';
	import IframeHost from '$lib/IframeHost.svelte';

	const baseUrl = import.meta.env.VITE_BASE_URL;

	let iframeSrc = $state('');
	let urlInput = $state('');
	let isOffline = $state(false);
	// Bumped on every Load click: keys the IframeHost so the embedded app
	// reloads even when the URL didn't change (same-src assignment is a no-op).
	let reloadNonce = $state(0);

	onMount(() => {
		const syncOnlineState = () => {
			isOffline = !navigator.onLine;
		};

		syncOnlineState();
		window.addEventListener('online', syncOnlineState);
		window.addEventListener('offline', syncOnlineState);
		wallet.autoConnectAndPick();

		const initialUrl = $page.url.searchParams.get('url') ?? '';
		urlInput = initialUrl;
		iframeSrc = initialUrl;

		return () => {
			window.removeEventListener('online', syncOnlineState);
			window.removeEventListener('offline', syncOnlineState);
		};
	});

	async function handleLoad() {
		const nextUrl = urlInput.trim();
		iframeSrc = nextUrl;
		reloadNonce += 1;

		// Keep the shareable ?url= param in sync with what's loaded.
		const search = nextUrl ? `?url=${encodeURIComponent(nextUrl)}` : '';
		await goto(`/playground${search}`, {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	function goBack() {
		goto('/miniapps');
	}
</script>

<svelte:head>
	<title>Circles Playground - {baseUrl}</title>
</svelte:head>

<div class="page">
	{#key reloadNonce}
	<IframeHost
		src={iframeSrc}
		iframeTitle="Playground Mini App"
		sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation-by-user-activation"
		onBack={goBack}
		backLabel="mini apps"
		title="Playground"
		{isOffline}
	>
		{#snippet beforeIframe()}
			<div class="url-bar">
				<input
					type="text"
					bind:value={urlInput}
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === 'Enter') handleLoad();
					}}
					placeholder="Enter app URL..."
				/>
				<button class="load-btn" onclick={handleLoad}>Load</button>
			</div>
		{/snippet}

		{#snippet offlineState()}
			<div class="offline-frame-state">
				<h2>Playground needs a connection</h2>
				<p>
					The playground embeds a live mini app URL, so it cannot
					load while offline. Reconnect to continue testing.
				</p>
			</div>
		{/snippet}

		{#snippet emptyState()}
			<div class="empty-state">
				<h2>Load any mini app URL</h2>
				<p>Use this playground to load and test any mini app URL.</p>
			</div>
		{/snippet}
	</IframeHost>
	{/key}
</div>

<style>
	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		max-width: 720px;
		margin: 0 auto;
		padding: 12px 8px;
		box-sizing: border-box;
		overflow-x: hidden;
		gap: 16px;
	}

	.url-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(6px);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-card);
		flex-shrink: 0;
	}

	.url-bar input {
		flex: 1;
		padding: 6px 10px;
		border: 1px solid var(--line);
		border-radius: 8px;
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 12px;
		color: var(--ink);
		background: var(--bg-a);
		outline: none;
		transition: border-color 0.15s;
	}

	.url-bar input:focus {
		border-color: var(--accent-mid);
	}

	.load-btn {
		background: linear-gradient(130deg, var(--accent), var(--accent-mid));
		color: #fff;
		border: none;
		border-radius: var(--radius-pill);
		padding: 7px 16px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity 0.15s;
	}

	.load-btn:hover {
		opacity: 0.85;
	}

	.offline-frame-state,
	.empty-state {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px;
		text-align: center;
	}

	.offline-frame-state {
		background:
			radial-gradient(700px 240px at 50% 0%, rgba(14, 0, 168, 0.05) 0%, transparent 70%),
			linear-gradient(145deg, rgba(250, 245, 241, 0.85), rgba(246, 247, 249, 0.88));
	}

	.offline-frame-state h2,
	.empty-state h2 {
		margin: 0 0 10px;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	.offline-frame-state p,
	.empty-state p {
		margin: 0;
		max-width: 420px;
		font-size: 14px;
		line-height: 1.6;
		color: var(--muted);
	}
</style>
