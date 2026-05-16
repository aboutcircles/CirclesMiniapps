<script lang="ts">
	import { slide } from 'svelte/transition';
	import { onDestroy, onMount } from 'svelte';
	import { formatUnits } from 'viem';
	import type { AssetInfo } from '../lib/types.js';
	import TokenLogo from './TokenLogo.svelte';
	import GrowthLine from './GrowthLine.svelte';
	import InlineDeposit from './InlineDeposit.svelte';
	import InlineWithdraw from './InlineWithdraw.svelte';

	interface Props {
		assets: AssetInfo[];
		address: `0x${string}`;
		onWithdrawDone: () => void;
		onDeposited: () => void;
	}

	let { assets, address, onWithdrawDone, onDeposited }: Props = $props();

	let expandedCardId     = $state<string | null>(null);
	let expandedWithdrawId = $state<string | null>(null);

	const deposited = $derived(assets.filter(a => a.depositedBalance > 0n));

	type Anchor = { base: number; time: number };
	const _anchors = new Map<string, Anchor>();
	let displayNums = $state(new Map<string, number>());
	const SEC_PER_YEAR = 31_536_000;
	let interval: ReturnType<typeof setInterval>;

	onMount(() => {
		interval = setInterval(() => {
			const now  = Date.now();
			const next = new Map<string, number>();
			for (const a of assets) {
				if (a.depositedBalance === 0n) continue;
				const base = parseFloat(formatUnits(a.depositedBalance, a.decimals));
				let anchor = _anchors.get(a.id);
				if (!anchor || Math.abs(anchor.base - base) > 1e-10) {
					anchor = { base, time: now };
					_anchors.set(a.id, anchor);
				}
				if (!a.apy) { next.set(a.id, base); continue; }
				const dt = (now - anchor.time) / 1000;
				next.set(a.id, anchor.base + anchor.base * (a.apy / 100) * dt / SEC_PER_YEAR);
			}
			displayNums = next;
		}, 100);
	});

	onDestroy(() => clearInterval(interval));

	function toEur(asset: AssetInfo, n: number): number {
		if (asset.balance > 0n) {
			const w = parseFloat(formatUnits(asset.balance, asset.decimals));
			return w > 0 ? n * (asset.eurValue / w) : 0;
		}
		if (asset.id === 'eure') return n;
		if (asset.id === 'usdc' || asset.id === 'wxdai') return n * 0.92;
		return n * 2500 * 0.92;
	}

	const totalEur = $derived.by(() => {
		let sum = 0;
		for (const a of deposited) sum += toEur(a, displayNums.get(a.id) ?? 0);
		return sum;
	});

	function fmtBal(n: number): string {
		if (n === 0) return '0';
		if (n < 0.0001) return '<0.0001';
		return n.toLocaleString('en', { maximumFractionDigits: 4 });
	}

	function fmtTotal(n: number): { head: string; tail: string } {
		const s = n.toFixed(10);
		const [w = '0', f = ''] = s.split('.');
		const p = f.padEnd(10, '0');
		return { head: `€${w}.${p.slice(0, 2)}`, tail: p.slice(2) };
	}
</script>

