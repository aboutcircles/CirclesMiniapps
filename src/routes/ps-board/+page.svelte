<script lang="ts">
	import { page } from '$app/state';
	import { createPublicClient, http, type Address } from 'viem';
	import { gnosis } from 'viem/chains';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { CirclesConverter } from '@aboutcircles/sdk-utils/circlesConverter';
	import { ORG_ADDRESS } from '../ps/config';

	// ----- Constants -----
	const ONCHAIN_RPC_URL = 'https://rpc.aboutcircles.com/';
	const CIRCLES_RPC_URL = 'https://staging.circlesubi.network/';
	const TX_RPC_URL = 'https://staging.circlesubi.network/';
	const FILTER_FROM = '0x8586b48d6f773e8536823182a7abfa82d5a51f47';
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

	// ----- View toggle -----
	type View = 'leaderboard' | 'appreciations';
	let activeView = $state<View>('leaderboard');

	// ----- Recipient from query param -----
	const recipientAddress = $derived(page.url.searchParams.get('address') ?? null);
	$effect(() => {
		if (recipientAddress) activeView = 'appreciations';
	});

	// ----- Snapshot JSON shape -----
	interface SnapshotFile {
		block: string;
		timestamp: string;
		group: string;
		wrapperAddr: string;
		accounts: string[];
		balances: Record<string, string>;
	}

	interface AvatarRow {
		avatar: string;
		name: string | null;
		imageUrl: string | null;
		snapErc20: bigint;
		liveErc20: bigint;
		diff: bigint;
	}

	interface TxEntry {
		blockNumber: number;
		timestamp: number;
		transactionIndex: number;
		logIndex: number;
		transactionHash: string;
		version: number;
		from: string;
		to: string;
		value: string;
		circles: string;
		attoCircles: string;
		crc: string;
		attoCrc: string;
		staticCircles: string;
		staticAttoCircles: string;
	}

	interface TxPair {
		transactionHash: string;
		timestamp: number;
		sender: string;
		recipient: string;
		circles: string;
	}

	// ----- Leaderboard state -----
	let snapshot = $state<SnapshotFile | null>(null);
	let snapshotError = $state('');
	let liveMap = $state<Map<string, bigint> | null>(null);
	let rows = $state<AvatarRow[]>([]);
	let liveLoading = $state(false);
	let mountLoading = $state(false);
	let lbError = $state('');
	let statusMsg = $state('');
	let autoRefreshActive = $state(false);
	let showUnidentified = $state(false);

	// ----- Appreciations state -----
	let txs = $state<TxEntry[]>([]);
	let txLoading = $state(false);
	let txError = $state('');
	let hasMore = $state(false);

	// ----- Shared profile cache -----
	const profileCache = new SvelteMap<string, { name: string | null; imageUrl: string | null }>();

	// ----- Leaderboard derived -----
	const orgLower = ORG_ADDRESS.toLowerCase();
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

	// ----- Appreciations derived -----
	const pairedTxs = $derived.by((): TxPair[] => {
		const relevant = txs.filter((t) => t.from.toLowerCase() !== FILTER_FROM);
		const byHash = new Map<string, TxEntry[]>();
		for (const t of relevant) {
			const bucket = byHash.get(t.transactionHash) ?? [];
			bucket.push(t);
			byHash.set(t.transactionHash, bucket);
		}
		const pairs: TxPair[] = [];
		for (const [hash, legs] of byHash) {
			const incoming = legs.find((l) => l.to.toLowerCase() === orgLower);
			const outgoing = legs.find((l) => l.from.toLowerCase() === orgLower);
			if (!incoming || !outgoing) continue;
			pairs.push({
				transactionHash: hash,
				timestamp: incoming.timestamp,
				sender: incoming.from,
				recipient: outgoing.to,
				circles: incoming.circles
			});
		}
		pairs.sort((a, b) => b.timestamp - a.timestamp || a.transactionHash.localeCompare(b.transactionHash));
		return pairs;
	});

	// ----- Helpers -----
	function truncate(addr: string): string {
		return addr.length < 12 ? addr : addr.slice(0, 8) + '...' + addr.slice(-6);
	}

	function toCircles(inflationaryAtto: bigint): string {
		if (inflationaryAtto === 0n) return '0';
		const isNeg = inflationaryAtto < 0n;
		const abs = isNeg ? -inflationaryAtto : inflationaryAtto;
		const day = CirclesConverter.dayFromTimestamp(BigInt(Math.floor(Date.now() / 1000)));
		const demurraged = CirclesConverter.inflationaryToDemurrage(abs, day);
		const circles = CirclesConverter.attoCirclesToCircles(demurraged);
		return `${isNeg ? '-' : ''}${Math.round(circles)}`;
	}

	function formatAmount(val: string): string {
		const n = parseFloat(val);
		if (isNaN(n)) return val;
		return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, '');
	}

	// ----- Viem client -----
	const client = createPublicClient({ chain: gnosis, transport: http(ONCHAIN_RPC_URL) });

	// ----- JSON-RPC helpers -----
	async function jsonRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const data = await res.json();
		if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
		return data.result;
	}

	// ----- Profile fetching -----
	async function fetchProfiles(addresses: string[]): Promise<void> {
		const missing = addresses.filter((a) => !profileCache.has(a));
		if (!missing.length) return;
		try {
			const result = (await jsonRpc(CIRCLES_RPC_URL, 'circles_getProfileByAddressBatch', [missing])) as Array<Record<string, unknown> | null>;
			if (!Array.isArray(result)) return;
			for (let i = 0; i < missing.length; i++) {
				const p = result[i];
				const rawImage = (p?.previewImageUrl ?? p?.imageUrl ?? p?.avatarUrl ?? p?.picture ?? null) as string | null;
				let imageUrl: string | null = null;
				if (rawImage) {
					if (rawImage.startsWith('data:')) imageUrl = rawImage;
					else if (rawImage.startsWith('ipfs://')) imageUrl = `https://ipfs.io/ipfs/${rawImage.slice(7)}`;
					else if (rawImage.startsWith('http')) imageUrl = rawImage;
					else if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}/.test(rawImage) || /^bafy/.test(rawImage)) imageUrl = `https://ipfs.io/ipfs/${rawImage}`;
				}
				profileCache.set(missing[i].toLowerCase(), { name: (p?.name as string) ?? null, imageUrl });
			}
		} catch { /* profiles optional */ }
	}

	function getProfile(addr: string) {
		return profileCache.get(addr.toLowerCase()) ?? { name: null, imageUrl: null };
	}

	function displayName(addr: string): string {
		const p = getProfile(addr);
		return p.name ?? truncate(addr);
	}

	// ----- Leaderboard logic -----
	async function getCurrentMembers(group: string): Promise<string[]> {
		const result = (await jsonRpc(CIRCLES_RPC_URL, 'circles_query', [
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

	async function fetchLiveBalances(snap: SnapshotFile): Promise<{ map: SvelteMap<string, bigint>; allAccounts: string[] }> {
		const currentMembers = await getCurrentMembers(snap.group);
		const accountSet = new SvelteSet([...snap.accounts, ...currentMembers]);
		accountSet.delete(snap.group.toLowerCase());
		const accs = Array.from(accountSet);
		const wrapperAddr = snap.wrapperAddr as Address;
		const balances = await Promise.all(
			accs.map((acc) => client.readContract({ address: wrapperAddr, abi: ERC20_ABI, functionName: 'balanceOf', args: [acc as Address] }))
		) as bigint[];
		const map = new SvelteMap<string, bigint>();
		for (let i = 0; i < accs.length; i++) map.set(accs[i], balances[i] ?? 0n);
		return { map, allAccounts: accs };
	}

	function rebuildRows(snap: SnapshotFile, live: Map<string, bigint>, allAccounts: string[]) {
		rows = allAccounts.map((acc) => {
			const snapErc20 = BigInt(snap.balances[acc] ?? '0');
			const liveErc20 = live.get(acc) ?? 0n;
			const profile = profileCache.get(acc) ?? { name: null, imageUrl: null };
			return { avatar: acc, name: profile.name, imageUrl: profile.imageUrl, snapErc20, liveErc20, diff: liveErc20 - snapErc20 };
		});
	}

	async function refreshLive() {
		if (!snapshot) return;
		liveLoading = true;
		lbError = '';
		try {
			const { map, allAccounts } = await fetchLiveBalances(snapshot);
			liveMap = map;
			await fetchProfiles(allAccounts);
			rebuildRows(snapshot, map, allAccounts);
		} catch (e: unknown) {
			lbError = e instanceof Error ? e.message : String(e);
		} finally {
			liveLoading = false;
		}
	}

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

	$effect(() => {
		mountLoading = true;
		snapshotError = '';
		lbError = '';
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
				snapshotError = e instanceof Error ? e.message : String(e);
				mountLoading = false;
			} finally {
				statusMsg = '';
			}
		})();
	});

	// ----- Appreciations logic -----
	async function loadHistory() {
		txLoading = true;
		txError = '';
		try {
			const result = (await jsonRpc(TX_RPC_URL, 'circles_getTransactionHistory', [ORG_ADDRESS, 150])) as {
				results: TxEntry[];
				hasMore: boolean;
			};
			txs = result.results ?? [];
			hasMore = result.hasMore ?? false;
			const relevant = txs.filter((t) => t.from.toLowerCase() !== FILTER_FROM);
			const addrs = Array.from(new Set(relevant.flatMap((t) => [t.from.toLowerCase(), t.to.toLowerCase()])));
			await fetchProfiles(addrs);
		} catch (e: unknown) {
			txError = e instanceof Error ? e.message : String(e);
		} finally {
			txLoading = false;
		}
	}

	$effect(() => {
		loadHistory();
	});

	$effect(() => {
		if (recipientAddress) fetchProfiles([recipientAddress]);
	});
</script>

<svelte:head>
	<title>PS Board</title>
</svelte:head>

<div class="page">
	<div class="card">

		<!-- Toggle -->
		<div class="toggle-bar">
			<button
				class="toggle-btn {activeView === 'leaderboard' ? 'active' : ''}"
				onclick={() => (activeView = 'leaderboard')}
			>
				LEADERBOARD
			</button>
			<button
				class="toggle-btn {activeView === 'appreciations' ? 'active' : ''}"
				onclick={() => (activeView = 'appreciations')}
			>
				KUDOS
			</button>
		</div>

		<!-- ===== LEADERBOARD ===== -->
		{#if activeView === 'leaderboard'}
			<p class="subtitle">Get more thanks to move up the leaderboard</p>

			{#if mountLoading}
				<div class="loading-state">
					<span class="spinner"></span>
					{statusMsg || 'Loading…'}
				</div>
			{/if}
			{#if snapshotError}
				<div class="error-banner">{snapshotError}</div>
			{/if}
			{#if lbError}
				<div class="error-banner">{lbError}</div>
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
							<span class="lb-score {!hasBalance ? 'lb-score-zero' : ''}">{toCircles(row.liveErc20)}</span>
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
									<span class="lb-score {!hasBalance ? 'lb-score-zero' : ''}">{toCircles(row.liveErc20)}</span>
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
		{/if}

		<!-- ===== KUDOS ===== -->
		{#if activeView === 'appreciations'}
			{#if recipientAddress}
				{@const recipientProfile = getProfile(recipientAddress)}
				<a
					class="kudos-btn"
					href="https://app.gnosis.io/transfer/{ORG_ADDRESS}/crc/1?data={recipientAddress}"
					target="_blank"
					rel="noopener noreferrer"
				>
					<span class="kudos-arrow">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
							<path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
						</svg>
					</span>
					<span class="kudos-label">Send kudos to</span>
					<div class="kudos-avatar">
						{#if recipientProfile.imageUrl}
							<img
								src={recipientProfile.imageUrl}
								alt={recipientProfile.name ?? recipientAddress}
								onerror={(e) => {
									const el = e.currentTarget as HTMLElement;
									el.style.display = 'none';
									const next = el.nextElementSibling as HTMLElement | null;
									if (next) next.style.display = 'block';
								}}
							/>
							<img src="/person.svg" alt="avatar" style="display:none" />
						{:else}
							<img src="/person.svg" alt="avatar" />
						{/if}
					</div>
					<strong class="kudos-name">{recipientProfile.name ?? recipientAddress.slice(0, 8) + '…' + recipientAddress.slice(-6)}</strong>
				</a>
			{/if}
			<p class="subtitle">Who shared kudos with whom</p>

			{#if txLoading}
				<div class="loading-state">
					<span class="spinner"></span>
					Loading appreciations…
				</div>
			{/if}
			{#if txError}
				<div class="error-banner">{txError}</div>
			{/if}
			{#if !txLoading && pairedTxs.length === 0 && !txError}
				<div class="empty">No appreciations found.</div>
			{/if}

			{#if pairedTxs.length > 0}
				<div class="tx-list">
					{#each pairedTxs as tx, i (tx.transactionHash)}
						{@const senderProfile = getProfile(tx.sender)}
						{@const recipientProfile = getProfile(tx.recipient)}
						<div class="tx-row {i % 2 === 0 ? 'row-even' : 'row-odd'}">
							<div class="tx-avatars">
								<div class="avatar-wrap">
									{#if senderProfile.imageUrl}
										<img
											class="avatar-img-sm"
											src={senderProfile.imageUrl}
											alt={senderProfile.name ?? tx.sender}
											onerror={(e) => {
												const el = e.currentTarget as HTMLElement;
												el.style.display = 'none';
												const next = el.nextElementSibling as HTMLElement | null;
												if (next) next.style.display = 'block';
											}}
										/>
										<img class="avatar-placeholder-sm" src="/person.svg" alt="avatar" style="display:none" />
									{:else}
										<img class="avatar-placeholder-sm" src="/person.svg" alt="avatar" />
									{/if}
								</div>
								<span class="arrow">→</span>
								<div class="avatar-wrap">
									{#if recipientProfile.imageUrl}
										<img
											class="avatar-img-sm"
											src={recipientProfile.imageUrl}
											alt={recipientProfile.name ?? tx.recipient}
											onerror={(e) => {
												const el = e.currentTarget as HTMLElement;
												el.style.display = 'none';
												const next = el.nextElementSibling as HTMLElement | null;
												if (next) next.style.display = 'block';
											}}
										/>
										<img class="avatar-placeholder-sm" src="/person.svg" alt="avatar" style="display:none" />
									{:else}
										<img class="avatar-placeholder-sm" src="/person.svg" alt="avatar" />
									{/if}
								</div>
							</div>
							<div class="tx-body">
								<p class="tx-sentence">
									<span class="tx-name" title={tx.sender}>{displayName(tx.sender)}</span>
									<span class="tx-verb"> shares </span>
									<span class="tx-amount">{formatAmount(tx.circles)} ❤️</span>
									<span class="tx-verb"> with </span>
									<span class="tx-name" title={tx.recipient}>{displayName(tx.recipient)}</span>
								</p>
							</div>
						</div>
					{/each}
				</div>

				{#if hasMore}
					<p class="has-more">More appreciations available — showing most recent batch.</p>
				{/if}
			{/if}

			<div class="card-footer">
				<span></span>
				<button class="btn-refresh" onclick={loadHistory} disabled={txLoading}>
					{txLoading ? '…' : '↻ Refresh'}
				</button>
			</div>
		{/if}

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
		max-width: 480px;
		width: 100%;
		padding: 28px 28px 28px;
		box-sizing: border-box;
	}

	/* ----- Toggle ----- */
	.toggle-bar {
		display: flex;
		background: #ede1d8;
		border-radius: 12px;
		padding: 4px;
		gap: 4px;
		margin-bottom: 20px;
	}

	.toggle-btn {
		flex: 1;
		padding: 8px 0;
		border: none;
		border-radius: 9px;
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		cursor: pointer;
		transition: background 0.15s, color 0.15s, box-shadow 0.15s;
		background: transparent;
		color: #9b9db3;
	}

	.toggle-btn.active {
		background: #faf5f1;
		color: #060a40;
		box-shadow: 0 1px 4px rgba(6, 10, 64, 0.10);
	}

	/* ----- Shared ----- */
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

	.empty {
		text-align: center;
		color: #9b9db3;
		font-size: 0.9rem;
		padding: 24px 0;
	}

	.row-even { background: #ffffff; }
	.row-odd  { background: #faf5f1; }

	/* ----- Leaderboard ----- */
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

	.lb-row:last-child { border-bottom: none; }
	.lb-row:hover { filter: brightness(0.96); }

	.row-zero { opacity: 0.55; }
	.row-zero .lb-name { color: #8a8ca8; }

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

	.lb-name-addr {
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 0.78rem;
		color: #8a8ca8;
	}

	.lb-score {
		font-size: 1.3rem;
		font-weight: 800;
		color: #060a40;
		min-width: 60px;
		text-align: right;
		flex-shrink: 0;
	}

	.lb-score-zero {
		color: #b0b0c0;
		font-weight: 600;
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

	/* ----- Kudos button ----- */
	.kudos-btn {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		gap: 10px;
		background: #3a3f7a;
		color: #ffffff;
		border-radius: 16px;
		padding: 14px 18px;
		text-decoration: none;
		margin-bottom: 20px;
		transition: opacity 0.15s;
		cursor: pointer;
	}

	.kudos-btn:hover { opacity: 0.85; }

	.kudos-arrow {
		color: #c0c4f0;
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.kudos-label {
		font-size: 1rem;
		color: #d8daff;
		flex-shrink: 0;
	}

	.kudos-avatar {
		width: 34px;
		height: 34px;
		flex-shrink: 0;
	}

	.kudos-avatar img {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}

	.kudos-name {
		font-size: 1rem;
		font-weight: 700;
		color: #ffffff;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ----- Appreciations ----- */
	.tx-list {
		border: 1.5px solid #ede1d8;
		border-radius: 14px;
		overflow: hidden;
		margin-bottom: 4px;
	}

	.tx-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		border-bottom: 1px solid #ede1d8;
	}

	.tx-row:last-child { border-bottom: none; }

	.tx-avatars {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}

	.avatar-wrap {
		width: 34px;
		height: 34px;
		flex-shrink: 0;
	}

	.avatar-img-sm,
	.avatar-placeholder-sm {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
	}

	.arrow {
		font-size: 0.85rem;
		color: #9b9db3;
		font-weight: 700;
		padding: 0 2px;
	}

	.tx-body { flex: 1; min-width: 0; }

	.tx-sentence {
		margin: 0;
		font-size: 0.88rem;
		color: #060a40;
		line-height: 1.4;
	}

	.tx-name {
		font-weight: 700;
		color: #060a40;
	}

	.tx-verb {
		color: #6a6c8c;
		font-weight: 400;
	}

	.tx-amount {
		font-weight: 400;
		color: #6a6c8c;
	}

	.has-more {
		text-align: center;
		font-size: 0.78rem;
		color: #9b9db3;
		font-style: italic;
		margin: 8px 0 4px;
	}

	/* ----- Footer ----- */
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
