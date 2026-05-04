<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { wallet } from '$lib/wallet.svelte.ts';
	import IframeHost from '$lib/IframeHost.svelte';
	import AppNavigation from '$lib/AppNavigation.svelte';

	const baseUrl = import.meta.env.VITE_BASE_URL;

	type MiniApp = { slug?: string; name: string; logo: string; url: string; description?: string; tags: string[]; isHidden?: boolean };

	let app: MiniApp | null = $state(null);
	let notFound = $state(false);
	let iframeSrc = $state('');
	let isOffline = $state(false);

	onMount(() => {
		const syncOnlineState = () => {
			isOffline = !navigator.onLine;
		};

		syncOnlineState();
		window.addEventListener('online', syncOnlineState);
		window.addEventListener('offline', syncOnlineState);

		wallet.autoConnectAndPick();

		fetch('/miniapps.json')
			.then((r) => r.json())
			.then((data: MiniApp[]) => {
				const currentSlug = $page.params.slug;
				const found = data.find((a) => a.slug === currentSlug);
				if (found) {
					app = found;
					iframeSrc = found.url;
				} else {
					notFound = true;
				}
			})
			.catch(() => {
				notFound = true;
			});

		return () => {
			window.removeEventListener('online', syncOnlineState);
			window.removeEventListener('offline', syncOnlineState);
		};
	});

	function goBack() {
		goto('/miniapps');
	}
</script>

<svelte:head>
	<title>{app ? app.name : 'Mini App'} - {baseUrl}</title>
</svelte:head>

<div class="page">
	{#if notFound}
		<div class="iframe-topbar">
			<div class="topbar-left">
				<button class="back-btn" onclick={goBack}>&#8592; back</button>
				<AppNavigation />
			</div>
		</div>
		<div class="not-found">
			<p>App not found.</p>
		</div>
	{:else}
		<IframeHost
			src={iframeSrc}
			iframeTitle={app ? app.name : 'Mini App'}
			sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation-by-user-activation"
			onBack={goBack}
			getAppData={() => $page.url.searchParams.get('data')}
			{isOffline}
		>
			{#snippet offlineState()}
				<div class="offline-frame-state">
					<h2>Mini app unavailable offline</h2>
					<p>
						This mini app is embedded from its own site, so it can&apos;t load until your
						connection returns. The cached Circles shell is still available.
					</p>
				</div>
			{/snippet}
		</IframeHost>
	{/if}
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
	}

	.offline-frame-state {
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px;
		text-align: center;
		background:
			radial-gradient(700px 240px at 50% 0%, rgba(14, 0, 168, 0.05) 0%, transparent 70%),
			linear-gradient(145deg, rgba(250, 245, 241, 0.85), rgba(246, 247, 249, 0.88));
	}

	.offline-frame-state h2 {
		margin: 0 0 10px;
		font-size: 22px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	.offline-frame-state p {
		margin: 0;
		max-width: 420px;
		font-size: 14px;
		line-height: 1.6;
		color: var(--muted);
	}

	.not-found {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--muted);
		font-size: 15px;
	}
</style>
