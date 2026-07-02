<script lang="ts">
	import { fmtRelativeTime, fmtSigned, type TimelineEvent } from '$lib/repscore';
	import Skeleton from './Skeleton.svelte';

	let {
		events,
		loading = false,
		limit = 12
	}: { events: TimelineEvent[]; loading?: boolean; limit?: number } = $props();

	let showAll = $state(false);
	const shown = $derived(showAll ? events : events.slice(0, limit));
</script>

{#if loading}
	<div class="list">
		{#each Array(3) as _, i (i)}
			<div class="ev"><Skeleton width="100%" height="38px" /></div>
		{/each}
	</div>
{:else if events.length === 0}
	<p class="empty">No score changes recorded yet.</p>
{:else}
	<div class="list">
		{#each shown as ev, i (`${ev.at}:${i}`)}
			<div class="ev">
				<span
					class="chip"
					class:pos={ev.delta > 0}
					class:neg={ev.delta < 0}
					class:flat={ev.delta === 0}
				>
					{ev.delta === 0 ? '0' : fmtSigned(ev.delta)}
				</span>
				<div class="body">
					<span class="head">{ev.headline}</span>
					{#if ev.detail}
						<span class="detail">{ev.detail}</span>
					{/if}
					<span class="time">{fmtRelativeTime(new Date(ev.at).toISOString())}</span>
				</div>
			</div>
		{/each}
	</div>
	{#if events.length > limit}
		<button class="more" type="button" onclick={() => (showAll = !showAll)}>
			{showAll ? 'Show less' : `Show ${events.length - limit} more`}
		</button>
	{/if}
{/if}

<style>
	.list {
		display: flex;
		flex-direction: column;
	}
	/* Desktop: flow the event list into two columns to use the width. */
	@media (min-width: 880px) {
		.list {
			display: block;
			column-count: 2;
			column-gap: 28px;
		}
		.ev {
			break-inside: avoid;
		}
	}
	.ev {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		border-bottom: 1px solid var(--line-soft);
	}
	.ev:last-child {
		border-bottom: none;
	}
	.chip {
		flex-shrink: 0;
		min-width: 44px;
		text-align: center;
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 13px;
		font-weight: 600;
		padding: 4px 8px;
		border-radius: 9px;
		background: var(--bg-b);
		color: var(--muted);
	}
	.chip.pos {
		background: var(--success-bg);
		color: var(--success-ink);
	}
	.chip.neg {
		background: var(--error-bg);
		color: var(--error-ink);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.head {
		font-size: 13px;
		color: var(--ink);
		line-height: 1.35;
	}
	.detail {
		font-size: 11.5px;
		color: var(--muted);
		line-height: 1.4;
		margin-top: 1px;
	}
	.time {
		font-size: 11px;
		color: var(--muted);
	}
	.empty {
		font-size: 13px;
		color: var(--muted);
		text-align: center;
		padding: 18px 0;
	}
	.more {
		margin-top: 10px;
		width: 100%;
		background: var(--bg-b);
		border: 1px solid var(--line);
		border-radius: 12px;
		padding: 9px;
		color: var(--accent-mid);
		font-family: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
	}
</style>
