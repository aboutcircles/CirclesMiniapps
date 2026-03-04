<script lang="ts">
	import { createPublicClient, http, type Address } from 'viem';
	import { gnosis } from 'viem/chains';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';

	// ----- Constants -----
	const ONCHAIN_RPC_URL = 'https://rpc.aboutcircles.com/';
	const CIRCLES_RPC_URL = 'https://rpc.aboutcircles.com/';
	const ERC20_ABI = [
		{
			type: 'function',
			name: 'balanceOf',
			inputs: [{ name: 'account', type: 'address' }],
			outputs: [{ name: '', type: 'uint256' }],
			stateMutability: 'view'
		}
	] as const;
	const REFRESH_INTERVAL_MS = 15_000;

	// ----- Snapshot JSON shape -----
	// balances: ERC20 inflationary group token balance per account at snapshot time (as decimal string)
	interface SnapshotFile {
		block: string;
		timestamp: string;
		group: string;
		wrapperAddr: string;
		accounts: string[];
		balances: Record<string, string>;
	}

	// ----- Runtime types -----
	interface AvatarRow {
		avatar: string;
		name: string | null;
		imageUrl: string | null;
		snapErc20: bigint;
		liveErc20: bigint;
		diff: bigint;
	}

	// ----- State -----
	let snapshot = $state<SnapshotFile | null>(null);
	let snapshotError = $state('');
	let liveMap = $state<Map<string, bigint> | null>(null);
	let rows = $state<AvatarRow[]>([]);
	let liveLoading = $state(false);
	let mountLoading = $state(false);
	let error = $state('');
	let statusMsg = $state('');
	let autoRefreshActive = $state(false);
	let showUnidentified = $state(false);

	const profileCache = new SvelteMap<string, { name: string | null; imageUrl: string | null }>();

	// ----- Derived -----
	const tableReady = $derived(snapshot !== null && liveMap !== null && rows.length > 0);
	const activeRows = $derived(rows.filter(r => r.liveErc20 > 0n));
	const zeroRows = $derived(rows.filter(r => r.liveErc20 === 0n));
	const sortedRows = $derived.by(() => {
		const active = [...activeRows].sort((a, b) => (a.liveErc20 < b.liveErc20 ? 1 : a.liveErc20 > b.liveErc20 ? -1 : 0));
		const zero = [...zeroRows].sort((a, b) => (a.name ?? a.avatar).localeCompare(b.name ?? b.avatar));
		return [...active, ...zero];
	});
	const identifiedRows = $derived(sortedRows.filter(r => r.name || r.imageUrl));
	const unidentifiedRows = $derived(sortedRows.filter(r => !r.name && !r.imageUrl));
	const totalDiff = $derived(activeRows.reduce((s, r) => s + r.diff, 0n));

	// ----- Helpers -----
	function truncate(addr: string): string {
		return addr.length < 12 ? addr : addr.slice(0, 8) + '...' + addr.slice(-6);
	}

	function toCRC(wei: bigint): string {
		if (wei === 0n) return '0';
		const isNeg = wei < 0n;
		const abs = isNeg ? -wei : wei;
		const scale = 1_000_000_000_000_000_000n;
		const whole = (abs + scale / 2n) / scale;
		return `${isNeg ? '-' : ''}${whole}`;
	}

	// ----- Viem client -----
	const client = createPublicClient({ chain: gnosis, transport: http(ONCHAIN_RPC_URL) });

	// ----- JSON-RPC helper (Circles methods) -----
	async function jsonRpc(method: string, params: unknown[]): Promise<unknown> {
		const res = await fetch(CIRCLES_RPC_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
		return data.result;
	}

	// ----- Fetch current group members -----
	async function getCurrentMembers(group: string): Promise<string[]> {
		const result = (await jsonRpc('circles_query', [
			{
				Namespace: 'V_CrcV2',
				Table: 'GroupMemberships',
				Columns: ['member'],
				Filter: [{ Type: 'FilterPredicate', FilterType: 'Equals', Column: 'group', Value: group }],
				Limit: 1000,
				Offset: 0
			}
		])) as { columns: string[]; rows: string[][] };
		return (result?.rows ?? []).map((r) => r[0].toLowerCase());
	}

	// ----- Fetch live ERC20 group token balances for all accounts -----
	async function fetchLiveBalances(snap: SnapshotFile): Promise<{ map: SvelteMap<string, bigint>; allAccounts: string[] }> {
		const currentMembers = await getCurrentMembers(snap.group);
		const accountSet = new SvelteSet([...snap.accounts, ...currentMembers]);
		// exclude the group address itself
		accountSet.delete(snap.group.toLowerCase());
		const accs = Array.from(accountSet);

		const wrapperAddr = snap.wrapperAddr as Address;
		const balances = await Promise.all(
			accs.map((acc) =>
				client.readContract({
					address: wrapperAddr,
					abi: ERC20_ABI,
					functionName: 'balanceOf',
					args: [acc as Address]
				})
			)
		) as bigint[];

		const map = new SvelteMap<string, bigint>();
		for (let i = 0; i < accs.length; i++) {
			map.set(accs[i], balances[i] ?? 0n);
		}
		return { map, allAccounts: accs };
	}

	// ----- Rebuild rows -----
	function rebuildRows(snap: SnapshotFile, live: Map<string, bigint>, allAccounts: string[]) {
		rows = allAccounts.map((acc) => {
			const snapErc20 = BigInt(snap.balances[acc] ?? '0');
			const liveErc20 = live.get(acc) ?? 0n;
			const profile = profileCache.get(acc) ?? { name: null, imageUrl: null };
			return {
				avatar: acc,
				name: profile.name,
				imageUrl: profile.imageUrl,
				snapErc20,
				liveErc20,
				diff: liveErc20 - snapErc20
			};
		});
	}

	// ----- Profile fetching -----
	async function fetchProfiles(addresses: string[]): Promise<void> {
		const missing = addresses.filter((a) => !profileCache.has(a));
		if (!missing.length) return;
		try {
			const result = (await jsonRpc('circles_getProfileByAddressBatch', [missing])) as Array<Record<string, unknown> | null>;
			if (!Array.isArray(result)) return;
			for (let i = 0; i < missing.length; i++) {
				const p = result[i];
				const rawImage = (p?.previewImageUrl ?? p?.imageUrl ?? p?.avatarUrl ?? p?.picture ?? null) as string | null;
				let imageUrl: string | null = null;
				if (rawImage) {
					if (rawImage.startsWith('ipfs://')) imageUrl = `https://ipfs.io/ipfs/${rawImage.slice(7)}`;
					else if (rawImage.startsWith('http')) imageUrl = rawImage;
					else if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}/.test(rawImage) || /^bafy/.test(rawImage)) imageUrl = `https://ipfs.io/ipfs/${rawImage}`;
				}
				profileCache.set(missing[i], { name: (p?.name as string) ?? null, imageUrl });
			}
		} catch { /* profiles optional */ }
	}

	// ----- Refresh live -----
	async function refreshLive() {
		if (!snapshot) return;
		liveLoading = true;
		error = '';
		try {
			const { map, allAccounts } = await fetchLiveBalances(snapshot);
			liveMap = map;
			await fetchProfiles(allAccounts);
			rebuildRows(snapshot, map, allAccounts);
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			liveLoading = false;
		}
	}

	// ----- Auto-refresh -----
	let refreshTimerId: ReturnType<typeof setInterval> | null = null;

	function stopAutoRefresh() {
		if (refreshTimerId !== null) { clearInterval(refreshTimerId); refreshTimerId = null; }
		autoRefreshActive = false;
	}

	function startAutoRefresh() {
		if (refreshTimerId !== null) return;
		autoRefreshActive = true;
		refreshTimerId = setInterval(async () => {
			if (!liveLoading) await refreshLive().catch(() => {});
		}, REFRESH_INTERVAL_MS);
	}

	$effect(() => () => stopAutoRefresh());

	// ----- Mount: load snapshot.json then fetch live -----
	$effect(() => {
		mountLoading = true;
		snapshotError = '';
		error = '';

		(async () => {
			try {
				statusMsg = 'Loading snapshot…';
				const res = await fetch('/snapshot.json');
				if (!res.ok) throw new Error(`snapshot.json not found (HTTP ${res.status})`);
				const snap = (await res.json()) as SnapshotFile;
				snapshot = snap;

				statusMsg = 'Fetching profiles…';
				await fetchProfiles(snap.accounts.filter(a => a.toLowerCase() !== snap.group.toLowerCase()));

				statusMsg = 'Fetching live balances…';
				mountLoading = false;
				await refreshLive();
				startAutoRefresh();
			} catch (e: unknown) {
				const msg = e instanceof Error ? e.message : String(e);
				snapshotError = msg;
				mountLoading = false;
			} finally {
				statusMsg = '';
			}
		})();
	});

