<script lang="ts">
	import { fmtNumber, type DerivedScore } from '$lib/repscore';

	let { score, gateActive = false }: { score: DerivedScore; gateActive?: boolean } = $props();

	// Proportional base-vs-boosts split, only meaningful when both are >= 0.
	const showBar = $derived(score.base >= 0 && score.bTotal >= 0 && score.sUserRaw > 0);
	const scale = $derived(Math.max(score.sUserRaw, 100) * 1.04);
	const basePct = $derived(showBar ? (score.base / scale) * 100 : 0);
	const boostPct = $derived(showBar ? (score.bTotal / scale) * 100 : 0);
	const capPct = $derived((100 / scale) * 100);
	const aboveRef = $derived(score.headline > 100);
</script>

<div class="comp">
	{#if showBar}
		<div class="bar">
			<div class="seg base" style="width:{basePct}%" title="Behaviour base"></div>
			<div class="seg boost" style="width:{boostPct}%" title="Boosts"></div>
			<div class="cap" style="left:{capPct}%" title="100 reference line"></div>
		</div>
		<div class="legend">
			<span><i class="dot base"></i>Behaviour base</span>
			<span><i class="dot boost"></i>Boosts</span>
			<span class="cap-note">⟂ 100</span>
		</div>
	{/if}

	<div class="steps">
		<div class="step">
			<span>Behaviour base</span>
			<span class="num">{fmtNumber(score.base, 1)}</span>
		</div>
		<div class="step">
			<span>+ Boosts</span>
			<span class="num">{fmtNumber(score.bTotal, 1)}</span>
		</div>
		<div class="step total">
			<span>= Raw score</span>
			<span class="num">{fmtNumber(score.sUserRaw, 1)}</span>
		</div>
		{#if gateActive}
			<div class="step">
				<span>× Liveness</span>
				<span class="num">×{fmtNumber(score.livenessFactor, 2)}</span>
			</div>
		{:else}
			<div class="step muted">
				<span>× Liveness (gate off)</span>
				<span class="num">×1.00</span>
			</div>
		{/if}
		<div class="step display">
			<span>Displayed score</span>
			<span class="num">{score.headline}{#if aboveRef}<i class="cap-tag">above 100</i>{/if}</span>
		</div>
	</div>
</div>

<style>
	.comp {
		margin-top: 4px;
	}
	.bar {
		position: relative;
		display: flex;
		height: 16px;
		background: var(--bg-b);
		border-radius: var(--radius-pill);
		overflow: hidden;
		border: 1px solid var(--line);
	}
	.seg {
		height: 100%;
	}
	.seg.base {
		background: var(--accent-mid);
		opacity: 0.45;
	}
	.seg.boost {
		background: var(--accent);
	}
	.cap {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		background: var(--ink);
		opacity: 0.5;
	}
	.legend {
		display: flex;
		gap: 14px;
		margin-top: 8px;
		font-size: 11px;
		color: var(--muted);
		flex-wrap: wrap;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		display: inline-block;
	}
	.dot.base {
		background: var(--accent-mid);
		opacity: 0.45;
	}
	.dot.boost {
		background: var(--accent);
	}
	.steps {
		margin-top: 14px;
	}
	.step {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		padding: 6px 0;
		font-size: 13px;
		color: var(--ink);
	}
	.step .num {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.step.muted {
		color: var(--muted);
	}
	.step.total {
		border-top: 1px solid var(--line-soft);
		margin-top: 4px;
		padding-top: 10px;
		font-weight: 600;
	}
	.step.display {
		border-top: 1px solid var(--line);
		margin-top: 4px;
		padding-top: 10px;
		font-weight: 700;
	}
	.step.display .num {
		color: var(--accent);
		font-size: 16px;
	}
	.cap-tag {
		font-style: normal;
		font-family: inherit;
		font-size: 10px;
		font-weight: 600;
		color: var(--muted);
		margin-left: 8px;
	}
</style>
