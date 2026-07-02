<script lang="ts">
	import {
		shortAddress,
		type EdgeType,
		type Neighbour,
		type ResolvedProfile
	} from '$lib/repscore';
	import Skeleton from './Skeleton.svelte';

	let {
		neighbours,
		profiles,
		total,
		loading = false
	}: {
		neighbours: Neighbour[];
		profiles: Map<string, ResolvedProfile>;
		total: number;
		loading?: boolean;
	} = $props();

	type Filter = 'all' | EdgeType;
	let filter = $state<Filter>('all');

	const counts = $derived({
		all: neighbours.length,
		bilateral: neighbours.filter((n) => n.edge_type === 'bilateral').length,
		incoming: neighbours.filter((n) => n.edge_type === 'incoming').length,
		outgoing: neighbours.filter((n) => n.edge_type === 'outgoing').length
	});

	const filtered = $derived(
		filter === 'all' ? neighbours : neighbours.filter((n) => n.edge_type === filter)
	);

	const TABS: { key: Filter; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'bilateral', label: 'Mutual' },
		{ key: 'incoming', label: 'Inbound' },
		{ key: 'outgoing', label: 'Outbound' }
	];
	const EDGE_LABEL: Record<EdgeType, string> = {
		bilateral: 'Mutual',
		incoming: 'Inbound',
		outgoing: 'Outbound'
	};

	function prof(addr: string): ResolvedProfile | undefined {
		return profiles.get(addr.toLowerCase());
	}

	let showAll = $state(false);
	const LIMIT = 18;
	const visible = $derived(showAll ? filtered : filtered.slice(0, LIMIT));
</script>

{#if loading}
	<Skeleton width="100%" height="120px" radius="12px" />
{:else if neighbours.length === 0}
	<p class="empty">No trust connections found for this avatar.</p>
{:else}
	<p class="lead">
		{total} trust connection{total === 1 ? '' : 's'} — mutual means both sides trust each other.
	</p>
	<div class="tabs">
		{#each TABS as t (t.key)}
			<button class:active={filter === t.key} type="button" onclick={() => (filter = t.key)}>
				{t.label} <i>{counts[t.key]}</i>
			</button>
		{/each}
	</div>

	<div class="grid">
		{#each visible as n (n.address)}
			{@const p = prof(n.address)}
			<div class="nb">
				<img class="nb-img" src={p?.imageUrl} alt="" loading="lazy" decoding="async" />
				<div class="nb-body">
					<span class="nb-name" title={p?.name}>{p?.name ?? shortAddress(n.address)}</span>
					<span class="nb-addr">{shortAddress(n.address)}</span>
				</div>
				<div class="nb-meta">
					<span class="nb-score">{n.reputation_score}</span>
					<span class="nb-edge edge-{n.edge_type}">{EDGE_LABEL[n.edge_type]}</span>
				</div>
			</div>
		{/each}
	</div>

	{#if filtered.length > LIMIT}
		<button class="more" type="button" onclick={() => (showAll = !showAll)}>
			{showAll ? 'Show fewer' : `Show all ${filtered.length}`}
		</button>
	{/if}
{/if}

<style>
	.lead {
		font-size: 12px;
		color: var(--muted);
		margin: 0 0 12px;
		line-height: 1.45;
	}
	.tabs {
		display: flex;
		gap: 6px;
		margin-bottom: 12px;
		flex-wrap: wrap;
	}
	.tabs button {
		background: var(--bg-b);
		border: 1px solid var(--line);
		border-radius: var(--radius-pill);
		padding: 5px 11px;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		color: var(--muted);
		cursor: pointer;
	}
	.tabs button.active {
		background: var(--accent-soft);
		color: var(--accent);
		border-color: transparent;
	}
	.tabs button i {
		font-style: normal;
		opacity: 0.7;
		margin-left: 2px;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
	}
	@media (min-width: 440px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
	}
	@media (min-width: 880px) {
		.grid {
			grid-template-columns: 1fr 1fr 1fr;
		}
	}
	.nb {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 11px;
		background: var(--bg-b);
		border: 1px solid var(--line-soft);
		border-radius: 14px;
		min-width: 0;
	}
	.nb-img {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		flex-shrink: 0;
		object-fit: cover;
		background: var(--accent-soft);
	}
	.nb-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.nb-name {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.nb-addr {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 10px;
		color: var(--muted);
	}
	.nb-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 3px;
		flex-shrink: 0;
	}
	.nb-score {
		font-size: 14px;
		font-weight: 700;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.nb-edge {
		font-size: 9px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		padding: 1px 6px;
		border-radius: var(--radius-pill);
	}
	.edge-bilateral {
		background: var(--success-bg);
		color: var(--success-ink);
	}
	.edge-incoming {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.edge-outgoing {
		background: var(--warn-bg);
		color: var(--warn-ink);
	}
	.more {
		margin-top: 12px;
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
	.empty {
		font-size: 13px;
		color: var(--muted);
		text-align: center;
		padding: 18px 0;
	}
</style>
