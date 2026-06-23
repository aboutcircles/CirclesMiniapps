<script lang="ts">
	import {
		buildLinePath,
		nearestIndex,
		fmtSigned,
		type ChartPoint,
		type ChartSummary,
		type Timeframe
	} from '$lib/repscore';
	import Skeleton from './Skeleton.svelte';

	let {
		points,
		timeframe,
		ontimeframe,
		summary,
		loading = false
	}: {
		points: ChartPoint[];
		timeframe: Timeframe;
		ontimeframe: (tf: Timeframe) => void;
		summary: ChartSummary | null;
		loading?: boolean;
	} = $props();

	const W = 320;
	const H = 120;
	const PAD = 10;

	const path = $derived(buildLinePath(points, W, H, PAD));
	const timeframes: Timeframe[] = ['24h', '7d', '30d', 'all'];

	let svgEl: SVGSVGElement | null = $state(null);
	let hoverIdx = $state(-1);

	function onmove(e: PointerEvent) {
		if (!svgEl || points.length < 2) return;
		const rect = svgEl.getBoundingClientRect();
		const vx = ((e.clientX - rect.left) / rect.width) * W;
		hoverIdx = nearestIndex(path.xs, vx);
	}
	function onleave() {
		hoverIdx = -1;
	}

	const hover = $derived(hoverIdx >= 0 && hoverIdx < points.length ? points[hoverIdx] : null);
	function fmtDay(t: number): string {
		return new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
	}
</script>

<div class="chart-wrap">
	<div class="topline">
		<div class="summary">
			{#if loading}
				<Skeleton width="90px" height="22px" />
			{:else if summary}
				<span class="now">{summary.last}</span>
				<span
					class="delta"
					class:pos={summary.deltaAbs > 0}
					class:neg={summary.deltaAbs < 0}
				>
					{fmtSigned(summary.deltaAbs)}{#if summary.deltaPct !== null}
						<span class="pct">({fmtSigned(Math.round(summary.deltaPct))}%)</span>{/if}
				</span>
			{:else}
				<span class="now muted">—</span>
			{/if}
		</div>
		<div class="tf">
			{#each timeframes as tf (tf)}
				<button class:active={tf === timeframe} type="button" onclick={() => ontimeframe(tf)}>
					{tf}
				</button>
			{/each}
		</div>
	</div>

	{#if loading}
		<Skeleton width="100%" height="140px" radius="12px" />
	{:else if points.length < 2}
		<div class="empty">
			{points.length === 1 ? 'Only one data point so far — not enough to chart yet.' : 'No history in this timeframe.'}
		</div>
	{:else}
		<div class="svg-box">
			<svg
				bind:this={svgEl}
				viewBox="0 0 {W} {H}"
				preserveAspectRatio="none"
				class="chart"
				role="img"
				aria-label="Reputation score over time"
				onpointermove={onmove}
				onpointerleave={onleave}
			>
				<defs>
					<linearGradient id="rs-area" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="var(--accent-mid)" stop-opacity="0.22" />
						<stop offset="100%" stop-color="var(--accent-mid)" stop-opacity="0" />
					</linearGradient>
				</defs>
				<path d={path.area} fill="url(#rs-area)" />
				<path
					d={path.line}
					fill="none"
					stroke="var(--accent)"
					stroke-width="2"
					stroke-linejoin="round"
					stroke-linecap="round"
					vector-effect="non-scaling-stroke"
				/>
				{#if hover && hoverIdx >= 0}
					<line
						x1={path.xs[hoverIdx]}
						y1={PAD}
						x2={path.xs[hoverIdx]}
						y2={H - PAD}
						stroke="var(--line)"
						stroke-width="1"
						vector-effect="non-scaling-stroke"
					/>
					<circle cx={path.xs[hoverIdx]} cy={path.ys[hoverIdx]} r="3.5" fill="var(--accent)" />
				{:else}
					<circle cx={path.xs[path.xs.length - 1]} cy={path.ys[path.ys.length - 1]} r="3.5" fill="var(--accent)" />
				{/if}
			</svg>
			{#if hover}
				<div class="tip" style="left: {(path.xs[hoverIdx] / W) * 100}%">
					<strong>{hover.live}</strong>
					<span>{fmtDay(hover.t)}</span>
				</div>
			{/if}
		</div>
		<div class="axis">
			<span>{fmtDay(points[0].t)}</span>
			<span>{fmtDay(points[points.length - 1].t)}</span>
		</div>
	{/if}
</div>

<style>
	.chart-wrap {
		width: 100%;
	}
	.topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 12px;
	}
	.summary {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}
	.now {
		font-size: 22px;
		font-weight: 700;
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}
	.now.muted {
		color: var(--muted);
	}
	.delta {
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.delta.pos {
		color: var(--success-ink);
	}
	.delta.neg {
		color: var(--error-ink);
	}
	.pct {
		opacity: 0.75;
		font-weight: 500;
	}
	.tf {
		display: inline-flex;
		background: var(--bg-b);
		border: 1px solid var(--line);
		border-radius: var(--radius-pill);
		padding: 2px;
	}
	.tf button {
		border: none;
		background: transparent;
		color: var(--muted);
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		padding: 5px 10px;
		border-radius: var(--radius-pill);
		cursor: pointer;
	}
	.tf button.active {
		background: var(--card);
		color: var(--accent);
		box-shadow: 0 1px 3px rgba(5, 6, 26, 0.08);
	}
	.svg-box {
		position: relative;
	}
	.chart {
		width: 100%;
		height: 140px;
		display: block;
		touch-action: none;
	}
	.tip {
		position: absolute;
		top: -2px;
		transform: translateX(-50%);
		background: var(--ink);
		color: #fff;
		border-radius: 8px;
		padding: 4px 8px;
		font-size: 11px;
		display: flex;
		gap: 6px;
		align-items: baseline;
		pointer-events: none;
		white-space: nowrap;
	}
	.tip strong {
		font-variant-numeric: tabular-nums;
	}
	.tip span {
		opacity: 0.7;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin-top: 6px;
		font-size: 11px;
		color: var(--muted);
	}
	.empty {
		padding: 28px 12px;
		text-align: center;
		font-size: 13px;
		color: var(--muted);
		background: var(--bg-b);
		border-radius: 12px;
	}
</style>
