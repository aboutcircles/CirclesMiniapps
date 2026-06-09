<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { getAddress } from 'viem';
	import Disclaimer from '$lib/Disclaimer.svelte';
	import OfflineNotice from '$lib/OfflineNotice.svelte';
	import ChildSafePicker from '$lib/ChildSafePicker.svelte';
	import { initAnalytics, trackPageView } from '$lib/analytics';
	import '../style.css';
	import '../wallet-ui.css';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();

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
	});

	afterNavigate((nav) => {
		if (nav.to?.url) trackPageView(nav.to.url.pathname);
	});
</script>

<Disclaimer />
<OfflineNotice />
<ChildSafePicker />
{@render children()}
