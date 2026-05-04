<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { wallet } from '$lib/wallet.svelte.ts';
	import IframeHost from '$lib/IframeHost.svelte';
	import AppNavigation from '$lib/AppNavigation.svelte';

	const baseUrl = import.meta.env.VITE_BASE_URL;

	type MiniApp = { slug?: string; name: string; logo: string; url: string; description?: string; tags: string[]; isHidden?: boolean; category?: string };

	let app: MiniApp | null = $state(null);
	let notFound = $state(false);
	let iframeSrc = $state('');

	onMount(() => {
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
	});

	function goBack() {
		goto('/admin');
	}
</script>

<svelte:head>
	<title>{app ? app.name : 'Admin App'} - {baseUrl}</title>
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
			iframeTitle={app ? app.name : 'Admin App'}
			sandbox="allow-scripts allow-forms allow-same-origin allow-top-navigation allow-popups"
			onBack={goBack}
			getAppData={() => $page.url.searchParams.get('data')}
		/>
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

	.not-found {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--muted);
		font-size: 15px;
	}
</style>