<div style="display:flex;flex-direction:column;gap:4px">

	<!-- Total card -->
	{#if totalEur > 0}
		{@const tot = fmtTotal(totalEur)}
		<div class="total-card total-card--active">
			<div style="margin-bottom:8px;display:flex;align-items:center;gap:8px">
				<span class="glow-ring" style="background:var(--green)"></span>
				<p style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--green);margin:0">Deposited · Earning</p>
			</div>
			<div style="display:flex;align-items:baseline;gap:0">
				<span style="font-size:28px;font-weight:900;font-variant-numeric:tabular-nums;color:var(--text)">{tot.head}</span>
				<span style="font-size:20px;font-weight:900;font-variant-numeric:tabular-nums;color:var(--text-muted)">{tot.tail}</span>
			</div>
		</div>
	{:else}
		<div class="total-card">
			<p style="margin:0 0 8px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-dim)">Your Earnings</p>
			<p style="font-size:28px;font-weight:900;font-variant-numeric:tabular-nums;color:var(--text-dim);margin:0">€0.00</p>
			<p style="margin:4px 0 0;font-size:12px;color:var(--text-dim)">Deposit below to start earning yield on Aave v3</p>
		</div>
	{/if}

	<!-- Asset cards -->
	<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
		{#each assets as asset (asset.id)}
			{@const hasDeposit = asset.depositedBalance > 0n}
			{@const bal = fmtBal(displayNums.get(asset.id) ?? 0)}
			<div class="asset-card" style="border-color:{hasDeposit ? 'rgba(22,163,74,0.2)' : 'var(--border)'}">

				<!-- APY banner -->
				{#if asset.apy !== null}
					<div class="apy-banner" style="background:{hasDeposit ? 'rgba(22,163,74,0.07)' : 'rgba(55,55,200,0.05)'};border-bottom-color:{hasDeposit ? 'rgba(22,163,74,0.12)' : 'rgba(55,55,200,0.1)'}">
						<span style="font-size:11px;font-weight:600;color:var(--text-dim)">APY</span>
						<span style="font-size:15px;font-weight:900;font-variant-numeric:tabular-nums;color:{hasDeposit ? 'var(--green)' : 'var(--blue)'}">{asset.apy.toFixed(2)}%</span>
					</div>
				{:else if asset.apyLoading}
					<div style="padding:8px 12px;border-bottom:1px solid var(--border)">
						<div style="margin-left:auto;height:16px;width:48px;border-radius:4px;background:var(--surface-2);animation:pulse 1.5s ease-in-out infinite"></div>
					</div>
				{/if}

				<!-- Token identity -->
				<div style="display:flex;align-items:center;gap:8px;padding:12px 12px 8px">
					<TokenLogo symbol={asset.symbol} logoUrl={asset.logoUrl} size={26} />
					<div style="min-width:0">
						<p style="margin:0 0 2px;font-size:13px;font-weight:700;line-height:1;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{asset.symbol}</p>
						<span style="display:inline-flex;align-items:center;gap:2px;font-size:11px;font-weight:600;color:#8888a0">
							<img src="/apps/yield-gnosis/aave-logo.png" alt="" style="height:10px;width:10px;margin-right:2px" />Aave v3
						</span>
					</div>
				</div>

				{#if hasDeposit}
					<!-- Live balance -->
					<div style="padding:0 12px 4px">
						<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:var(--text-dim)">Earning</p>
						<p style="margin:0;font-size:19px;font-weight:900;font-variant-numeric:tabular-nums;line-height:1;color:var(--text)">{bal}</p>
					</div>

					<!-- Growth chart -->
					<div style="overflow:hidden;height:30px">
						<GrowthLine id={asset.id} />
					</div>

					<!-- Actions -->
					<div style="display:flex;gap:6px;padding:8px 12px 12px">
						<button class="earn-btn"
							onclick={() => { expandedCardId = expandedCardId === asset.id ? null : asset.id; expandedWithdrawId = null; }}
							disabled={asset.balance === 0n}
							style="background:{expandedCardId === asset.id ? 'var(--surface-2)' : 'var(--blue)'};color:{expandedCardId === asset.id ? 'var(--text-muted)' : '#fff'};border:{expandedCardId === asset.id ? '1.5px solid var(--border)' : 'none'}">
							{expandedCardId === asset.id ? 'Cancel' : '+ Earn'}
						</button>
						<button class="out-btn"
							onclick={() => { expandedWithdrawId = expandedWithdrawId === asset.id ? null : asset.id; expandedCardId = null; }}
							style="border-color:{expandedWithdrawId === asset.id ? 'rgba(220,38,38,0.4)' : 'var(--border)'};color:{expandedWithdrawId === asset.id ? '#dc2626' : 'var(--text-muted)'}">
							Out
						</button>
					</div>
				{:else}
					<!-- Empty state -->
					<div style="padding:4px 12px 12px">
						<p style="margin:0 0 2px;font-size:11px;font-weight:600;color:var(--text-dim)">Not earning yet</p>
						{#if asset.apy !== null}
							<p style="margin:0;font-size:11px;color:var(--text-dim)">Earn {asset.apy.toFixed(2)}% on your {asset.symbol}</p>
						{/if}
					</div>
					<div style="margin-top:auto;padding:0 12px 12px">
						<button class="earn-btn"
							style="width:100%;background:{expandedCardId === asset.id ? 'var(--surface-2)' : 'var(--blue)'};color:{expandedCardId === asset.id ? 'var(--text-muted)' : '#fff'};border:{expandedCardId === asset.id ? '1.5px solid var(--border)' : 'none'}"
							onclick={() => { expandedCardId = expandedCardId === asset.id ? null : asset.id; expandedWithdrawId = null; }}
							disabled={asset.balance === 0n}>
							{expandedCardId === asset.id ? 'Cancel' : '+ Earn'}
						</button>
						{#if asset.balance === 0n}
							<p style="margin:6px 0 0;text-align:center;font-size:11px;color:var(--text-dim)">No {asset.symbol} in wallet</p>
						{/if}
					</div>
				{/if}

				<!-- Inline deposit -->
				{#if expandedCardId === asset.id}
					<div transition:slide={{ duration: 200 }} style="padding:0 12px 12px">
						<InlineDeposit {asset} {address}
							onDeposited={() => { expandedCardId = null; onDeposited(); }}
							onCancel={() => (expandedCardId = null)} />
					</div>
				{/if}

				<!-- Inline withdraw -->
				{#if expandedWithdrawId === asset.id}
					<div transition:slide={{ duration: 200 }} style="padding:0 12px 12px">
						<InlineWithdraw {asset} {address}
							depositedAmt={displayNums.get(asset.id) ?? 0}
							onWithdrawn={() => { expandedWithdrawId = null; onWithdrawDone(); }}
							onCancel={() => (expandedWithdrawId = null)} />
					</div>
				{/if}

			</div>
		{/each}
	</div>

</div>

<style>
	.total-card {
		position:relative;overflow:hidden;border-radius:16px;padding:16px 20px;margin-bottom:8px;
		background:var(--surface);border:1px solid var(--border);
	}
	.total-card--active {
		border-color:rgba(22,163,74,0.25);box-shadow:0 4px 16px rgba(22,163,74,0.08);
	}
	.glow-ring {
		display:inline-block;width:8px;height:8px;border-radius:50%;
		animation:glow-pulse 2s ease-in-out infinite;
	}
	@keyframes glow-pulse {
		0%,100% { box-shadow:0 0 0 0 rgba(22,163,74,0.4); }
		50%      { box-shadow:0 0 0 4px rgba(22,163,74,0); }
	}
	.asset-card {
		display:flex;flex-direction:column;overflow:hidden;border-radius:16px;
		background:var(--surface);border:1px solid var(--border);
	}
	.apy-banner {
		display:flex;align-items:center;justify-content:space-between;
		padding:8px 12px;border-bottom:1px solid;
	}
	.earn-btn {
		flex:1;border-radius:10px;padding:8px;font-size:11px;font-weight:700;cursor:pointer;
		position:relative;overflow:hidden;transition:transform .15s,box-shadow .15s,background .15s;
	}
	.earn-btn:hover:not(:disabled) {
		transform:scale(1.04);
		box-shadow:0 0 16px rgba(55,55,200,.45),0 4px 12px rgba(55,55,200,.3);
	}
	.earn-btn:disabled { cursor:not-allowed;opacity:0.4; }
	.earn-btn::after {
		content:'';position:absolute;inset:0;
		background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.28) 50%,transparent 65%);
		transform:translateX(-120%);
	}
	.earn-btn:hover:not(:disabled)::after { animation:earn-shimmer .45s ease-out forwards; }
	@keyframes earn-shimmer { to { transform:translateX(120%); } }
	.out-btn {
		flex:1;border-radius:10px;padding:8px;font-size:11px;font-weight:700;cursor:pointer;
		background:transparent;border:1.5px solid;transition:border-color .15s,color .15s;
	}
	@keyframes pulse {
		0%,100% { opacity:1; }
		50%      { opacity:.4; }
	}
</style>
