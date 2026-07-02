<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { StageStatus } from '$lib/repscore';

	let {
		title,
		subtitle,
		inactive = null,
		children
	}: {
		title?: string;
		subtitle?: string;
		inactive?: StageStatus | null;
		children?: Snippet;
	} = $props();
</script>

<section class="card" class:dim={inactive ? !inactive.active : false}>
	{#if title}
		<header class="card-head">
			<div class="titles">
				<h2>{title}</h2>
				{#if subtitle}<p class="sub">{subtitle}</p>{/if}
			</div>
			{#if inactive && !inactive.active}
				<span class="pill" title={inactive.reason}>Not active</span>
			{/if}
		</header>
	{/if}
	{#if inactive && !inactive.active}
		<p class="inactive-reason">{inactive.reason}</p>
	{/if}
	<div class="card-body">
		{@render children?.()}
	</div>
</section>

<style>
	.card {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 18px;
		margin-bottom: 14px;
	}
	.card.dim {
		opacity: 0.72;
	}
	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}
	.titles {
		min-width: 0;
	}
	h2 {
		font-size: 15px;
		font-weight: 600;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.01em;
	}
	.sub {
		font-size: 12px;
		color: var(--muted);
		margin: 3px 0 0;
		line-height: 1.4;
	}
	.pill {
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		background: var(--bg-b);
		border: 1px solid var(--line);
		border-radius: var(--radius-pill);
		padding: 3px 10px;
		white-space: nowrap;
	}
	.inactive-reason {
		font-size: 12px;
		color: var(--muted);
		margin: -4px 0 12px;
		line-height: 1.4;
	}
</style>
