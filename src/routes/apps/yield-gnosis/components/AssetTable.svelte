<script lang="ts">
	import { formatUnits } from 'viem';
	import type { AssetInfo } from '../lib/types.js';
	import TokenLogo from './TokenLogo.svelte';

	interface Props { assets: AssetInfo[]; }
	let { assets }: Props = $props();

	function fmtBalance(asset: AssetInfo): string {
		const n = parseFloat(formatUnits(asset.balance, asset.decimals));
		if (n === 0) return '—';
		if (n < 0.0001) return '<0.0001';
		if (n < 1) return n.toFixed(4);
		return n.toLocaleString('en', { maximumFractionDigits: 4, minimumFractionDigits: 0 });
	}

	function fmtEur(val: number): string {
		if (val < 0.01) return '';
		if (val < 1) return '≈€' + val.toFixed(2);
		return '≈€' + val.toLocaleString('en', { maximumFractionDigits: 0 });
	}

	function hasBalance(asset: AssetInfo): boolean {
		return parseFloat(formatUnits(asset.balance, asset.decimals)) > 0;
	}
</script>

<div style="display:flex;flex-direction:column;gap:4px">
	<div class="hdr">
		<span class="label">Asset</span>
		<span class="label" style="text-align:right">Balance</span>
	</div>
	{#each assets as asset (asset.id)}
		<div class="row-card">
			<div style="display:flex;min-width:0;align-items:center;gap:10px">
				<TokenLogo symbol={asset.symbol} logoUrl={asset.logoUrl} size={36} />
				<div style="min-width:0">
					<p style="margin:0;font-size:13px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{asset.symbol}</p>
					<p style="margin:0;font-size:11px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{asset.name}</p>
				</div>
			</div>
			<div style="text-align:right">
				{#if asset.balanceError}
					<p style="margin:0;font-size:13px;font-weight:700;color:#f97316" title="Failed to load balance">?</p>
				{:else}
					<p style="margin:0;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;color:{hasBalance(asset) ? 'var(--text)' : 'var(--text-dim)'}">{fmtBalance(asset)}</p>
					{#if hasBalance(asset) && asset.eurValue >= 0.01}
						<p style="margin:0;font-size:11px;font-variant-numeric:tabular-nums;color:var(--text-dim)">{fmtEur(asset.eurValue)}</p>
					{/if}
				{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.hdr { display:grid;grid-template-columns:1fr 90px;gap:8px;align-items:center;padding:0 12px 4px; }
	.label { font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim); }
	.row-card { display:grid;grid-template-columns:1fr 90px;gap:8px;align-items:center;padding:12px;border-radius:16px;background:var(--surface); }
</style>
