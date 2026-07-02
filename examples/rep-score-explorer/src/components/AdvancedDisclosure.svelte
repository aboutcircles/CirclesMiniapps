<script lang="ts">
	import { fmtNumber, type AvatarScore, type DerivedScore, type RepConfig } from '$lib/repscore';
	import StatRow from './StatRow.svelte';

	let {
		avatar,
		score,
		cfg,
		inline = false
	}: { avatar: AvatarScore; score: DerivedScore; cfg: RepConfig; inline?: boolean } = $props();

	const gate = $derived(avatar.components?.gate?.live ?? null);
	const d = $derived(cfg.defaults);
</script>

{#snippet groups()}
	<div class="grp">
		<span class="grp-title">Score assembly</span>
		<StatRow label="s_b (behaviour)" value={fmtNumber(score.sB, 6)} mono />
		<StatRow label="s_eff" value={fmtNumber(score.sEff, 6)} mono />
		<StatRow label="base = 100·(2·s_eff−1)" value={fmtNumber(score.base, 4)} mono />
		<StatRow label="B_static" value={fmtNumber(score.bStatic, 4)} mono />
		<StatRow
			label="B_legacy"
			hint={score.legacyActive ? 'active (larger term)' : 'inactive'}
			value={fmtNumber(score.bLegacy, 4)}
			mono
		/>
		<StatRow label="B_delta" value={fmtNumber(score.bDelta, 6)} mono />
		<StatRow label="gamma (×B_delta)" value={fmtNumber(score.gamma, 2)} mono />
		<StatRow label="B_total" value={fmtNumber(score.bTotal, 4)} mono />
		<StatRow label="s_user_raw" value={fmtNumber(score.sUserRaw, 4)} mono />
		<StatRow label="liveness_factor" value={fmtNumber(score.livenessFactor, 4)} mono />
		<StatRow label="s_user_gated" value={fmtNumber(score.sUserGated, 4)} mono />
		<StatRow
			label="reputation_score_live (signed)"
			value={String(score.apiLive)}
			mono
			tone={score.isNegative ? 'neg' : 'default'}
		/>
		<StatRow label="reputation_score (settled)" value={String(avatar.reputation_score ?? '—')} mono />
		<StatRow label="s_user (clipped 0–100)" value={fmtNumber(score.clipped, 2)} mono />
	</div>

	{#if gate}
		<div class="grp">
			<span class="grp-title">Gate snapshot (live)</span>
			<StatRow label="gate_triggered" value={String(gate.gate_triggered)} mono />
			<StatRow label="gate_debt" value={fmtNumber(gate.gate_debt, 2)} mono />
			<StatRow label="score_uint" value={String(gate.score_uint)} mono />
		</div>
	{/if}

	<div class="grp">
		<span class="grp-title">Active configuration</span>
		<StatRow label="weights R / Q / I" value={`${d.behaviour.weights.R} / ${d.behaviour.weights.Q} / ${d.behaviour.weights.I}`} mono />
		<StatRow label="propagation.aggregation" value={String(d.propagation.aggregation)} mono />
		<StatRow label="network.per_bilateral" value={String(d.boost.network.per_bilateral)} mono />
		<StatRow label="delta.gamma" value={String(d.boost.delta.gamma)} mono />
		<StatRow label="legacy.enabled" value={String(d.boost.legacy.enabled)} mono />
		<StatRow label="gate.penalty" value={String(d.gate.penalty)} mono />
		<StatRow label="composition.mode" value={String(d.composition.mode)} mono />
	</div>

	{#if avatar.computed_at || avatar.source || avatar.algorithm}
		<div class="grp">
			<span class="grp-title">Meta</span>
			{#if avatar.algorithm}<StatRow label="algorithm" value={String(avatar.algorithm)} mono />{/if}
			{#if avatar.source}<StatRow label="source" value={String(avatar.source)} mono />{/if}
			{#if avatar.computed_at}<StatRow label="computed_at" value={String(avatar.computed_at)} mono />{/if}
		</div>
	{/if}
{/snippet}

{#if inline}
	<div class="adv-card">
		<div class="groups cols">{@render groups()}</div>
	</div>
{:else}
	<details class="adv">
		<summary>
			<span>Advanced — raw pipeline values</span>
			<span class="chev">▾</span>
		</summary>
		<div class="groups">{@render groups()}</div>
	</details>
{/if}

<style>
	.adv,
	.adv-card {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		margin-bottom: 14px;
	}
	.adv {
		padding: 4px 18px;
	}
	.adv-card {
		padding: 16px 18px;
	}
	summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		cursor: pointer;
		padding: 14px 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	.chev {
		color: var(--muted);
		transition: transform 0.2s;
	}
	.adv[open] .chev {
		transform: rotate(180deg);
	}
	.grp {
		padding: 8px 0 4px;
		border-top: 1px solid var(--line-soft);
		break-inside: avoid;
	}
	.cols .grp:first-child {
		border-top: none;
		padding-top: 0;
	}
	.grp-title {
		display: block;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		font-weight: 600;
		margin-bottom: 4px;
	}
	/* Desktop: balance the raw groups into two columns. */
	@media (min-width: 880px) {
		.cols {
			column-count: 2;
			column-gap: 32px;
		}
		.cols .grp {
			border-top: none;
		}
		.cols .grp + .grp {
			margin-top: 14px;
		}
	}
</style>
