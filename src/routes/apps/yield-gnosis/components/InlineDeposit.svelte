<script lang="ts">
	import { formatUnits, parseUnits } from 'viem';
	import { sendTransactions } from '@aboutcircles/miniapp-sdk';
	import { encodeApprove, encodeSupply } from '../lib/aave.js';
	import { AAVE_POOL } from '../lib/chains.js';
	import type { AssetInfo } from '../lib/types.js';

	interface Props {
		asset: AssetInfo;
		address: `0x${string}`;
		onDeposited: () => void;
		onCancel: () => void;
	}

	let { asset, address, onDeposited, onCancel }: Props = $props();

	let input = $state('');
	let status = $state<'idle' | 'sending' | 'error'>('idle');
	let errorMsg = $state('');

	const walletAmt = $derived(parseFloat(formatUnits(asset.balance, asset.decimals)));

	function setMax() {
		const full = formatUnits(asset.balance, asset.decimals);
		const [w, f = ''] = full.split('.');
		input = f ? `${w}.${f.slice(0, 6)}` : w;
	}

	const parsed = $derived.by(() => {
		try {
			const str = input.trim();
			if (!str || parseFloat(str) <= 0) return 0n;
			const [w, f = ''] = str.split('.');
			const safe = f ? `${w}.${f.slice(0, asset.decimals)}` : w;
			return parseUnits(safe, asset.decimals);
		} catch { return 0n; }
	});

	const isValid = $derived(parsed > 0n && parsed <= asset.balance);

	async function deposit() {
		if (!isValid) return;
		status = 'sending';
		errorMsg = '';
		try {
			await sendTransactions([
				{ to: asset.address, data: encodeApprove(AAVE_POOL, parsed) },
				{ to: AAVE_POOL,     data: encodeSupply(asset.address, parsed, address) }
			]);
			onDeposited();
		} catch (e: unknown) {
			errorMsg = e instanceof Error ? e.message : 'Transaction rejected';
			status = 'error';
		}
	}
</script>

<div class="inline-form">
	<button class="bal-btn" onclick={setMax} disabled={asset.balance === 0n || status === 'sending'}>
		Available:
		<span class="bal-val">
			{walletAmt > 0 ? walletAmt.toLocaleString('en', { maximumFractionDigits: 4 }) : '0'} {asset.symbol}
		</span>
	</button>

	<div class="input-row">
		<input type="text" inputmode="decimal" placeholder="0.00"
			bind:value={input} disabled={status === 'sending'} class="amt-input" />
		<button class="max-btn" onclick={setMax}
			disabled={asset.balance === 0n || status === 'sending'}>MAX</button>
	</div>

	<button class="deposit-btn" onclick={deposit} disabled={!isValid || status === 'sending'}>
		{status === 'sending' ? 'Depositing…' : `Deposit ${asset.symbol}`}
	</button>
	<button class="cancel-btn" onclick={onCancel} disabled={status === 'sending'}>Cancel</button>

	{#if status === 'error' && errorMsg}
		<p style="margin-top:8px;font-size:12px;color:#dc2626">{errorMsg}</p>
	{/if}
</div>

<style>
	.inline-form { margin-top:8px; border-radius:12px; padding:12px; background:var(--surface-2); border:1px solid var(--border); }
	.bal-btn { display:block; width:100%; text-align:left; font-size:12px; color:var(--text-dim); background:none; border:none; cursor:pointer; margin-bottom:8px; padding:0; }
	.bal-btn:disabled { cursor:not-allowed; opacity:0.4; }
	.bal-val { font-weight:700; text-decoration:underline; text-decoration-style:dotted; color:var(--text); }
	.input-row { display:flex; align-items:center; border-radius:8px; overflow:hidden; background:var(--surface); border:1px solid var(--border); margin-bottom:10px; }
	.amt-input { flex:1; background:transparent; border:none; outline:none; padding:8px 12px; font-size:14px; font-weight:700; font-variant-numeric:tabular-nums; color:var(--text); }
	.amt-input:disabled { opacity:0.5; }
	.max-btn { margin-right:8px; padding:2px 8px; border-radius:6px; font-size:12px; font-weight:700; background:rgba(55,55,200,0.1); color:var(--blue); border:none; cursor:pointer; }
	.max-btn:disabled { opacity:0.3; }
	.deposit-btn { display:block; width:100%; border-radius:12px; padding:8px; font-size:14px; font-weight:700; background:var(--blue); color:#fff; border:none; cursor:pointer; margin-bottom:6px; }
	.deposit-btn:disabled { cursor:not-allowed; opacity:0.4; }
	.cancel-btn { display:block; width:100%; padding:4px; font-size:12px; color:var(--text-dim); background:none; border:none; cursor:pointer; }
	.cancel-btn:disabled { opacity:0.3; }
</style>
