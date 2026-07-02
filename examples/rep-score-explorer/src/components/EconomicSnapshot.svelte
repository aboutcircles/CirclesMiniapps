<script lang="ts">
	import { boRatio, fmtCrcFromFloat, fmtNumber, type EmaPrimitives, type GateLive } from '$lib/repscore';
	import StatRow from './StatRow.svelte';

	let {
		gate,
		ema,
		gateActive = false
	}: { gate: GateLive; ema: EmaPrimitives; gateActive?: boolean } = $props();

	const bo = $derived(boRatio(gate.balance, gate.outstanding));
</script>

<p class="lead">A snapshot of this avatar's economic activity, which feeds the behaviour score.</p>

<StatRow label="Balance held" value={fmtCrcFromFloat(gate.balance)} mono />
<StatRow label="Outstanding (owed)" value={fmtCrcFromFloat(gate.outstanding)} mono />
<StatRow
	label="Balance / outstanding"
	hint="Higher means more held relative to what's owed"
	value={bo === null ? '—' : `${fmtNumber(bo, 1)}×`}
	mono
/>
<StatRow
	label="Qualified inflow"
	hint="Value received from trusted peers (window)"
	value={fmtCrcFromFloat(gate.qualified_inflow_window)}
	mono
/>
<StatRow
	label="Non-qualified outflow"
	hint="Value sent outside trusted peers (window)"
	value={fmtCrcFromFloat(gate.non_qualified_outflow_window)}
	mono
/>
<StatRow label="Minting (avg)" value={fmtCrcFromFloat(ema.mint_bar)} mono />

{#if gateActive}
	<StatRow
		label="Liveness factor"
		hint={gate.gate_triggered ? 'Gate is currently reducing this score' : 'No reduction applied'}
		value={`×${fmtNumber(gate.liveness_factor, 2)}`}
		mono
		tone={gate.gate_triggered ? 'neg' : 'default'}
	/>
{/if}

<style>
	.lead {
		font-size: 12px;
		color: var(--muted);
		margin: 0 0 8px;
		line-height: 1.45;
	}
</style>
