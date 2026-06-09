<script lang="ts">
	import { page } from '$app/state';
	import { SvelteMap } from 'svelte/reactivity';
	import QRCode from 'qrcode';

	// ----- Constants -----
	const CIRCLES_RPC_URL = 'https://rpc.aboutcircles.com/';
	// Test/demo transactions to hide from the feed. Keyed by lower-cased tx hash.
	const HIDDEN_TX_HASHES = new Set<string>([
		'0x8feed3dfa747cd230ffef84d6d3eb3a34cf8273136782792d498a11086307501'
	]);
	// ----- Group config dictionary -----
	// Add entries here for each group this page supports.
	// The key is the value of the ?group= URL param.
	// Both groupAddress and orgAddress must be specified together.
	interface GroupConfig {
		groupAddress: string;
		orgAddress: string;
		/** Human-readable name shown in the intro text (e.g. "Dandelion"). */
		displayName: string;
		/** Invitation slug for this group. Falls back to DEFAULT_INVITE_SLUG if omitted. */
		inviteSlug?: string;
	}

	// Fallback invitation slug used when a group has no inviteSlug set.
	const DEFAULT_INVITE_SLUG = '6hIBYDpn';

	const GROUP_CONFIGS: Record<string, GroupConfig> = {
		'parallel-society': {
			groupAddress: '0x6F99506cD91560305bD4859DcDdcb422EAA81F02',
			orgAddress:   '0x62532eeB3779fDA75554e1EeEce552D0a9FF1C56',
			displayName:  'Parallel Society'
		},
		'dandelion': {
		    groupAddress: '0x1d3663CebF6c7f54bE62B210d68eeA0E38838582',
			orgAddress: '0x33aa31e1392FFB37b1b3572A1E2cc0651D0BCb7F',
			displayName: 'Dandelion',
			inviteSlug: '0Gsv1Xjl'
		},
		'bfn': {
			groupAddress: '0xeb614ef61367687704cd4628a68a02f3b10ce68c',
			orgAddress:   '0xd4591B6F845C0C496D03A4eAb3a8ca4304EFA60D',
			displayName:  'BFN'
			// inviteSlug: 'XXXXXXXX'  ← set a group-specific slug here when available
		}
		// Add more entries like this:
		// myevent: {
		//   groupAddress: '0xAAAA...',
		//   orgAddress:   '0xBBBB...',
		//   displayName:  'My Event',
		//   inviteSlug:   'YYYYYYYY'
		// }
	};

	// ----- Intro texts -----
	// Keyed by the ?text= URL param. `{group}` is replaced with the active group's displayName.
	// `text` is rendered as HTML so you can use <strong>, <em>, etc. for emphasis.
	// `utmContent` (optional) overrides the default `kudos-intro-<key>` analytics tag —
	// use this to bump the analytics bucket when you rewrite copy *in place* without
	// changing the URL key (e.g. so embedders don't have to update their iframe src).
	// If ?text= is missing or unknown, no intro is shown.
	interface IntroText {
		text: string;
		utmContent?: string;
	}
	const INTRO_TEXTS: Record<string, IntroText> = {
		v2: {
			// Copy rewritten 2026-05 — URL key stays `v2` for partner-link stability,
			// but UTM bumped to v3 so analytics can separate old- vs new-copy traffic.
			text:
				'Circles gives every member €100/year in community currency. Automatically, ' +
				'no banks, no middlemen. {group} accepts it as a real donation. Sign up in ' +
				'two minutes, free forever.',
			utmContent: 'kudos-intro-v3'
		},
		test: {
			text:
				'TEST TEXT — if you see this, the ?text= URL param is working. The active ' +
				'group is {group}. Swap to ?text=v2 to see the production intro.'
		}
	};

	// ----- Query params -----
	const recipientAddress = $derived(page.url.searchParams.get('address') ?? null);
	const showTrust = $derived(page.url.searchParams.has('trust'));
	const themeColor = $derived(parseThemeColor(page.url.searchParams.get('theme_color')));

	function parseThemeColor(input: string | null): string | null {
		if (!input) return null;
		let s = input.trim();
		if (s.startsWith('#')) s = s.slice(1);
		else if (s.startsWith('%23')) s = s.slice(3);
		if (s.length === 3) s = s.split('').map((c) => c + c).join('');
		if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
		return `#${s.toLowerCase()}`;
	}

	// ----- Theme override -----
	// ?theme_color=<hex> (with or without #, 3 or 6 digits) overrides the
	// primary accent. Border / hover / 3D shadow shades are derived from it.
	function parseHex(input: string | null): { r: number; g: number; b: number } | null {
		if (!input) return null;
		let h = input.trim().replace(/^#/, '');
		if (h.length === 3) h = h.split('').map((c) => c + c).join('');
		if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
		return {
			r: parseInt(h.slice(0, 2), 16),
			g: parseInt(h.slice(2, 4), 16),
			b: parseInt(h.slice(4, 6), 16)
		};
	}
	function shade({ r, g, b }: { r: number; g: number; b: number }, factor: number): string {
		const adj = (c: number) => Math.max(0, Math.min(255, Math.round(c * factor)));
		const toHex = (c: number) => c.toString(16).padStart(2, '0');
		return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
	}
	const themeRgb = $derived(parseHex(page.url.searchParams.get('theme_color')));
	const themeVars = $derived.by(() => {
		if (!themeRgb) return '';
		const primary = shade(themeRgb, 1);
		const hover = shade(themeRgb, 1.08);
		const border = shade(themeRgb, 0.88);
		const shadow = shade(themeRgb, 0.7);
		return [
			`--theme-primary:${primary}`,
			`--theme-primary-hover:${hover}`,
			`--theme-border:${border}`,
			`--theme-shadow:${shadow}`,
			`--theme-shadow-rgba:${themeRgb.r},${themeRgb.g},${themeRgb.b}`
		].join(';');
	});

	// ----- Dynamic group / org resolution -----
	// ?group=<key> is required. The key must match an entry in GROUP_CONFIGS above.
	const activeConfig = $derived(
		GROUP_CONFIGS[page.url.searchParams.get('group') ?? ''] ?? null
	);
	const GROUP_ADDRESS = $derived(activeConfig?.groupAddress ?? '');
	const ORG_ADDRESS = $derived(activeConfig?.orgAddress ?? '');
	const groupDisplayName = $derived(activeConfig?.displayName ?? '');

	// ?text=<key> selects an entry from INTRO_TEXTS. Missing or unknown → no intro.
	const introTextKey = $derived(page.url.searchParams.get('text'));
	const activeIntro = $derived(
		introTextKey && INTRO_TEXTS[introTextKey] ? INTRO_TEXTS[introTextKey] : null
	);
	const introText = $derived(
		activeIntro ? activeIntro.text.replaceAll('{group}', groupDisplayName) : ''
	);

	const kudosHref = $derived.by(() => {
		if (!recipientAddress || !ORG_ADDRESS) return '#';
		const transferPath = `/transfer/${ORG_ADDRESS}/crc?data=${encodeKudosData(recipientAddress, kudosMessage)}&amount=1`;
		const slug = activeConfig?.inviteSlug ?? DEFAULT_INVITE_SLUG;
		// UTM tags on the outbound invitation URL. Hardcoded for the dandelion pilot for
		// now — revisit (e.g. derive utm_source from the group key) once other groups go live.
		const utmParts = [
			'utm_source=dandelion',
			'utm_medium=kudos-miniapp',
			'utm_campaign=kudos-ga'
		];
		if (activeIntro && introTextKey) {
			const value = activeIntro.utmContent ?? `kudos-intro-${introTextKey}`;
			utmParts.push(`utm_content=${encodeURIComponent(value)}`);
		}
		const utm = '&' + utmParts.join('&');
		return `https://circles.gnosis.io/invitation/${slug}?redirect_to=${encodeURIComponent(transferPath)}${utm}`;
	});


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
	let qrHref = $state<string>('#');
	let qrMessage = $state<string>('');
	let showQr = $state(false);

	async function openKudos(e: MouseEvent) {
		if (isMobile) return; // let the <a> navigate normally on mobile
		e.preventDefault();
		if (kudosHref === '#') return;
		const href = kudosHref;
		const msg = kudosMessage;
		qrDataUrl = await QRCode.toDataURL(href, { width: 240, margin: 2 });
		qrHref = href;
		qrMessage = msg;
		kudosMessage = '';
		showQr = true;
	}

	// ----- Appreciations state -----
	let transferEntries = $state<TransferEntry[]>([]);
	let amountMap = new SvelteMap<string, string>(); // txHash -> circles amount (incoming leg to org)
	let txLoading = $state(false);
	let txManualRefresh = $state(false);

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
			if (HIDDEN_TX_HASHES.has(entry.transactionHash.toLowerCase())) continue;
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

	// ----- Social proof: donations dedicated to the active recipient -----
	// Same scope as the feed: when `?address=` is set, count only donations whose
	// encoded recipient matches that address; otherwise count all group donations.
	// Deriving from kudosPairs guarantees the counter and the feed can never drift.
	// No time window for now — while volume is small the cumulative figure is more
	// compelling than a 7/14-day slice. Revisit when numbers get bigger.
	const recentDonationsCount = $derived(kudosPairs.length);

	// ----- Feed display cap -----
	// We render at most this many rows so the iframe doesn't grow unboundedly on
	// the embedder's page. The counter above still shows the true total, and an
	// "And more…" footer makes the truncation explicit. Bump if the embedder
	// asks for a longer feed.
	const FEED_DISPLAY_LIMIT = 10;
	const kudosPairsVisible = $derived(kudosPairs.slice(0, FEED_DISPLAY_LIMIT));
	// `>=` instead of `>` so the "And more…" footer renders whenever the feed is
	// at the cap — even if the local list happens to land on exactly 10. Treats
	// the feed as a window onto the history rather than a definitive list.
	const hasMoreLocal = $derived(kudosPairs.length >= FEED_DISPLAY_LIMIT);

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
		const missing = Array.from(new Set(addresses.map((a) => a.toLowerCase()))).filter(
			(a) => !profileCache.has(a)
		);
		if (!missing.length) return;

		// Mark addresses as in-flight immediately so concurrent callers don't refetch them.
		for (const a of missing) profileCache.set(a, { name: null, imageUrl: null });

		try {
			const profiles = (await jsonRpc(CIRCLES_RPC_URL, 'circles_getProfileByAddressBatch', [
				missing
			])) as Array<Record<string, unknown> | null> | null;
			if (Array.isArray(profiles)) {
				for (let i = 0; i < missing.length; i++) {
					const p = profiles[i];
					profileCache.set(missing[i], {
						name: (p?.name as string | null) || null,
						imageUrl: (p?.previewImageUrl as string | null) || null
					});
				}
			}
		} catch {
			/* profiles optional — leave placeholder entries so we don't retry every 5s */
		}
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
		try {
			// 1. Transfer data — source of truth for sender, recipient (in data), message
			const transferResult = (await jsonRpc(CIRCLES_RPC_URL, 'circles_getTransferData', [orgAddr])) as { results: TransferEntry[]; hasMore: boolean };
			transferEntries = transferResult.results ?? [];
			hasMore = transferResult.hasMore ?? false;

			// 2. Transaction history — used only to look up amounts by tx hash (high limit to avoid missing entries)
			const histResult = (await jsonRpc(CIRCLES_RPC_URL, 'circles_getTransactionHistory', [orgAddr, 500])) as { results: TxEntry[]; hasMore: boolean };
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

			if (showQr && !isMobile && qrMessage) {
				const lower = recipientAddress?.toLowerCase() ?? null;
				const matched = transferEntries.some((entry) => {
					if (entry.to.toLowerCase() !== orgAddr.toLowerCase()) return false;
					const r = decodeRecipient(entry.data);
					if (!r || (lower && r.toLowerCase() !== lower)) return false;
					return decodeMessage(entry.data) === qrMessage;
				});
				if (matched) showQr = false;
			}
		} catch {
			// errors silently suppressed
		} finally {
			txLoading = false;
			queueMicrotask(() => {
				const pi = (window as unknown as { parentIFrame?: { size?: () => void } }).parentIFrame;
				pi?.size?.();
			});
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

	// Load iframe-resizer child script so a parent embedding this page can auto-size the iframe.
	// Done imperatively (not in <svelte:head>) because SvelteKit's prerender strips raw <script> tags from head.
	$effect(() => {
		if (typeof window === 'undefined') return;
		if (window.parent === window) return;
		document.body.classList.add('in-iframe');
		if (document.querySelector('script[data-iframe-resizer-child]')) return;
		const s = document.createElement('script');
		s.src = 'https://cdn.jsdelivr.net/npm/iframe-resizer@4.2.10/js/iframeResizer.contentWindow.min.js';
		s.async = true;
		s.dataset.iframeResizerChild = 'true';
		document.head.appendChild(s);
	});

</script>

<svelte:head>
	<title>Appreciations</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		rel="stylesheet"
		href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap"
	/>
</svelte:head>

<div class="page" style={themeVars}>
	{#if activeConfig && introText}
		<header class="intro-block">
			<img class="intro-logo" src="/circles-token.svg" alt="Circles" />
			<h1 class="intro-cta">Donate for free</h1>
			<!-- INTRO_TEXTS values are hardcoded in this file, so {@html} is safe here. -->
			<p class="intro">{@html introText}</p>
		</header>
	{/if}
	<div class="card">


		<!-- ===== KUDOS ===== -->
			{#if recipientAddress}
				{@const recipientProfile = getProfile(recipientAddress)}
				<a
					class="kudos-btn"
					href={kudosHref}
					target="_blank"
					rel="noopener noreferrer"
					onclick={openKudos}
				>
					<div class="kudos-top-row">
						<span class="kudos-label">Donate to</span>
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
						<span class="kudos-arrow">
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
								<path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
							</svg>
						</span>
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
								<p class="qr-title">Scan to Donate CRC</p>
								<p class="qr-subtitle">Point your phone camera at the code</p>
							</div>
							<div class="qr-frame">
								<img class="qr-img" src={qrDataUrl} alt="QR code for CRC transfer link" />
							</div>
							<a class="qr-link-btn" href={qrHref} target="_blank" rel="noopener noreferrer">
								Open on this device instead
							</a>
						</div>
						<!-- svelte-ignore a11y_missing_attribute -->
						<a class="qr-bottom-anchor" data-iframe-height aria-hidden="true"></a>
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
				<div class="bar-status">
					{#if txLoading && txManualRefresh}
						<span class="spinner"></span>
						<span>Loading…</span>
					{:else if activeConfig && recentDonationsCount > 0}
						<span class="social-proof">
							<span class="social-proof-count">{recentDonationsCount}</span>
							{recentDonationsCount === 1 ? 'recent donation' : 'recent donations'}
						</span>
					{/if}
				</div>
				<button class="btn-refresh" onclick={() => loadHistory(ORG_ADDRESS, GROUP_ADDRESS, true)} disabled={txLoading && txManualRefresh}>
					↻ Refresh
				</button>
			</div>
			{#if !txLoading && kudosPairs.length === 0}
				<div class="empty">No appreciations found.</div>
			{/if}

			{#if kudosPairs.length > 0}
				<div class="tx-list">
					{#each kudosPairsVisible as tx, i (tx.transactionHash)}
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

				{#if hasMoreLocal || hasMore}
					<p class="has-more">And more…</p>
				{/if}
			{/if}



	</div>
</div>
<!-- svelte-ignore a11y_missing_attribute -->
<a data-iframe-height aria-hidden="true"></a>

<style>
	:global(body) {
		margin: 0;
		background: #ffffff;
		color: #101010;
		-webkit-font-smoothing: antialiased;
	}

	.page {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: 48px 16px;
		box-sizing: border-box;
		background: #ffffff;
		gap: 32px;
		font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	/* When embedded in an iframe (parent toggles the body class), drop 100vh —
	   iframe-resizer drives the iframe height from content, so anchoring to
	   the iframe's viewport creates a measurement feedback loop on mobile. */
	:global(body.in-iframe) .page {
		min-height: 0;
	}

	.intro-block {
		max-width: 860px;
		width: 100%;
		text-align: center;
		margin: 0;
	}

	.intro-logo {
		display: block;
		width: 56px;
		height: 56px;
		margin: 0 auto 16px;
	}

	.intro-cta {
		margin: 0 0 14px;
		font-size: clamp(1.4rem, 2.6vw, 1.85rem);
		line-height: 1.2;
		font-weight: 800;
		letter-spacing: -0.01em;
		color: var(--theme-primary, #101010);
	}

	.intro {
		margin: 0;
		font-size: clamp(0.95rem, 1.1vw, 1.05rem);
		line-height: 1.55;
		color: #2a2a2a;
	}

	.card {
		background: #ffffff;
		border-radius: 0.625rem;
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.08);
		max-width: 480px;
		width: 100%;
		padding: 28px 28px 28px;
		box-sizing: border-box;
	}

	@media (max-width: 450px) {
		.page {
			padding: 24px 16px;
			gap: 24px;
		}

		.intro-logo {
			width: 44px;
			height: 44px;
			margin-bottom: 12px;
		}

		.intro-cta {
			font-size: 1.3rem;
		}

		.intro {
			font-size: 0.95rem;
		}

		.card {
			border-radius: 0;
			box-shadow: none;
			padding: 16px;
		}
	}

	/* Status slot inside .refresh-bar — holds either the loading spinner+text
	   or the social-proof counter. Sits left, refresh button sits right. */
	.bar-status {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #7d7d7d;
		font-size: 0.85rem;
		flex: 1;
		min-width: 0;
	}

	.spinner {
		display: inline-block;
		width: 18px;
		height: 18px;
		border: 2.5px solid #ddd;
		border-top-color: var(--theme-primary, #00af5e);
		border-radius: 50%;
		animation: spin 0.75s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.empty {
		text-align: center;
		color: #999;
		font-size: 0.9rem;
		padding: 24px 0;
	}

	.row-even { background: #ffffff; }
	.row-odd  { background: #f9f9f9; }

	/* ----- Social proof counter (inline in the refresh-bar) ----- */
	.social-proof {
		display: inline-flex;
		align-items: baseline;
		gap: 5px;
		color: #2a2a2a;
		font-weight: 600;
		font-size: 0.92rem;
	}

	/* ----- Kudos donate button ----- */
	.kudos-btn {
		display: block;
		background: var(--theme-primary, #00af5e);
		color: #ffffff;
		border-radius: 0.625rem;
		padding: 0;
		text-decoration: none;
		margin-bottom: 20px;
		cursor: pointer;
		border: 1px solid var(--theme-border, #009a52);
		box-shadow: 0 4px 0 var(--theme-shadow, #007a41), 0 6px 14px rgba(var(--theme-shadow-rgba, 0, 122, 65), 0.25);
		transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.15s;
	}

	.kudos-btn:hover {
		background: var(--theme-primary-hover, #00bb66);
	}

	.kudos-btn:active {
		transform: translateY(2px);
		box-shadow: 0 2px 0 var(--theme-shadow, #007a41), 0 3px 8px rgba(var(--theme-shadow-rgba, 0, 122, 65), 0.25);
	}

	.kudos-top-row {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		flex-wrap: nowrap;
		gap: 10px;
		padding: 16px 20px;
		min-width: 0;
	}

	.kudos-arrow {
		color: #ffffff;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		margin-left: 2px;
	}

	.kudos-label {
		font-size: 1rem;
		font-weight: 600;
		color: #ffffff;
		flex-shrink: 0;
		white-space: nowrap;
	}

	.kudos-avatar {
		width: 32px;
		height: 32px;
		flex-shrink: 0;
	}

	.kudos-avatar img {
		width: 32px;
		height: 32px;
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
		min-width: 0;
	}

	.trust-name {
		font-size: 1rem;
		font-weight: 700;
		color: #101010;
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
		background: #f5f5f5;
		color: #101010;
		border: 1.5px solid #ddd;
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
		color: #101010;
		flex-shrink: 0;
	}

	/* ----- Appreciations ----- */
	.tx-list {
		border: 1.5px solid #ddd;
		border-radius: 0.625rem;
		overflow: hidden;
		margin-bottom: 4px;
	}

	.tx-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		border-bottom: 1px solid #ddd;
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

	@media (max-width: 450px) {
		.tx-row {
			flex-wrap: wrap;
			gap: 6px;
			padding: 10px 12px;
		}

		.tx-avatars {
			width: 100%;
		}

		.tx-body {
			width: 100%;
		}

		.avatar-wrap {
			width: 24px;
			height: 24px;
		}

		.avatar-img-sm,
		.avatar-placeholder-sm {
			width: 24px;
			height: 24px;
		}
	}

	.arrow {
		font-size: 0.85rem;
		color: #999;
		font-weight: 700;
		padding: 0 2px;
	}

	.tx-body { flex: 1; min-width: 0; }

	.tx-sentence {
		margin: 0;
		font-size: 0.88rem;
		color: #101010;
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
		color: #444;
		font-style: italic;
		line-height: 1.3;
	}

	.tx-name {
		font-weight: 700;
		color: #101010;
	}

	.tx-verb {
		color: #444;
		font-weight: 400;
	}

	.tx-amount {
		font-weight: 600;
		color: #222;
	}

	.has-more {
		text-align: center;
		font-size: 0.78rem;
		color: #999;
		font-style: italic;
		margin: 8px 0 4px;
	}

	/* ----- Refresh bar ----- */
	.refresh-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 24px;
		margin-bottom: 12px;
	}



	.btn-refresh {
		padding: 5px 12px;
		background: transparent;
		color: #999;
		border: 1px solid #ddd;
		border-radius: 8px;
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.btn-refresh:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.btn-refresh:not(:disabled):hover {
		color: #333;
		border-color: #999;
	}

	/* ----- QR overlay -----
	   Everything below is sized off --qr-size so the modal scales as a unit
	   and never exceeds the iframe width. position: absolute (not fixed) lets
	   iframe-resizer measure the modal height and grow the iframe to fit. */
	.qr-overlay {
		--qr-size: min(220px, 70vw);
		--qr-pad: calc(var(--qr-size) * 0.055);
		--card-pad: calc(var(--qr-size) * 0.11);
		--gap-sm: calc(var(--qr-size) * 0.03);
		--gap-md: calc(var(--qr-size) * 0.09);

		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(4px);
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: calc(var(--qr-size) * 0.15) var(--card-pad) calc(var(--qr-size) * 0.18);
		box-sizing: border-box;
		z-index: 100;
	}

	.qr-bottom-anchor {
		display: block;
		width: 0;
		height: 0;
		margin-top: calc(var(--qr-size) * 0.18);
	}

	.qr-card {
		background: #ffffff;
		border-radius: 0.625rem;
		padding: var(--card-pad);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
		position: relative;
		box-shadow: 0 24px 64px rgba(0, 0, 0, 0.22);
		width: 100%;
		max-width: calc(var(--qr-size) + var(--card-pad) * 2 + var(--qr-pad) * 2);
		box-sizing: border-box;
	}

	.qr-close {
		position: absolute;
		top: calc(var(--qr-size) * 0.065);
		right: calc(var(--qr-size) * 0.065);
		width: calc(var(--qr-size) * 0.13);
		height: calc(var(--qr-size) * 0.13);
		display: flex;
		align-items: center;
		justify-content: center;
		background: #f0f0f0;
		border: none;
		border-radius: 50%;
		font-size: calc(var(--qr-size) * 0.06);
		color: #666;
		cursor: pointer;
		line-height: 1;
		padding: 0;
		transition: background 0.12s, color 0.12s;
	}

	.qr-close:hover {
		background: var(--theme-primary, #00af5e);
		color: #ffffff;
	}

	.qr-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--gap-sm);
		margin-bottom: var(--gap-md);
		padding: 0 calc(var(--qr-size) * 0.11);
	}

	.qr-icon {
		font-size: calc(var(--qr-size) * 0.13);
		line-height: 1;
		margin-bottom: calc(var(--qr-size) * 0.025);
	}

	.qr-title {
		margin: 0;
		font-size: calc(var(--qr-size) * 0.075);
		font-weight: 700;
		letter-spacing: -0.01em;
		color: #101010;
		text-align: center;
	}

	.qr-subtitle {
		margin: 0;
		font-size: calc(var(--qr-size) * 0.058);
		color: #999;
		text-align: center;
	}

	.qr-frame {
		background: #f5f5f5;
		border-radius: 0.625rem;
		padding: var(--qr-pad);
		margin-bottom: var(--gap-md);
	}

	.qr-img {
		width: var(--qr-size);
		height: var(--qr-size);
		border-radius: 0;
		display: block;
	}

	.qr-link-btn {
		display: block;
		width: 100%;
		box-sizing: border-box;
		text-align: center;
		padding: calc(var(--qr-size) * 0.045) calc(var(--qr-size) * 0.073);
		background: var(--theme-primary, #00af5e);
		border: 1px solid var(--theme-border, #009a52);
		border-radius: 0.625rem;
		box-shadow: 0 4px 0 var(--theme-shadow, #007a41), 0 6px 14px rgba(var(--theme-shadow-rgba, 0, 122, 65), 0.25);
		font-size: calc(var(--qr-size) * 0.06);
		font-weight: 600;
		color: #ffffff;
		text-decoration: none;
		transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.15s;
	}

	.qr-link-btn:hover {
		background: var(--theme-primary-hover, #00bb66);
	}

	.qr-link-btn:active {
		transform: translateY(2px);
		box-shadow: 0 2px 0 var(--theme-shadow, #007a41), 0 3px 8px rgba(var(--theme-shadow-rgba, 0, 122, 65), 0.25);
	}
</style>
