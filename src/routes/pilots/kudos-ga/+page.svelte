<script lang="ts">
	import { untrack } from 'svelte';
	import { page } from '$app/state';
	import { SvelteMap } from 'svelte/reactivity';
	import QRCode from 'qrcode';

	// ----- Constants -----
	const CIRCLES_RPC_URL = 'https://rpc.aboutcircles.com/';
	const TX_RPC_URL = 'https://staging.circlesubi.network/';
	// ----- Group config dictionary -----
	// Add entries here for each group this page supports.
	// The key is the value of the ?group= URL param.
	// Both groupAddress and orgAddress must be specified together.
	interface GroupConfig {
		groupAddress: string;
		orgAddress: string;
		/** Invitation slug for this group. Falls back to DEFAULT_INVITE_SLUG if omitted. */
		inviteSlug?: string;
	}

	// Fallback invitation slug used when a group has no inviteSlug set.
	const DEFAULT_INVITE_SLUG = '6hIBYDpn';

	const GROUP_CONFIGS: Record<string, GroupConfig> = {
		'parallel-society': {
			groupAddress: '0x6F99506cD91560305bD4859DcDdcb422EAA81F02',
			orgAddress:   '0x62532eeB3779fDA75554e1EeEce552D0a9FF1C56'
		},
		'dandelion': {
		    groupAddress: '0x1d3663CebF6c7f54bE62B210d68eeA0E38838582',
			orgAddress: '0x33aa31e1392FFB37b1b3572A1E2cc0651D0BCb7F'
		},
		'bfn': {
			groupAddress: '0xeb614ef61367687704cd4628a68a02f3b10ce68c',
			orgAddress:   '0xd4591B6F845C0C496D03A4eAb3a8ca4304EFA60D'
			// inviteSlug: 'XXXXXXXX'  ← set a group-specific slug here when available
		}
		// Add more entries like this:
		// myevent: {
		//   groupAddress: '0xAAAA...',
		//   orgAddress:   '0xBBBB...',
		//   inviteSlug:   'YYYYYYYY'
		// }
	};

	// ----- Query params -----
	const recipientAddress = $derived(page.url.searchParams.get('address') ?? null);
	const showTrust = $derived(page.url.searchParams.has('trust'));

	// ----- Dynamic group / org resolution -----
	// ?group=<key> is required. The key must match an entry in GROUP_CONFIGS above.
	const activeConfig = $derived(
		GROUP_CONFIGS[page.url.searchParams.get('group') ?? ''] ?? null
	);
	const GROUP_ADDRESS = $derived(activeConfig?.groupAddress ?? '');
	const ORG_ADDRESS = $derived(activeConfig?.orgAddress ?? '');
	const kudosHref = $derived.by(() => {
		if (!recipientAddress || !ORG_ADDRESS) return '#';
		const transferPath = `/transfer/${ORG_ADDRESS}/crc?data=${encodeKudosData(recipientAddress, kudosMessage)}&amount=1`;
		const slug = activeConfig?.inviteSlug ?? DEFAULT_INVITE_SLUG;
		return `https://circles.gnosis.io/invitation/${slug}?redirect_to=${encodeURIComponent(transferPath)}`;
	});
	const groupParam = $derived(page.url.searchParams.get('group'));
	const configError = $derived(
		!groupParam
			? 'Missing required URL parameter: ?group=<key>'
			: !activeConfig
				? `Unknown group "${groupParam}". Add it to GROUP_CONFIGS in the source.`
				: null
	);

	// circles_getTransferData entry — has sender, recipient encoded in data, and message
	interface TransferEntry {
		blockNumber: number;
		timestamp: number;
		transactionIndex: number;
		logIndex: number;
		transactionHash: string;
		from: string;
		to: string;
		data: string;
	}

	// circles_getTransactionHistory entry — used to look up transfer amounts by tx hash
	interface TxEntry {
		transactionHash: string;
		from: string;
		to: string;
		circles: string;
	}

	interface KudosPair {
		transactionHash: string;
		timestamp: number;
		sender: string;
		recipient: string;
		circles: string;
		message: string;
	}

	// ----- Device detection -----
	const isMobile = typeof window !== 'undefined' && navigator.maxTouchPoints > 0;

	// ----- QR overlay state -----
	let qrDataUrl = $state<string | null>(null);
	let showQr = $state(false);

	async function openKudos(e: MouseEvent) {
		if (isMobile) return; // let the <a> navigate normally on mobile
		e.preventDefault();
		if (kudosHref === '#') return;
		qrDataUrl = await QRCode.toDataURL(kudosHref, { width: 240, margin: 2 });
		showQr = true;
	}

	// ----- Appreciations state -----
	let transferEntries = $state<TransferEntry[]>([]);
	let amountMap = new SvelteMap<string, string>(); // txHash -> circles amount (incoming leg to org)
	let txLoading = $state(false);
	let txManualRefresh = $state(false);
	let txError = $state('');
	let hasMore = $state(false);
	let kudosMessage = $state('');
	let groupImageUrl = $state<string | null>(null);

	// ----- Shared profile cache -----
	const profileCache = new SvelteMap<string, { name: string | null; imageUrl: string | null }>();

	// ----- Appreciations derived -----
	const orgLower = $derived(ORG_ADDRESS.toLowerCase());
	const recipientLower = $derived(recipientAddress?.toLowerCase() ?? null);
	const kudosPairs = $derived.by((): KudosPair[] => {
		const pairs: KudosPair[] = [];
		for (const entry of transferEntries) {
			// entry.from = actual sender, entry.to = org, entry.data = 0x<recipientAddr40><msgHex>
			if (entry.to.toLowerCase() !== orgLower) continue;
			const recipient = decodeRecipient(entry.data);
			if (!recipient) continue;
			// when ?address is set, only show kudos received by that address
			if (recipientLower && recipient.toLowerCase() !== recipientLower) continue;
			pairs.push({
				transactionHash: entry.transactionHash,
				timestamp: entry.timestamp,
				sender: entry.from,
				recipient,
				circles: amountMap.get(entry.transactionHash) ?? '0',
				message: decodeMessage(entry.data)
			});
		}
		pairs.sort((a, b) => b.timestamp - a.timestamp || a.transactionHash.localeCompare(b.transactionHash));
		return pairs;
	});

	// ----- Helpers -----
	function truncate(addr: string): string {
		return addr.length < 12 ? addr : addr.slice(0, 8) + '...' + addr.slice(-6);
	}

	function formatAmount(val: string): string {
		const n = parseFloat(val);
		if (isNaN(n)) return val;
		return n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, '');
	}

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

		function resolveImageUrl(rawImage: string | null): string | null {
			if (!rawImage) return null;
			if (rawImage.startsWith('data:')) return rawImage;
			if (rawImage.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${rawImage.slice(7)}`;
			if (rawImage.startsWith('http')) return rawImage;
			if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}/.test(rawImage) || /^bafy/.test(rawImage)) return `https://ipfs.io/ipfs/${rawImage}`;
			return null;
		}

		async function fetchOne(address: string): Promise<void> {
			try {
				const info = (await jsonRpc(CIRCLES_RPC_URL, 'circles_getAvatarInfo', [address])) as Record<string, unknown> | null;
				const cidV0 = (info?.cidV0 as string | null | undefined) ?? '';
				if (!cidV0) {
					profileCache.set(address.toLowerCase(), { name: null, imageUrl: null });
					return;
				}
				const ipfsRes = await fetch(`https://ipfs.io/ipfs/${cidV0}`);
				if (!ipfsRes.ok) {
					profileCache.set(address.toLowerCase(), { name: null, imageUrl: null });
					return;
				}
				const ipfsData = (await ipfsRes.json()) as Record<string, unknown>;
				const rawImage = (ipfsData?.previewImageUrl ?? ipfsData?.imageUrl ?? null) as string | null;
				profileCache.set(address.toLowerCase(), {
					name: (ipfsData?.name as string) ?? null,
					imageUrl: resolveImageUrl(rawImage)
				});
			} catch { /* profiles optional */ }
		}

		await Promise.allSettled(missing.map(fetchOne));
	}

	function getProfile(addr: string) {
		return profileCache.get(addr.toLowerCase()) ?? { name: null, imageUrl: null };
	}

	function displayName(addr: string): string {
		const p = getProfile(addr);
		return p.name ?? truncate(addr);
	}

	// ----- Data decoding -----
	function decodeRecipient(data: string): string | null {
		const hex = data.startsWith('0x') ? data.slice(2) : data;
		if (hex.length < 40) return null;
		return '0x' + hex.slice(0, 40);
	}

	function decodeMessage(data: string): string {
		const hex = data.startsWith('0x') ? data.slice(2) : data;
		if (hex.length <= 40) return '';
		try {
			const msgHex = hex.slice(40);
			const bytes = new Uint8Array(msgHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
			return new TextDecoder().decode(bytes).trim();
		} catch { return ''; }
	}

	async function loadHistory(orgAddr: string, groupAddr: string, manual = false) {
		txLoading = true;
		txManualRefresh = manual;
		txError = '';
		try {
			// 1. Transfer data — source of truth for sender, recipient (in data), message
			const transferResult = (await jsonRpc(TX_RPC_URL, 'circles_getTransferData', [orgAddr])) as { results: TransferEntry[]; hasMore: boolean };
			transferEntries = transferResult.results ?? [];
			hasMore = transferResult.hasMore ?? false;

			// 2. Transaction history — used only to look up amounts by tx hash (high limit to avoid missing entries)
			const histResult = (await jsonRpc(TX_RPC_URL, 'circles_getTransactionHistory', [orgAddr, 500])) as { results: TxEntry[]; hasMore: boolean };
			amountMap.clear();
			for (const t of (histResult.results ?? [])) {
				// incoming leg to org = the actual kudos amount
				if (t.to?.toLowerCase() === orgAddr.toLowerCase() && !amountMap.has(t.transactionHash)) {
					amountMap.set(t.transactionHash, t.circles);
				}
			}

			// 3. Batch fetch profiles for all participants + group avatar
			const addrs = Array.from(new Set([
				groupAddr.toLowerCase(),
				...transferEntries
					.filter((e) => e.to.toLowerCase() === orgAddr.toLowerCase())
					.flatMap((e) => {
						const r = decodeRecipient(e.data);
						return r ? [e.from.toLowerCase(), r.toLowerCase()] : [e.from.toLowerCase()];
					})
			]));
			await fetchProfiles(addrs);
			groupImageUrl = getProfile(groupAddr).imageUrl;
		} catch (e: unknown) {
			txError = e instanceof Error ? e.message : String(e);
		} finally {
			txLoading = false;
		}
	}

	// ----- Kudos data encoding -----
	function encodeKudosData(address: string, message: string): string {
		// Encode: raw address hex (40 chars) + optional UTF-8 message as hex
		const addrHex = address.replace(/^0x/i, '').toLowerCase();
		if (!message) return '0x' + addrHex;
		const msgBytes = new TextEncoder().encode(message);
		const msgHex = Array.from(msgBytes).map(b => b.toString(16).padStart(2, '0')).join('');
		return '0x' + addrHex + msgHex;
	}

	// Re-run whenever ORG_ADDRESS or GROUP_ADDRESS changes; also poll every 5 s.
	$effect(() => {
		if (!activeConfig) return;
		const orgAddr = ORG_ADDRESS;
		const groupAddr = GROUP_ADDRESS;
		loadHistory(orgAddr, groupAddr);
		const interval = setInterval(() => loadHistory(orgAddr, groupAddr), 5000);
		return () => clearInterval(interval);
	});

	$effect(() => {
		if (recipientAddress) fetchProfiles([recipientAddress]);
	});
</script>

<svelte:head>
	<title>Kudos</title>
</svelte:head>

<div class="page">
	<div class="card">

		<!-- Config error -->
		{#if configError}
			<div class="error-banner">{configError}</div>
		{/if}

		<!-- ===== KUDOS ===== -->
			{#if recipientAddress}
				{@const recipientProfile = getProfile(recipientAddress)}
				<a
					class="kudos-btn"
					href={kudosHref}
					target="_blank"
					rel="noopener noreferrer"
				>
					<div class="kudos-top-row" role="button" tabindex="0" onclick={openKudos} onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') openKudos(e as unknown as MouseEvent); }}>
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
					</div>
					<div class="kudos-input-row">
						<input
							class="kudos-msg-input"
							type="text"
							maxlength="120"
							placeholder="Add a message… (optional)"
							bind:value={kudosMessage}
							onclick={(e) => { e.preventDefault(); e.stopPropagation(); }}
						/>
						<div class="kudos-suggestions">
							{#each ['🙏', '🌟', '💪', '❤️'] as emoji}
								<button
									class="kudos-suggestion"
									onclick={(e) => { e.preventDefault(); e.stopPropagation(); kudosMessage = (kudosMessage + emoji).slice(0, 120); }}
								>{emoji}</button>
							{/each}
						</div>
					</div>
				</a>

				{#if showQr && qrDataUrl}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="qr-overlay" onclick={() => { showQr = false; }}>
						<div class="qr-card" onclick={(e) => e.stopPropagation()}>
							<button class="qr-close" onclick={() => { showQr = false; }}>✕</button>
							<div class="qr-header">
								<span class="qr-icon">📱</span>
								<p class="qr-title">Scan to send kudos</p>
								<p class="qr-subtitle">Point your phone camera at the code</p>
							</div>
							<div class="qr-frame">
								<img class="qr-img" src={qrDataUrl} alt="QR code for kudos link" />
							</div>
							<a class="qr-link-btn" href={kudosHref} target="_blank" rel="noopener noreferrer">
								Open on this device instead
							</a>
						</div>
					</div>
				{/if}

				{#if showTrust}
				<a
					class="trust-btn"
					href="https://app.gnosis.io/{recipientAddress}"
					onclick={(e) => { e.preventDefault(); window.top?.open((e.currentTarget as HTMLAnchorElement).href, '_blank'); }}
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
					<strong class="trust-name">{recipientProfile.name ?? recipientAddress.slice(0, 8) + '…' + recipientAddress.slice(-6)}</strong>
					<span class="trust-label"> on Circles</span>
				</a>
				{/if}
			{/if}

			<div class="refresh-bar">
				<div class="loading-state" class:invisible={!txLoading || !txManualRefresh}>
					<span class="spinner"></span>
					Loading…
				</div>
				<button class="btn-refresh" onclick={() => loadHistory(ORG_ADDRESS, GROUP_ADDRESS, true)} disabled={txLoading && txManualRefresh}>
					↻ Refresh
				</button>
			</div>
			{#if txError}
				<div class="error-banner">{txError}</div>
			{/if}
			{#if !txLoading && kudosPairs.length === 0 && !txError}
				<div class="empty">No appreciations found.</div>
			{/if}

			{#if kudosPairs.length > 0}
				<div class="tx-list">
					{#each kudosPairs as tx, i (tx.transactionHash)}
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
									<span class="tx-verb"> sent </span>
									<span class="tx-amount">{formatAmount(tx.circles)}</span>
									{#if groupImageUrl}
										<img class="group-avatar-inline" src={groupImageUrl} alt="CRC" />
									{/if}
									<span class="tx-verb"> CRC to </span>
									<span class="tx-name" title={tx.recipient}>{displayName(tx.recipient)}</span>
								</p>
								{#if tx.message}
									<p class="tx-msg">"{tx.message}"</p>
								{/if}
							</div>
						</div>
					{/each}
				</div>

				{#if hasMore}
					<p class="has-more">More appreciations available — showing most recent batch.</p>
				{/if}
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

	.loading-state {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #6a6c8c;
		font-size: 0.85rem;
		flex: 1;
	}

	.invisible {
		visibility: hidden;
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
		flex-direction: column;
		align-items: stretch;
		gap: 0;
		background: #3a3f7a;
		color: #ffffff;
		border-radius: 16px;
		padding: 0;
		text-decoration: none;
		margin-bottom: 20px;
		transition: opacity 0.15s;
		cursor: pointer;
		overflow: hidden;
	}

	.kudos-btn:hover { opacity: 0.85; }

	.kudos-top-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 14px 18px;
	}

	.kudos-input-row {
		border-top: 1px solid rgba(255, 255, 255, 0.15);
		padding: 10px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.kudos-suggestions {
		display: flex;
		flex-direction: row;
		gap: 6px;
	}

	.kudos-suggestion {
		flex: 1;
		background: rgba(255, 255, 255, 0.12);
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 8px;
		padding: 6px 0;
		font-size: 1.1rem;
		cursor: pointer;
		transition: background 0.12s;
		line-height: 1;
		text-align: center;
	}

	.kudos-suggestion:hover {
		background: rgba(255, 255, 255, 0.22);
	}

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

	/* ----- Kudos message input (inside button) ----- */
	.kudos-msg-input {
		width: 100%;
		box-sizing: border-box;
		padding: 8px 12px;
		border: 1.5px solid rgba(255, 255, 255, 0.2);
		border-radius: 8px;
		font-size: 0.88rem;
		color: #ffffff;
		background: rgba(255, 255, 255, 0.1);
		outline: none;
		transition: border-color 0.15s, background 0.15s;
	}

	.kudos-msg-input:focus {
		border-color: rgba(255, 255, 255, 0.5);
		background: rgba(255, 255, 255, 0.15);
	}

	.kudos-msg-input::placeholder {
		color: rgba(255, 255, 255, 0.45);
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

	.group-avatar-inline {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		object-fit: cover;
		vertical-align: text-bottom;
		display: inline-block;
		margin: 0 1px;
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

	.has-more {
		text-align: center;
		font-size: 0.78rem;
		color: #9b9db3;
		font-style: italic;
		margin: 8px 0 4px;
	}

	/* ----- Refresh bar ----- */
	.refresh-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
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

	/* ----- QR overlay ----- */
	.qr-overlay {
		position: fixed;
		inset: 0;
		background: rgba(6, 10, 64, 0.6);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.qr-card {
		background: #ffffff;
		border-radius: 24px;
		padding: 32px 32px 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
		position: relative;
		box-shadow: 0 24px 64px rgba(6, 10, 64, 0.28);
		width: 320px;
	}

	.qr-close {
		position: absolute;
		top: 14px;
		right: 14px;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f0f0f4;
		border: none;
		border-radius: 50%;
		font-size: 0.75rem;
		color: #6a6c8c;
		cursor: pointer;
		line-height: 1;
		padding: 0;
		transition: background 0.12s, color 0.12s;
	}

	.qr-close:hover {
		background: #e2e2ea;
		color: #060a40;
	}

	.qr-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		margin-bottom: 20px;
		padding-right: 24px;
		padding-left: 24px;
	}

	.qr-icon {
		font-size: 1.6rem;
		line-height: 1;
		margin-bottom: 6px;
	}

	.qr-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: #060a40;
		text-align: center;
	}

	.qr-subtitle {
		margin: 0;
		font-size: 0.8rem;
		color: #9b9db3;
		text-align: center;
	}

	.qr-frame {
		background: #f7f7fa;
		border-radius: 16px;
		padding: 12px;
		margin-bottom: 20px;
	}

	.qr-img {
		width: 220px;
		height: 220px;
		border-radius: 6px;
		display: block;
	}

	.qr-link-btn {
		display: block;
		width: 100%;
		box-sizing: border-box;
		text-align: center;
		padding: 10px 16px;
		background: #f0f0f8;
		border-radius: 10px;
		font-size: 0.82rem;
		font-weight: 600;
		color: #3a3f7a;
		text-decoration: none;
		transition: background 0.12s;
	}

	.qr-link-btn:hover {
		background: #e4e4f4;
	}
</style>
