<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getAddress } from 'viem';
	import '../style.css';

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

</script>

{@render children()}