</script>

<svelte:head>
	<title>PS Event Leaderboard</title>
</svelte:head>

<div class="page">
	<div class="card">
		<h1 class="leaderboard-title">LEADERBOARD</h1>

		<p class="subtitle">Get more vouches to move up the leaderboard</p>

		{#if mountLoading}
			<div class="loading-state">
				<span class="spinner"></span>
				{statusMsg || 'Loading…'}
			</div>
		{/if}
		{#if snapshotError}
			<div class="error-banner">{snapshotError}</div>
		{/if}
		{#if error}
			<div class="error-banner">{error}</div>
		{/if}

		{#if tableReady}
			<div class="lb-list">
				{#each identifiedRows as row, i (row.avatar)}
					{@const hasBalance = row.liveErc20 > 0n}
					<a class="lb-row {i % 2 === 0 ? 'row-even' : 'row-odd'} {!hasBalance ? 'row-zero' : ''}" href="/ps/{row.avatar}">
						<div class="lb-avatar">
							{#if row.imageUrl}
								<img
									class="avatar-img"
									src={row.imageUrl}
									alt={row.name ?? row.avatar}
									onerror={(e) => {
										const el = e.currentTarget as HTMLElement;
										el.style.display = 'none';
										const next = el.nextElementSibling as HTMLElement | null;
										if (next) next.style.display = 'flex';
									}}
								/>
								<img class="avatar-placeholder" src="/person.svg" alt="avatar" style="display:none" />
							{:else}
								<img class="avatar-placeholder" src="/person.svg" alt="avatar" />
							{/if}
						</div>
						<span class="lb-name" title={row.avatar}>{row.name ?? truncate(row.avatar)}</span>
						<span class="lb-score {!hasBalance ? 'lb-score-zero' : ''}">{toCRC(row.liveErc20)}</span>
					</a>
				{/each}

				{#if unidentifiedRows.length > 0}
					{#if showUnidentified}
						{#each unidentifiedRows as row, i (row.avatar)}
							{@const hasBalance = row.liveErc20 > 0n}
							{@const rowIndex = identifiedRows.length + i}
							<a class="lb-row {rowIndex % 2 === 0 ? 'row-even' : 'row-odd'} row-zero" href="/ps/{row.avatar}">
								<div class="lb-avatar">
									<img class="avatar-placeholder" src="/person.svg" alt="avatar" />
								</div>
								<span class="lb-name lb-name-addr" title={row.avatar}>{truncate(row.avatar)}</span>
								<span class="lb-score {!hasBalance ? 'lb-score-zero' : ''}">{toCRC(row.liveErc20)}</span>
							</a>
						{/each}
					{/if}
					<button class="show-more-btn" onclick={() => (showUnidentified = !showUnidentified)}>
						{showUnidentified ? 'Show less' : `Show ${unidentifiedRows.length} more`}
					</button>
				{/if}
			</div>
		{/if}

		<div class="card-footer">
			{#if autoRefreshActive}
				<span class="auto-label">
					<span class="spinner-sm"></span>
					AUTO-REFRESHING
				</span>
			{:else}
				<span></span>
			{/if}
			<button class="btn-refresh" onclick={refreshLive} disabled={liveLoading || !snapshot}>
				{liveLoading ? '…' : '↻ Refresh'}
			</button>
		</div>
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		background: #f0e8dc;
		color: #060a40;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	.page {
		min-height: 100vh;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 48px 16px 80px;
		box-sizing: border-box;
		background: #f0e8dc;
	}

	.card {
		background: #faf5f1;
		border-radius: 24px;
		box-shadow: 0 8px 40px rgba(6, 10, 64, 0.12);
		max-width: 420px;
		width: 100%;
		padding: 36px 28px 28px;
		box-sizing: border-box;
	}

	.leaderboard-title {
		font-size: 2rem;
		font-weight: 900;
		color: #060a40;
		letter-spacing: 0.12em;
		text-align: center;
		margin: 0 0 20px;
		text-transform: uppercase;
	}

	.subtitle {
		text-align: center;
		font-size: 0.85rem;
		color: #9b9db3;
		margin: 0 0 20px;
		font-style: italic;
	}

	.loading-state {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px 0;
		color: #6a6c8c;
		font-size: 0.9rem;
	}

	.spinner {
		display: inline-block;
		width: 18px;
		height: 18px;
		border: 2.5px solid #ede1d8;
		border-top-color: #060a40;
		border-radius: 50%;
		animation: spin 0.75s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.error-banner {
		padding: 12px 16px;
		background: #fff0f0;
		border: 1.5px solid #fca5a5;
		border-radius: 10px;
		color: #991b1b;
		font-size: 0.88rem;
		margin-bottom: 16px;
	}

	.lb-list {
		border: 1.5px solid #ede1d8;
		border-radius: 14px;
		overflow: hidden;
		margin-bottom: 4px;
	}

	.lb-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border-bottom: 1px solid #ede1d8;
		text-decoration: none;
		cursor: pointer;
		transition: filter 0.12s;
	}

	.lb-row:last-child {
		border-bottom: none;
	}

	.lb-row:hover {
		filter: brightness(0.96);
	}

	.row-even {
		background: #ffffff;
	}

	.row-odd {
		background: #faf5f1;
	}

	.lb-avatar {
		width: 40px;
		height: 40px;
		flex-shrink: 0;
		position: relative;
	}

	.avatar-img {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}

	.avatar-placeholder {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}

	.lb-name {
		flex: 1;
		font-weight: 600;
		color: #060a40;
		font-size: 0.92rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

.lb-score {
		font-size: 1.3rem;
		font-weight: 800;
		color: #15803d;
		min-width: 60px;
		text-align: right;
		flex-shrink: 0;
	}

	.lb-score-zero {
		color: #b0b0c0;
		font-weight: 600;
	}

	.row-zero {
		opacity: 0.55;
	}

	.row-zero .lb-name {
		color: #8a8ca8;
	}

	.lb-name-addr {
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 0.78rem;
		color: #8a8ca8;
	}

	.show-more-btn {
		width: 100%;
		background: none;
		border: none;
		border-top: 1px solid #ede1d8;
		padding: 10px 16px;
		font-size: 0.8rem;
		font-weight: 600;
		color: #8a8ca8;
		cursor: pointer;
		text-align: center;
		letter-spacing: 0.04em;
		transition: color 0.15s, background 0.15s;
	}

	.show-more-btn:hover {
		color: #6a6c8c;
		background: #faf5f1;
	}

	.card-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid #ede1d8;
	}

	.auto-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		font-weight: 700;
		color: #8a8ca8;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.spinner-sm {
		display: inline-block;
		width: 10px;
		height: 10px;
		border: 2px solid #ede1d8;
		border-top-color: #15803d;
		border-radius: 50%;
		animation: spin 0.75s linear infinite;
		flex-shrink: 0;
	}

	.btn-refresh {
		padding: 6px 14px;
		background: #060a40;
		color: #ffffff;
		border: none;
		border-radius: 8px;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn-refresh:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.btn-refresh:not(:disabled):hover {
		opacity: 0.82;
	}
</style>
