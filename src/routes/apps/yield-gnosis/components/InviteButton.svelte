<script lang="ts">
	import { onDestroy } from 'svelte';

	interface Props { address: string; }
	let { address }: Props = $props();

	let copied = $state(false);
	let copyTimeout: ReturnType<typeof setTimeout>;

	function invite() {
		const url = `https://circles.gnosis.io/miniapps/yield-gnosis?ref=${address}`;
		navigator.clipboard.writeText(url);
		copied = true;
		clearTimeout(copyTimeout);
		copyTimeout = setTimeout(() => (copied = false), 2000);
	}

	onDestroy(() => clearTimeout(copyTimeout));
</script>

<div class="wrap">
	<p class="label">Know someone who'd like to earn yield?</p>
	<button class="btn" onclick={invite}>
		{#if copied}
			✓ Link copied!
		{:else}
			Share invite link
		{/if}
	</button>
</div>

<style>
	.wrap  { text-align:center; padding:20px 0 4px; }
	.label { font-size:12px; color:var(--text-dim); margin:0 0 10px; }
	.btn {
		display:inline-flex; align-items:center; gap:6px;
		padding:9px 20px; border-radius:999px; font-size:13px; font-weight:700;
		background:transparent; border:1.5px solid var(--border); color:var(--text-muted);
		cursor:pointer; transition:border-color .15s, color .15s, background .15s;
	}
	.btn:hover {
		border-color:var(--blue); color:var(--blue);
		background:rgba(55,55,200,0.06);
	}
</style>
