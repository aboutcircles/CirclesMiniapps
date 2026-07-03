<script lang="ts">
	import {
		behaviourBreakdown,
		fmtNumber,
		fmtPct01,
		type AvatarScore,
		type DerivedScore,
		type RepConfig,
		type StageKey,
		type StageStatus
	} from '$lib/repscore';
	import CompositionBar from './CompositionBar.svelte';

	let {
		avatar,
		score,
		cfg,
		stages,
		gateActive = false
	}: {
		avatar: AvatarScore;
		score: DerivedScore;
		cfg: RepConfig;
		stages: Record<StageKey, StageStatus>;
		gateActive?: boolean;
	} = $props();

	const behaviour = $derived(avatar.components!.behaviour);
	const boost = $derived(avatar.components!.boost);
	const bd = $derived(behaviourBreakdown(behaviour, cfg));

	const metrics = $derived([
		{
			key: 'R',
			label: 'Retention',
			value: behaviour.R_bar,
			weight: bd.weights.R,
			contribution: bd.rContribution,
			explain: 'How steadily you hold value over time rather than passing it straight through.'
		},
		{
			key: 'Q',
			label: 'Outflow discipline',
			value: behaviour.Q_bar,
			weight: bd.weights.Q,
			contribution: bd.qContribution,
			explain: 'Sending value mostly to trusted, qualified peers.'
		},
		{
			key: 'I',
			label: 'Qualified inflow',
			value: behaviour.I_bar,
			weight: bd.weights.I,
			contribution: bd.iContribution,
			explain: 'Receiving value from trusted, qualified peers.'
		}
	]);

	const SOURCE_LABELS: Record<string, string> = {
		backer: 'Backer',
		pay_kyc: 'Verified human (KYC)',
		dappcon26: 'DappCon 2026'
	};
	function sourceLabel(name: string): string {
		return SOURCE_LABELS[name] ?? name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
	}
	const staticSources = $derived(Object.entries(boost.b_static_sources ?? {}));
	const momentumPts = $derived(score.gamma * boost.B_delta);
</script>

<div class="bd-cols">
<div class="block">
	<h3>Behaviour <span class="agg">s<sub>b</sub> = {fmtPct01(bd.sB)}</span></h3>
	<p class="lead">Your conduct in the network, weighted into a single behaviour score.</p>
	{#each metrics as m (m.key)}
		<div class="metric">
			<div class="metric-head">
				<span class="m-label">{m.label}</span>
				<span class="m-val">{fmtPct01(m.value)} <i>× {fmtNumber(m.weight, 2)}</i></span>
			</div>
			<div class="track"><div class="fill" style="width:{Math.max(0, Math.min(1, m.value)) * 100}%"></div></div>
			<p class="m-explain">{m.explain}</p>
		</div>
	{/each}
</div>

<div class="block">
	<h3>Boosts <span class="agg">B<sub>total</sub> = {fmtNumber(score.bTotal, 1)}</span></h3>
	<p class="lead">Extra credit on top of behaviour. The score takes the larger of static and legacy credit, plus momentum.</p>

	<div class="boost-group">
		<span class="bg-title">Static sources</span>
		{#if staticSources.length === 0}
			<p class="none">No static boosts for this avatar.</p>
		{:else}
			{#each staticSources as [name, pts] (name)}
				<div class="boost-row">
					<span>{sourceLabel(name)}</span>
					<span class="pts">+{fmtNumber(pts, 0)}</span>
				</div>
			{/each}
		{/if}
		<div class="boost-row subtotal">
			<span>Static total{score.legacyActive ? '' : ' (used)'}</span>
			<span class="pts">+{fmtNumber(boost.B_static, 1)}</span>
		</div>
	</div>

	<div class="boost-group" class:dim={!stages.legacy.active}>
		<span class="bg-title">Legacy credit</span>
		<div class="boost-row">
			<span>From the previous scoring era {score.legacyActive ? '(currently winning)' : '(not the larger term)'}</span>
			<span class="pts">+{fmtNumber(boost.B_legacy, 1)}</span>
		</div>
	</div>

	<div class="boost-group" class:dim={!stages.momentum.active}>
		<span class="bg-title">Momentum</span>
		<div class="boost-row">
			<span>Recent positive change, amplified ×{fmtNumber(score.gamma, 0)}</span>
			<span class="pts">+{fmtNumber(momentumPts, 1)}</span>
		</div>
	</div>

	{#if !stages.network.active}
		<p class="inactive">Network boost is {stages.network.reason.toLowerCase()}</p>
	{/if}
</div>
</div>

<div class="block">
	<h3>Composition</h3>
	<p class="lead">How the parts combine into the number at the top.</p>
	<CompositionBar {score} {gateActive} />
</div>

<style>
	.block {
		padding: 14px 0;
		border-top: 1px solid var(--line-soft);
	}
	.block:first-child {
		padding-top: 2px;
		border-top: none;
	}
	/* Desktop: Behaviour and Boosts sit side by side. */
	@media (min-width: 880px) {
		.bd-cols {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 0 32px;
			align-items: start;
		}
		.bd-cols > .block {
			border-top: none;
			padding-top: 2px;
		}
	}
	h3 {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		margin: 0 0 4px;
	}
	.agg {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 12px;
		font-weight: 600;
		color: var(--accent-mid);
	}
	.lead {
		font-size: 12px;
		color: var(--muted);
		margin: 0 0 12px;
		line-height: 1.45;
	}
	.metric {
		margin-bottom: 13px;
	}
	.metric-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}
	.m-label {
		font-size: 13px;
		font-weight: 600;
		color: var(--ink);
	}
	.m-val {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-size: 12px;
		color: var(--ink);
	}
	.m-val i {
		color: var(--muted);
		font-style: normal;
	}
	.track {
		height: 7px;
		background: var(--bg-b);
		border-radius: var(--radius-pill);
		overflow: hidden;
		margin: 6px 0 5px;
	}
	.fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent-mid), var(--accent));
		border-radius: var(--radius-pill);
	}
	.m-explain {
		font-size: 11px;
		color: var(--muted);
		margin: 0;
		line-height: 1.4;
	}
	.boost-group {
		margin-top: 12px;
	}
	.boost-group.dim {
		opacity: 0.6;
	}
	.bg-title {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		font-weight: 600;
	}
	.boost-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		padding: 6px 0;
		font-size: 13px;
		color: var(--ink);
		border-bottom: 1px solid var(--line-soft);
	}
	.boost-row:last-child {
		border-bottom: none;
	}
	.boost-row.subtotal {
		font-weight: 600;
	}
	.pts {
		font-family: 'JetBrains Mono', ui-monospace, monospace;
		font-weight: 600;
		color: var(--accent);
		flex-shrink: 0;
	}
	.none {
		font-size: 12px;
		color: var(--muted);
		margin: 6px 0 0;
	}
	.inactive {
		font-size: 12px;
		color: var(--muted);
		margin: 10px 0 0;
		font-style: italic;
	}
</style>
