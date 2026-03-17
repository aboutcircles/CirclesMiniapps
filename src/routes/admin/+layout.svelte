<script lang="ts">
	import type { Snippet } from 'svelte';
	import Disclaimer from '$lib/Disclaimer.svelte';

	interface Props {
		children: Snippet;
	}

	const { children }: Props = $props();
</script>

<Disclaimer />
{@render children()}
