<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { page, updated } from '$app/state';
	import { getAddress } from 'viem';
	import OfflineNotice from '$lib/OfflineNotice.svelte';
	import ChildSafePicker from '$lib/ChildSafePicker.svelte';
	import { initAnalytics, trackPageView } from '$lib/analytics';
	import '../style.css';
	import '../wallet-ui.css';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

	// The /crc-signin connector runs as the sole content of a popup iframe window,
	// so its shared overlays (the account picker) fill the whole window with no
	// close affordance. Every other route keeps the default bottom-sheet treatment.
	const isCrcSignin = $derived(page.url.pathname === '/crc-signin');

	// Run synchronously so localStorage is set before any onMount (including child pages) calls autoConnect.
	if (typeof window !== 'undefined') {
		const addressParam = new URLSearchParams(window.location.search).get('address');
		if (addressParam) {
			try {
				const normalized = getAddress(addressParam);
				localStorage.setItem('safe_address', normalized);
			} catch {
				// invalid address — ignore
			}
		}
	}

	onMount(() => {
		initAnalytics();
		// A long-lived tab or installed PWA keeps running old code after a deploy
		// (client-rendered app, nothing forces a reload). When version polling has
		// flagged an update, reload as the app returns to the foreground — never
		// mid-use, so in-flight flows aren't interrupted.
		const reloadIfUpdated = () => {
			if (document.visibilityState === 'visible' && updated.current) location.reload();
		};
		document.addEventListener('visibilitychange', reloadIfUpdated);
		return () => document.removeEventListener('visibilitychange', reloadIfUpdated);
	});

	afterNavigate((nav) => {
		if (nav.to?.url) trackPageView(nav.to.url.pathname);
	});
</script>

<OfflineNotice />
<ChildSafePicker fullPage={isCrcSignin} />
{@render children()}
