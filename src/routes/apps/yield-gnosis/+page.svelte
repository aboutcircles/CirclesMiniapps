<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { isMiniappMode, onWalletChange } from '@aboutcircles/miniapp-sdk';
	import { Sdk } from '@aboutcircles/sdk';
	import { fetchAllBalances } from './lib/balances.js';
	import { fetchAaveApys, type PoolData } from './lib/defilama.js';
	import { getATokenAddress, getATokenBalance } from './lib/aave.js';
	import type { AssetInfo } from './lib/types.js';
	import DepositedTable from './components/DepositedTable.svelte';
	import AssetTable from './components/AssetTable.svelte';
	import CirclesProfile from './components/CirclesProfile.svelte';

	let phase   = $state<'idle' | 'loading' | 'table'>('idle');
	let address = $state<`0x${string}` | null>(null);
	let assets  = $state<AssetInfo[]>([]);

	// Circles identity
	let profileName     = $state<string | undefined>(undefined);
	let profileImageUrl = $state<string | undefined>(undefined);
	let trustCount      = $state(0);
	let crcBalance      = $state(0);

	let _sdk: Sdk | null = null;
	function getSdk(): Sdk {
		if (!_sdk) _sdk = new Sdk();
		return _sdk;
	}

	async function loadProfile(addr: `0x${string}`) {
		const sdk = getSdk();
		const [prof, trusted, bal] = await Promise.allSettled([
			sdk.rpc.profile.getProfileByAddress(addr),
			sdk.rpc.trust.getTrustedBy(addr),
			sdk.rpc.balance.getTotalBalance(addr)
		]);
		if (prof.status === 'fulfilled' && prof.value) {
			profileName = prof.value.name ?? undefined;
			const p = prof.value as Record<string, unknown>;
			const raw = (p.picture ?? p.imageUrl ?? null) as string | null;
			profileImageUrl = raw?.startsWith('ipfs://')
				? raw.replace('ipfs://', 'https://ipfs.io/ipfs/')
				: raw ?? undefined;
		}
		if (trusted.status === 'fulfilled') trustCount = trusted.value.length;
		if (bal.status === 'fulfilled')     crcBalance = Number(bal.value) / 1e18;
	}

	let _loadId = 0;

	async function loadData(addr: `0x${string}`) {
		const id = ++_loadId;
		phase = 'loading';

		const [balancesResult, apysResult] = await Promise.allSettled([
			fetchAllBalances(addr),
			fetchAaveApys()
		]);

		if (id !== _loadId) return;

		let list: AssetInfo[] = balancesResult.status === 'fulfilled' ? balancesResult.value : [];
		const apyMap = apysResult.status === 'fulfilled' ? apysResult.value : new Map<string, PoolData>();

		const aTokenResults = await Promise.allSettled(list.map(a => getATokenAddress(a.address)));

		if (id !== _loadId) return;

		list = list.map((a, i) => {
			const poolData = apyMap.get(a.address.toLowerCase());
			return {
				...a,
				apy:           poolData?.apy ?? null,
				tvl:           poolData?.tvl ?? null,
				apyLoading:    false,
				aTokenAddress: aTokenResults[i].status === 'fulfilled'
					? (aTokenResults[i] as PromiseFulfilledResult<`0x${string}`>).value
					: null
			};
		});

		const depositedResults = await Promise.allSettled(
			list.map(a => a.aTokenAddress ? getATokenBalance(addr, a.aTokenAddress) : Promise.resolve(0n))
		);

		if (id !== _loadId) return;

		list = list.map((a, i) => ({
			...a,
			depositedBalance: depositedResults[i].status === 'fulfilled'
				? (depositedResults[i] as PromiseFulfilledResult<bigint>).value
				: 0n
		}));

		assets = list;
		phase  = 'table';
	}

	let unsubscribe: (() => void) | undefined;

	onMount(() => {
		if (isMiniappMode()) {
			unsubscribe = onWalletChange(async (addr) => {
				if (!addr) { phase = 'idle'; address = null; return; }
				address = addr as `0x${string}`;
				loadProfile(address);
				await loadData(address);
			});
		} else {
			address = '0x0000000000000000000000000000000000000001' as `0x${string}`;
			loadProfile(address);
			loadData(address);
		}
	});

	onDestroy(() => unsubscribe?.());
</script>

<svelte:head>
	<title>Yield · Aave v3</title>
</svelte:head>

<div class="app">
	<div class="container">

		<!-- Header -->
		<header class="header">
			<div>
				<h1 class="title">Yield</h1>
				<p class="subtitle">
					Earn on <img src="/apps/yield-gnosis/aave-logo.png" alt="Aave" class="aave-icon" /> Aave v3 · Gnosis Chain
				</p>
			</div>
			{#if address}
				<CirclesProfile
					{address}
					name={profileName}
					imageUrl={profileImageUrl}
					{trustCount}
					{crcBalance}
				/>
			{/if}
		</header>

		<!-- Phases -->
		{#if phase === 'idle' || phase === 'loading'}
			<div class="spinner-wrap">
				<div class="spinner"></div>
				<p class="spinner-label">{phase === 'idle' ? 'Connecting wallet…' : 'Loading balances…'}</p>
			</div>

		{:else if phase === 'table'}
			<DepositedTable
				{assets}
				address={address!}
				onWithdrawDone={() => loadData(address!)}
				onDeposited={() => loadData(address!)}
			/>
			<div class="divider"></div>
			<AssetTable {assets} />
		{/if}

	</div>
</div>

<style>
	:global(:root) {
		--bg:          #0f0f2e;
		--surface:     #1a1a3e;
		--surface-2:   #141430;
		--border:      rgba(255,255,255,0.08);
		--text:        #f0f0ff;
		--text-muted:  rgba(240,240,255,0.55);
		--text-dim:    rgba(240,240,255,0.35);
		--blue:        #3737c8;
		--blue-hover:  #4545d8;
		--blue-light:  rgba(55,55,200,0.08);
		--blue-shadow: rgba(55,55,200,0.35);
		--green:       #16a34a;
		--green-light: rgba(22,163,74,0.08);
		--orange:      #f97316;
	}
	:global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }
	:global(body) { background: var(--bg); color: var(--text); font-family: 'Inter', system-ui, sans-serif; }

	.app       { min-height: 100vh; padding: 24px 16px; background: var(--bg); }
	.container { max-width: 448px; margin: 0 auto; }
	.header    { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; }
	.title     { font-size:20px; font-weight:900; color:var(--text); }
	.subtitle  { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--text-muted); margin-top:2px; }
	.aave-icon { height:12px; width:12px; }
.spinner-wrap  { display:flex; flex-direction:column; align-items:center; gap:16px; padding:96px 0; text-align:center; }
	.spinner       { width:48px; height:48px; border-radius:50%; border:2px solid transparent; border-top-color:var(--blue); border-right-color:var(--blue); animation:spin .8s linear infinite; }
	.spinner-label { font-size:14px; color:var(--text-muted); }
	.divider { margin:16px 0; border-top:1px solid var(--border); }
	@keyframes spin { to { transform:rotate(360deg); } }
</style>
