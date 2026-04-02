<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { createPublicClient, http, type Address, encodeFunctionData } from 'viem';
	import { gnosis } from 'viem/chains';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { CirclesConverter } from '@aboutcircles/sdk-utils/circlesConverter';
	import { circlesConfig } from '@aboutcircles/sdk-utils';
	import { encodeCrcV2TransferData, decodeCrcV2TransferData } from '@aboutcircles/sdk-utils';
	import { TransferBuilder } from '@aboutcircles/sdk-transfers';
	import { wallet } from '$lib/wallet.svelte';


	// ----- Constants -----
	const ONCHAIN_RPC_URL = 'https://rpc.aboutcircles.com/';
	const CIRCLES_RPC_URL = 'https://rpc.aboutcircles.com/';
	const TX_RPC_URL = 'https://staging.circlesubi.network/';
	const PATHFINDER_RPC_URL = 'https://rpc.aboutcircles.com/';
	// ^^ No trailing slash - TransferBuilder uses this as the pathfinder URL
	const HUB_ADDRESS: Address = circlesConfig[100].v2HubAddress as Address;

	const HUB_ABI = [
		{ type: 'function', name: 'toTokenId', inputs: [{ name: 'avatar', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'pure' },
		{ type: 'function', name: 'balanceOfBatch', inputs: [{ name: 'accounts', type: 'address[]' }, { name: 'ids', type: 'uint256[]' }], outputs: [{ name: '', type: 'uint256[]' }], stateMutability: 'view' },
		{ type: 'function', name: 'safeTransferFrom', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'id', type: 'uint256' }, { name: 'value', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [], stateMutability: 'nonpayable' }
	] as const;

	const ERC20_ABI = [
		{ type: 'function', name: 'balanceOf', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view' }
	] as const;

	const BASE_GROUP_ABI = [
		{ type: 'function', name: 'BASE_MINT_HANDLER', inputs: [], outputs: [{ name: '', type: 'address' }], stateMutability: 'view' }
	] as const;

	// ----- Query params -----
	const recipientAddress = $derived(page.url.searchParams.get('recipient') ?? null);
	const blockFromParam = $derived.by(() => {
		const v = page.url.searchParams.get('blockFrom');
		const n = v ? parseInt(v, 10) : NaN;
		return isNaN(n) ? null : n;
	});

	// ----- Group config dictionary -----
	const GROUP_CONFIGS: Record<string, Address> = {
		'parallel-society': '0x6F99506cD91560305bD4859DcDdcb422EAA81F02',
		'dandelion': '0x1d3663CebF6c7f54bE62B210d68eeA0E38838582',
		'gnosis': '0xC19BC204eb1c1D5B3FE500E5E5dfaBaB625F286c'
	};
	const DEFAULT_GROUP: Address = GROUP_CONFIGS['gnosis'];

	// ?group= accepts a named key OR a raw 0x address; falls back to gnosis group
	const groupParam = $derived(page.url.searchParams.get('group'));
	const GROUP_ADDRESS = $derived.by((): Address => {
		if (!groupParam) return DEFAULT_GROUP;
		if (/^0x[0-9a-fA-F]{40}$/.test(groupParam)) return groupParam as Address;
		return GROUP_CONFIGS[groupParam] ?? DEFAULT_GROUP;
	});

	// ----- Wallet auto-connect -----
	$effect(() => {
		wallet.autoConnect();
	});

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

	interface TransferData {
		transactionHash: string;
		blockNumber: number;
		timestamp: number;
		from: string;
		to: string;
		data: string;
	}

	interface TxPair {
		transactionHash: string;
		timestamp: number;
		sender: string;
		recipient: string;
		circles: string;
		message: string | null;
	}

	// ----- Appreciations state -----
	let txs = $state<TxEntry[]>([]);
	let transferDataMap = new SvelteMap<string, string>(); // hash -> data hex
	let txLoading = $state(false);
	let txError = $state('');
	let showDialog = $state(false);
	let kudosMessage = $state('');

	// ----- Send state -----
	let maxFlow = $state<bigint | null>(null);
	let maxFlowLoading = $state(false);
	let maxFlowError = $state('');
	let sendAmount = $state('1');
	let sending = $state(false);
	let sendError = $state('');
	let sendSuccess = $state(false);
	let mintHandler = $state<Address | null>(null);

	// ----- Shared profile cache -----
	const profileCache = new SvelteMap<string, { name: string | null; imageUrl: string | null }>();

	// ----- Appreciations derived -----
	const pairedTxs = $derived.by((): TxPair[] => {
		if (!recipientAddress) return [];
		const recipientLower = recipientAddress.toLowerCase();
		const seen = new SvelteSet<string>();
		const pairs: TxPair[] = [];
		for (const t of txs) {
			if (t.to.toLowerCase() !== recipientLower) continue;
			if (seen.has(t.transactionHash)) continue;
			seen.add(t.transactionHash);
			const rawData = transferDataMap.get(t.transactionHash) ?? '';
			const decoded = decodeTransferData(rawData);
			// Only show kudos-app transfers (type 0x1001 with metadata "kudos-app")
			if (!decoded || decoded.metadata !== 'kudos-app') continue;
			// Drop zero address
			if (/^0x0+$/.test(t.from)) continue;
			// Exclude self-sent kudos (recipient sending to themselves)
			if (t.from.toLowerCase() === recipientLower) continue;
			pairs.push({
				transactionHash: t.transactionHash,
				timestamp: t.timestamp,
				sender: t.from,
				recipient: t.to,
				circles: t.circles,
				message: decoded.message || null
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

	// ----- Appreciations logic -----
	function decodeTransferData(data: string): { message: string; metadata: string } | null {
		if (!data || data.length <= 2) return null;
		try {
			const decoded = decodeCrcV2TransferData(data);
			if (decoded.type === 0x1001) {
				const p = decoded.payload as { message: string; metadata: string };
				return { message: p.message, metadata: p.metadata };
			}
			if (decoded.type === 0x0001) return { message: decoded.payload as string, metadata: '' };
			return null;
		} catch { return null; }
	}

	async function loadHistory(recipientAddr: string, groupAddr: string, blockFrom: number | null = null) {
		if (!recipientAddr) return;
		txLoading = true;
		txError = '';
		try {
			// 1. Transaction history for the recipient
			const histResult = (await jsonRpc(TX_RPC_URL, 'circles_getTransactionHistory', [recipientAddr, 150])) as { results: TxEntry[]; hasMore: boolean };
			txs = histResult.results ?? [];

			// 2. Transfer data for received transfers (optionally filtered from a block)
			const transferResult = (await jsonRpc(TX_RPC_URL, 'circles_getTransferData', [recipientAddr, 'received', null, blockFrom ?? null])) as { results: TransferData[]; hasMore: boolean };
			transferDataMap.clear();
			for (const t of (transferResult.results ?? [])) {
				if (t.data && t.data.length > 2) transferDataMap.set(t.transactionHash, t.data);
			}

			// 3. Batch-fetch profiles for all senders
			const addrs = Array.from(new Set([
				groupAddr.toLowerCase(),
				...txs.map((t) => t.from.toLowerCase())
			]));
			await fetchProfiles(addrs);

		} catch (e: unknown) {
			txError = e instanceof Error ? e.message : String(e);
		} finally {
			txLoading = false;
		}
	}

	function encodeTransferMessage(message: string): Uint8Array {
		const hex = encodeCrcV2TransferData([message, 'kudos-app'], 0x1001);
		return new Uint8Array(hex.slice(2).match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
	}

	// ----- TransferBuilder (handles wrapped tokens, self-approval, flow matrix) -----
	const transferBuilder = new TransferBuilder({
		...circlesConfig[100],
		circlesRpcUrl: PATHFINDER_RPC_URL,
		pathfinderUrl: PATHFINDER_RPC_URL
	});

	// ----- Max flow refresh -----
	async function refreshMaxFlow() {
		const addr = wallet.connected ? wallet.address : null;
		const group = GROUP_ADDRESS;
		if (!addr || !group) return;
		maxFlow = null;
		mintHandler = null;
		maxFlowError = '';
		maxFlowLoading = true;
		try {
			const resolvedMintHandler = await client.readContract({
				address: group as Address,
				abi: BASE_GROUP_ABI,
				functionName: 'BASE_MINT_HANDLER'
			}) as Address;
			mintHandler = resolvedMintHandler;
			const MAX_UINT256 = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
			const attoMax = CirclesConverter.truncateToSixDecimals(MAX_UINT256);
			const rpcResult = await jsonRpc(PATHFINDER_RPC_URL, 'circlesV2_findPath', [{
				source: addr,
				sink: resolvedMintHandler,
				targetFlow: attoMax.toString(),
				withWrap: true,
				quantizedMode: false
			}]) as { maxFlow: string };
			maxFlow = BigInt(rpcResult.maxFlow ?? '0');
		} catch (e: unknown) {
			maxFlowError = e instanceof Error ? e.message : String(e);
		} finally {
			maxFlowLoading = false;
		}
	}

	// ----- Auto-check max flow when wallet connects -----
	$effect(() => {
		const addr = wallet.connected ? wallet.address : null;
		const recipient = recipientAddress;
		const group = GROUP_ADDRESS;
		if (!addr || !recipient || !group) return;
		untrack(() => {
			sendAmount = '1';
			sendError = '';
			sendSuccess = false;
			refreshMaxFlow();
		});
	});

	async function executeSend() {
		if (!recipientAddress || !sendAmount || !wallet.connected) return;
		sending = true;
		sendError = '';
		sendSuccess = false;

		try {
			const amountCrc = parseFloat(sendAmount);
			if (isNaN(amountCrc) || amountCrc <= 0) throw new Error('Invalid amount');
			const targetAtto = CirclesConverter.circlesToAttoCircles(amountCrc);

			// 1. Resolve the mint handler address from the group contract
			const resolvedMintHandler = mintHandler ?? (await client.readContract({
				address: GROUP_ADDRESS as Address,
				abi: BASE_GROUP_ABI,
				functionName: 'BASE_MINT_HANDLER'
			}) as Address);

			// 2. Path through the trust network to the mint handler (mints group tokens to sender)
			const pathTxs = await transferBuilder.constructAdvancedTransfer(
				wallet.address as Address,
				resolvedMintHandler,
				targetAtto,
				{ useWrappedBalances: true }
			);

			// 3. Build safeTransferFrom: sender → recipient, group token, with encoded message
			const groupTokenId = await client.readContract({
				address: HUB_ADDRESS,
				abi: HUB_ABI,
				functionName: 'toTokenId',
				args: [GROUP_ADDRESS as Address]
			}) as bigint;

			const msgBytes = kudosMessage ? encodeTransferMessage(kudosMessage) : new Uint8Array(0);
			const msgHex = `0x${Array.from(msgBytes).map(b => b.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;

			const transferTx = {
				to: HUB_ADDRESS,
				data: encodeFunctionData({
					abi: HUB_ABI,
					functionName: 'safeTransferFrom',
					args: [wallet.address as Address, recipientAddress as Address, groupTokenId, targetAtto, msgHex]
				}),
				value: '0'
			};

			await wallet.sendTransactions([
				...pathTxs.map(tx => ({ to: tx.to, data: tx.data, value: tx.value?.toString() })),
				transferTx
			]);
			sendSuccess = true;
			setTimeout(async () => {
				showDialog = false;
				sendSuccess = false;
				kudosMessage = '';
				sendAmount = '1';
				await Promise.all([
					loadHistory(recipientAddress!, GROUP_ADDRESS, blockFromParam),
					refreshMaxFlow()
				]);
			}, 2500);
		} catch (e: unknown) {
			console.error('Kudos send failed:', e);
			sendError = 'Sorry, kudos might not have been sent. Please try again.';
		} finally {
			sending = false;
		}
	}

	// Re-run whenever ORG_ADDRESS or GROUP_ADDRESS changes (e.g. URL param update).
	$effect(() => {
		const recipAddr = recipientAddress;
		const groupAddr = GROUP_ADDRESS;
		if (!groupAddr) return;
		untrack(() => loadHistory(recipAddr ?? groupAddr, groupAddr, blockFromParam));
	});

	$effect(() => {
		if (recipientAddress) untrack(() => fetchProfiles([recipientAddress]));
	});
</script>

<svelte:head>
	<title>Kudos</title>
</svelte:head>

<div class="page">
	<div class="card">

		<!-- ===== KUDOS ===== -->
			{#if recipientAddress}
				{@const recipientProfile = getProfile(recipientAddress)}
				{#if !wallet.connected}
					<button class="kudos-btn" onclick={() => wallet.connectWithPasskey()}>
						<span class="kudos-label">{wallet.connecting ? 'Connecting…' : 'Connect account to send kudos'}</span>
					</button>
				{:else if maxFlowLoading}
					<button class="kudos-btn" disabled>
						<span class="kudos-label">Checking…</span>
					</button>
				{:else if maxFlow === 0n}
					<p class="no-path-note">You can't send kudos to this person — no transfer path available.</p>
				{:else if maxFlowError}
					<div class="error-banner">{maxFlowError}</div>
				{:else if maxFlow !== null}
					<button class="kudos-btn" onclick={() => { showDialog = true; }}>
						<span class="kudos-arrow">
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
								<path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
							</svg>
						</span>
						<span class="kudos-label">Send kudos to</span>
						<div class="kudos-avatar">
							{#if recipientProfile.imageUrl}
								<img src={recipientProfile.imageUrl} alt={recipientProfile.name ?? recipientAddress} onerror={(e) => { const el = e.currentTarget as HTMLElement; el.style.display = 'none'; const next = el.nextElementSibling as HTMLElement | null; if (next) next.style.display = 'block'; }} />
								<img src="/person.svg" alt="avatar" style="display:none" />
							{:else}
								<img src="/person.svg" alt="avatar" />
							{/if}
						</div>
						<strong class="kudos-name">{recipientProfile.name ?? recipientAddress.slice(0, 8) + '…' + recipientAddress.slice(-6)}</strong>
					</button>
				{/if}

				<!-- Send dialog -->
				{#if showDialog && maxFlow !== null && maxFlow > 0n}
					<div class="dialog-backdrop" role="presentation" onclick={() => { if (!sendSuccess) showDialog = false; }}>
						<div class="dialog-card" role="dialog" aria-modal="true" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => { if (e.key === 'Escape' && !sendSuccess) showDialog = false; }}>
							{#if sendSuccess}
								<button class="dialog-close" onclick={() => { showDialog = false; sendSuccess = false; kudosMessage = ''; sendAmount = '1'; refreshMaxFlow(); }} aria-label="Close">
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
										<path fill-rule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clip-rule="evenodd" />
									</svg>
								</button>
								<div class="dialog-success">
									<span class="dialog-success-icon">✓</span>
									<p class="dialog-success-msg">Kudos sent!</p>
								</div>
							{:else}
								<button class="dialog-close" onclick={() => { showDialog = false; }} aria-label="Close">
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="20" height="20">
										<path fill-rule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clip-rule="evenodd" />
									</svg>
								</button>
								<div class="dialog-amount-wrap">
									<input
										id="kudos-amount"
										class="dialog-amount-input"
										type="number"
										min="1"
										max={toCircles(maxFlow!)}
										placeholder="1"
										size={Math.max(1, String(sendAmount).length)}
										bind:value={sendAmount}
										oninput={(e) => {
											const max = Number(toCircles(maxFlow!));
											const v = Number((e.currentTarget as HTMLInputElement).value);
											if (v > max) sendAmount = String(max);
										}}
									/>
									<span class="dialog-amount-unit">kudos</span>
								</div>
								<input
									id="kudos-msg"
									class="dialog-input"
									type="text"
									maxlength="120"
									placeholder="Add a short message…"
									bind:value={kudosMessage}
								/>
								{#if sendError}
									<div class="error-banner">{sendError}</div>
								{/if}
								<p class="dialog-max-note">Max kudos to send: {toCircles(maxFlow)} CRC</p>
								<button
									class="dialog-send-btn"
									onclick={executeSend}
									disabled={sending || !sendAmount || Number(sendAmount) <= 0}
								>
									{sending ? 'Sending…' : 'Send'}
								</button>
							{/if}
						</div>
					</div>
				{/if}
				<a
					class="trust-btn"
					href="https://app.gnosis.io/{recipientAddress}"
					target="_blank"
					rel="noopener noreferrer"
				>
					<span class="trust-label">Trust</span>
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
					<strong class="trust-name">{recipientProfile.name ?? recipientAddress.slice(0, 8) + '' + recipientAddress.slice(-6)}</strong>
					<span class="trust-label"> on Circles</span>
				</a>
			{/if}

			{#if txLoading}
				<div class="loading-state">
					<span class="spinner"></span>
					Loading appreciations
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
							</div>
							<div class="tx-body">
								<p class="tx-sentence">
									<span class="tx-name" title={tx.sender}>{displayName(tx.sender)}</span>
									<span class="tx-verb"> sent </span>
									<span class="tx-amount">{formatAmount(tx.circles)} kudos</span>
								</p>
								{#if tx.message}
									<p class="tx-msg">"{tx.message}"</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>

			{/if}

			<div class="card-footer">
				<span></span>
				<button class="btn-refresh" onclick={() => loadHistory(recipientAddress ?? GROUP_ADDRESS, GROUP_ADDRESS, blockFromParam)} disabled={txLoading}>
					{txLoading ? '' : '\u21BB Refresh'}
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
		max-width: 480px;
		width: 100%;
		padding: 28px 28px 28px;
		box-sizing: border-box;
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
		border: none;
		width: 100%;
		box-sizing: border-box;
		font-size: 1rem;
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

	.trust-name {
		font-size: 1rem;
		font-weight: 700;
		color: #060a40;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ----- Trust button ----- */
	.trust-btn {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		gap: 6px;
		background: #f0e8dc;
		color: #060a40;
		border: 1.5px solid #c8caeb;
		border-radius: 16px;
		padding: 12px 18px;
		text-decoration: none;
		margin-bottom: 16px;
		transition: opacity 0.15s;
		cursor: pointer;
	}

	.trust-btn:hover { opacity: 0.75; }

	.trust-label {
		font-size: 1rem;
		color: #060a40;
		flex-shrink: 0;
	}

	/* ----- Kudos send dialog ----- */
	.dialog-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(6, 10, 64, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.dialog-card {
		position: relative;
		background: #ffffff;
		border-radius: 20px;
		padding: 32px 24px 20px;
		width: min(400px, 92vw);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		box-shadow: 0 8px 40px rgba(6, 10, 64, 0.18);
	}

	.dialog-close {
		position: absolute;
		top: 14px;
		right: 14px;
		background: none;
		border: none;
		color: #6a6c8c;
		cursor: pointer;
		padding: 4px;
		display: flex;
		align-items: center;
		border-radius: 6px;
	}

	.dialog-close:hover { color: #060a40; background: #f0f0f8; }

	.dialog-amount-wrap {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 10px;
		width: 100%;
	}

	.dialog-amount-input {
		width: auto;
		min-width: 1ch;
		border: none;
		outline: none;
		font-size: 3rem;
		font-weight: 700;
		color: #060a40;
		text-align: right;
		background: transparent;
		padding: 0;
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.dialog-amount-unit {
		font-size: 1.1rem;
		font-weight: 600;
		color: #6a6c8c;
		white-space: nowrap;
	}

	.dialog-amount-input::-webkit-outer-spin-button,
	.dialog-amount-input::-webkit-inner-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }

	.dialog-input {
		width: 100%;
		box-sizing: border-box;
		padding: 10px 14px;
		border: 1.5px solid #c8caeb;
		border-radius: 10px;
		font-size: 0.95rem;
		color: #060a40;
		background: #ffffff;
		outline: none;
		transition: border-color 0.15s;
	}

	.dialog-input:focus { border-color: #3a3f7a; }
	.dialog-input::placeholder { color: #b0b2cc; }

	.dialog-max-note {
		font-size: 0.8rem;
		color: #6a6c8c;
		text-align: center;
		margin: 0;
		width: 100%;
	}

	.dialog-send-btn {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: #5b5ea6;
		color: #ffffff;
		border: none;
		border-radius: 14px;
		font-size: 1.05rem;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.dialog-send-btn:hover:not(:disabled) { opacity: 0.85; }
	.dialog-send-btn:disabled { opacity: 0.45; cursor: not-allowed; }

	.dialog-success {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		padding: 32px 24px;
	}

	.dialog-success-icon {
		font-size: 3rem;
		color: #166534;
		line-height: 1;
	}

	.dialog-success-msg {
		font-size: 1.2rem;
		font-weight: 700;
		color: #060a40;
		margin: 0;
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

.tx-body { flex: 1; min-width: 0; }

	.tx-sentence {
		margin: 0;
		font-size: 0.88rem;
		color: #060a40;
		line-height: 1.4;
	}


	.tx-msg {
		margin: 4px 0 0;
		font-size: 0.82rem;
		color: #6a6c8c;
		font-style: italic;
		line-height: 1.3;
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

	/* ----- Footer ----- */
	.card-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid #ede1d8;
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



	.no-path-note {
		font-size: 0.85rem;
		color: #a0505a;
		text-align: center;
		padding: 10px 0;
		margin: 0;
	}





</style>
