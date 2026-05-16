<script lang="ts">
	/**
	 * Direct Transfer — Circles miniapp embedded route.
	 *
	 * Lives at /apps/direct-transfer; loaded inside an iframe by the host page
	 * /miniapps/direct-transfer. Uses the miniapp-sdk postMessage bridge to
	 * receive the connected wallet from the parent and to submit tx batches
	 * the parent's Safe signs.
	 *
	 * Pure logic (atto math, balance classification, tx encoding, route
	 * planning) lives in ./routing.ts and is unit-tested in ./routing.test.ts.
	 */
	import { onMount } from 'svelte';
	import { onWalletChange, sendTransactions, isMiniappMode } from '@aboutcircles/miniapp-sdk';
	import { Sdk } from '@aboutcircles/sdk';
	import { inflationaryCirclesAbi } from '@aboutcircles/sdk-abis/inflationaryCircles';
	import {
		createPublicClient,
		http,
		getAddress,
		isAddress,
		parseUnits,
		formatUnits
	} from 'viem';
	import { gnosis } from 'viem/chains';

	import {
		ATTO_PER_HUNDREDTH,
		ZERO_ADDRESS,
		classifyBalance,
		floorAttoTo2Decimals,
		toDisplayAtto as _toDisplayAtto,
		fromDisplayAtto as _fromDisplayAtto,
		computeRoute as computeRoutePure,
		type Address,
		type DisplayUnit,
		type IssuerEntry,
		type TargetForm,
		type RoutePlan
	} from './routing';

	// ─── Constants ──────────────────────────────────────────────
	const RPC_URL = 'https://rpc.aboutcircles.com/';
	const TINY_THRESHOLD_ATTO = 10n ** 17n; // hide < 0.1 CRC by default in the list
	const RPC_FALLBACKS = [RPC_URL, 'https://rpc.gnosischain.com', 'https://1rpc.io/gnosis'];
	const receiptClients = RPC_FALLBACKS.map((url) =>
		createPublicClient({ chain: gnosis, transport: http(url) })
	);

	// ─── State ──────────────────────────────────────────────────
	type ViewName = 'disconnected' | 'loading' | 'balances' | 'send' | 'error';

	let connectedAddress = $state<Address | null>(null);
	let issuerMap = $state<Map<string, IssuerEntry & { profile: any; erc1155Static: bigint; totalStatic: bigint }>>(
		new Map()
	);
	let openIssuerKeys = $state(new Set<string>());
	let selectedIssuer = $state<(IssuerEntry & { profile: any }) | null>(null);
	let selectedRecipient = $state<{ address: Address; profile: any } | null>(null);
	let isSending = $state(false);
	let currentView = $state<ViewName>('disconnected');
	let errorMessage = $state('');

	// UI state
	let hideTinyEnabled = $state(true);
	let balancesSearchQuery = $state('');
	let recipientSearchQuery = $state('');
	let recipientResultsState = $state<{ kind: 'idle' | 'searching' | 'results' | 'empty' | 'error'; rows?: any[]; message?: string }>(
		{ kind: 'idle' }
	);
	let amountInput = $state('');
	let targetForm = $state<TargetForm>('ERC1155');
	let routeOpen = $state(false);
	let sendResult = $state<{ kind: 'success' | 'error'; message: string } | null>(null);
	let toast = $state<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);

	// Display unit (persisted)
	let displayUnit = $state<DisplayUnit>(
		(() => {
			try {
				return localStorage.getItem('direct-transfer:unit') === 'static' ? 'static' : 'demurraged';
			} catch {
				return 'demurraged';
			}
		})()
	);

	const profileCache = new Map<string, any>();
	let pendingSearchTimer: ReturnType<typeof setTimeout> | null = null;

	// ─── SDK (read-only) ────────────────────────────────────────
	let _sdk: Sdk | null = null;
	function getSdk(): Sdk {
		if (!_sdk) _sdk = new Sdk();
		return _sdk;
	}

	// ─── Helpers ────────────────────────────────────────────────
	function unitLabel(): string {
		return displayUnit === 'static' ? 'CRC (static)' : 'CRC';
	}

	function toDisplayAtto(todayAtto: bigint, entry?: { _staticFactor?: bigint } | null): bigint {
		return _toDisplayAtto(todayAtto, entry?._staticFactor ?? 0n, displayUnit);
	}

	function fromDisplayAtto(displayAtto: bigint, entry?: { _staticFactor?: bigint } | null): bigint {
		return _fromDisplayAtto(displayAtto, entry?._staticFactor ?? 0n, displayUnit);
	}

	function fmtCrc(todayAtto: bigint, entry?: { _staticFactor?: bigint } | null): string {
		const atto = toDisplayAtto(todayAtto, entry);
		if (atto < ATTO_PER_HUNDREDTH) return `< 0.01 ${unitLabel()}`;
		const floored = floorAttoTo2Decimals(atto);
		const n = Number(formatUnits(floored, 18));
		return `${n.toFixed(2)} ${unitLabel()}`;
	}

	function suffixCrcName(name: string): string {
		return `${name}-CRC`;
	}

	function shortAddress(addr: string | null | undefined): string {
		if (!addr) return '';
		return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
	}

	function decodeError(err: unknown): string {
		if (!err) return 'Unknown error';
		if (typeof err === 'string') return err;
		const e = err as { shortMessage?: string; message?: string };
		if (e.shortMessage) return e.shortMessage;
		if (e.message) return e.message;
		return String(err);
	}

	function parseAmountInputAtto(): bigint | null {
		const raw = (amountInput || '').trim();
		if (!raw) return null;
		const normalized = raw.replace(',', '.');
		if (!/^\d*\.?\d*$/.test(normalized) || normalized === '.' || normalized === '') return null;
		try {
			const inputAtto = parseUnits(normalized, 18);
			return fromDisplayAtto(inputAtto, selectedIssuer);
		} catch {
			return null;
		}
	}

	function avatarInitial(name: string | undefined): string {
		return (name || '?').charAt(0).toUpperCase();
	}

	function avatarImageOf(p: any): string | null {
		return p?.imageUrl || p?.previewImageUrl || null;
	}

	function showToast(message: string, type: 'info' | 'success' | 'error' = 'info', durationMs = 3500) {
		toast = { message, type };
		setTimeout(() => {
			if (toast?.message === message) toast = null;
		}, durationMs);
	}

	function applyDisplayUnit(unit: DisplayUnit) {
		displayUnit = unit;
		try {
			localStorage.setItem('direct-transfer:unit', unit);
		} catch {
			/* localStorage unavailable */
		}
	}

	// ─── Profile resolution (with rate-limit-safe cascade) ──────
	async function pMap<T>(items: T[], fn: (item: T, i: number) => Promise<void>, concurrency: number) {
		let cursor = 0;
		const worker = async () => {
			while (true) {
				const i = cursor++;
				if (i >= items.length) return;
				await fn(items[i], i);
			}
		};
		await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
	}

	async function fetchProfilesResilient(sdk: Sdk, addresses: Address[]): Promise<(any | null)[]> {
		const out: (any | null)[] = new Array(addresses.length).fill(null);
		const lower = addresses.map((a) => a.toLowerCase() as Address);
		// 1. Full-list batch.
		try {
			const r = await sdk.rpc.profile.getProfileByAddressBatch(addresses);
			if (Array.isArray(r)) {
				for (let i = 0; i < addresses.length; i++) out[i] = r[i] || null;
				return out;
			}
		} catch (e) {
			console.warn('[direct-transfer] full batch failed:', decodeError(e));
		}
		// 2. Chunked batches.
		const CHUNK = 20;
		const chunks: { start: number; addrs: Address[] }[] = [];
		for (let i = 0; i < addresses.length; i += CHUNK) {
			chunks.push({ start: i, addrs: addresses.slice(i, i + CHUNK) });
		}
		const failedChunkStarts: number[] = [];
		await pMap(
			chunks,
			async ({ start, addrs }) => {
				try {
					const r = await sdk.rpc.profile.getProfileByAddressBatch(addrs);
					for (let j = 0; j < addrs.length; j++) out[start + j] = r?.[j] || null;
				} catch (e) {
					console.warn(`[direct-transfer] chunk batch [${start}..] failed:`, decodeError(e));
					failedChunkStarts.push(start);
				}
			},
			3
		);
		// 3. Per-address singles, max 4 in flight.
		if (failedChunkStarts.length > 0) {
			const singles: number[] = [];
			for (const start of failedChunkStarts) {
				for (let j = 0; j < CHUNK && start + j < addresses.length; j++) singles.push(start + j);
			}
			await pMap(
				singles,
				async (i) => {
					try {
						out[i] = await sdk.rpc.profile.getProfileByAddress(lower[i]);
					} catch (e) {
						if (!/429|rate/i.test(decodeError(e))) {
							console.warn(`[direct-transfer] single [${i}] failed:`, decodeError(e));
						}
					}
				},
				4
			);
		}
		return out;
	}

	async function getProfile(address: Address): Promise<any> {
		const key = address.toLowerCase();
		if (profileCache.has(key)) return profileCache.get(key);
		const sdk = getSdk();
		let profile = null;
		try {
			profile = await sdk.rpc.profile.getProfileByAddress(address);
		} catch {
			/* not fatal */
		}
		if (!profile) {
			try {
				profile = await sdk.rpc.profile.getProfileByAddress(address.toLowerCase() as Address);
			} catch {
				/* not fatal */
			}
		}
		profileCache.set(key, profile);
		return profile;
	}

	function hasAddressField(r: any): boolean {
		const raw = r?.address || r?.avatarAddress || r?.account || r?.owner || r?.avatar;
		return raw && isAddress(raw);
	}

	async function searchProfiles(query: string): Promise<{ results: any[]; error: string | null }> {
		const sdk = getSdk();
		let primary: any[] = [];
		try {
			primary = (await sdk.rpc.profile.searchProfiles(query, 30, 0)) || [];
		} catch (e) {
			console.warn('[direct-transfer] searchProfiles failed:', decodeError(e));
		}
		const usablePrimary = primary.filter(hasAddressField);
		if (usablePrimary.length > 0) return { results: usablePrimary, error: null };
		try {
			const resp = await sdk.rpc.profile.searchByAddressOrName(query, 30, null);
			const arr = Array.isArray(resp) ? resp : resp?.results || [];
			return { results: arr.filter(hasAddressField), error: null };
		} catch (e) {
			return { results: [], error: decodeError(e) };
		}
	}

	// ─── Receipt polling ────────────────────────────────────────
	async function waitForReceipt(hash: `0x${string}`) {
		const POLL_MS = 3000;
		const TIMEOUT_MS = 3 * 60 * 1000;
		const deadline = Date.now() + TIMEOUT_MS;
		while (Date.now() < deadline) {
			for (const c of receiptClients) {
				try {
					const r = await c.getTransactionReceipt({ hash });
					if (r) return r;
				} catch {
					/* try next */
				}
			}
			await new Promise((r) => setTimeout(r, POLL_MS));
		}
		throw new Error(`Timed out waiting for tx ${hash}`);
	}

	// ─── Balances ───────────────────────────────────────────────
	async function loadBalances() {
		if (!connectedAddress) return;
		const sdk = getSdk();
		currentView = 'loading';

		let rows: any[] = [];
		try {
			rows = await sdk.rpc.balance.getTokenBalances(connectedAddress);
		} catch (err) {
			errorMessage = decodeError(err);
			currentView = 'error';
			return;
		}

		const map = new Map<string, IssuerEntry & { profile: any; erc1155Static: bigint; totalStatic: bigint }>();
		for (const b of rows) {
			const kind = classifyBalance(b);
			if (!kind) continue;
			const issuer = getAddress(b.tokenOwner) as Address;
			if (!map.has(issuer)) {
				map.set(issuer, {
					issuer,
					profile: null,
					erc1155: 0n,
					erc1155Static: 0n,
					totalStatic: 0n,
					demurraged: { addr: ZERO_ADDRESS, attoCircles: 0n, attoNative: 0n },
					inflationary: { addr: ZERO_ADDRESS, attoCircles: 0n, attoNative: 0n },
					_staticFactor: 0n
				});
			}
			const entry = map.get(issuer)!;
			const attoCircles = BigInt(b.attoCircles ?? 0);
			const attoStatic = BigInt(b.staticAttoCircles ?? 0);
			if (kind === 'erc1155') {
				entry.erc1155 += attoCircles;
				entry.erc1155Static += attoStatic;
			} else if (kind === 'demurraged') {
				entry.demurraged.addr = getAddress(b.tokenAddress) as Address;
				entry.demurraged.attoCircles += attoCircles;
				entry.demurraged.attoNative += attoCircles;
			} else if (kind === 'inflationary') {
				entry.inflationary.addr = getAddress(b.tokenAddress) as Address;
				entry.inflationary.attoCircles += attoCircles;
				entry.inflationary.attoNative += attoStatic;
			}
			entry.totalStatic += attoStatic;
			if ((entry._staticFactor === 0n || entry._staticFactor === undefined) && attoCircles > 0n && attoStatic > 0n) {
				entry._staticFactor = (attoStatic * 10n ** 18n) / attoCircles;
			}
		}

		const issuers = [...map.keys()] as Address[];
		if (issuers.length > 0) {
			const profiles = await fetchProfilesResilient(sdk, issuers);
			issuers.forEach((addr, i) => {
				map.get(addr)!.profile = profiles?.[i] || null;
				profileCache.set(addr.toLowerCase(), profiles?.[i] || null);
			});
		}

		issuerMap = map;
		currentView = 'balances';
	}

	// Derived: filtered + sorted list for the home screen.
	const filteredBalances = $derived.by(() => {
		const all = [...issuerMap.values()];
		const query = balancesSearchQuery.trim().toLowerCase();
		return all
			.filter((e) => {
				const total = e.erc1155 + e.demurraged.attoCircles + e.inflationary.attoCircles;
				if (hideTinyEnabled && total < TINY_THRESHOLD_ATTO) return false;
				if (total === 0n && !hideTinyEnabled) return false;
				if (!query) return true;
				const name = (e.profile?.name || '').toLowerCase();
				const reg = (e.profile?.registeredName || '').toLowerCase();
				const desc = (e.profile?.description || '').toLowerCase();
				return (
					name.includes(query) ||
					reg.includes(query) ||
					desc.includes(query) ||
					e.issuer.toLowerCase().includes(query)
				);
			})
			.sort((a, b) => {
				const ta = a.erc1155 + a.demurraged.attoCircles + a.inflationary.attoCircles;
				const tb = b.erc1155 + b.demurraged.attoCircles + b.inflationary.attoCircles;
				return tb > ta ? 1 : tb < ta ? -1 : 0;
			});
	});

	function toggleIssuerOpen(issuer: string) {
		const next = new Set(openIssuerKeys);
		if (next.has(issuer)) next.delete(issuer);
		else next.add(issuer);
		openIssuerKeys = next;
	}

	// ─── Send screen ────────────────────────────────────────────
	async function ensureWrappersResolved(entry: IssuerEntry) {
		const sdk = getSdk();
		const tasks: Promise<void>[] = [];
		if (entry.demurraged.addr === ZERO_ADDRESS) {
			tasks.push(
				sdk.tokens
					.getDemurragedWrapper(entry.issuer)
					.then((w: any) => {
						if (w && w !== ZERO_ADDRESS) entry.demurraged.addr = getAddress(w) as Address;
					})
					.catch(() => {})
			);
		}
		if (entry.inflationary.addr === ZERO_ADDRESS) {
			tasks.push(
				sdk.tokens
					.getInflationaryWrapper(entry.issuer)
					.then((w: any) => {
						if (w && w !== ZERO_ADDRESS) entry.inflationary.addr = getAddress(w) as Address;
					})
					.catch(() => {})
			);
		}
		if (tasks.length > 0) await Promise.all(tasks);
	}

	async function ensureInflationaryConversion(entry: IssuerEntry) {
		if (entry.inflationary.addr === ZERO_ADDRESS) return;
		if (entry._inflPerCrcAtto && entry._inflPerCrcAtto > 0n) return;
		if (entry.inflationary.attoCircles > 0n && entry.inflationary.attoNative > 0n) {
			entry._inflPerCrcAtto =
				(10n ** 18n * entry.inflationary.attoNative) / entry.inflationary.attoCircles;
			return;
		}
		try {
			const client = receiptClients[0];
			const nowTs = BigInt(Math.floor(Date.now() / 1000));
			const day = (await client.readContract({
				address: entry.inflationary.addr,
				abi: inflationaryCirclesAbi,
				functionName: 'day',
				args: [nowTs]
			})) as bigint;
			const ratio = (await client.readContract({
				address: entry.inflationary.addr,
				abi: inflationaryCirclesAbi,
				functionName: 'convertDemurrageToInflationaryValue',
				args: [10n ** 18n, day]
			})) as bigint;
			entry._inflPerCrcAtto = ratio;
		} catch (e) {
			console.warn('[direct-transfer] inflationary ratio fetch failed:', decodeError(e));
		}
	}

	function openSendScreen(entry: any) {
		selectedIssuer = entry;
		selectedRecipient = null;
		recipientSearchQuery = '';
		recipientResultsState = { kind: 'idle' };
		amountInput = '';
		sendResult = null;
		targetForm = 'ERC1155';
		routeOpen = false;
		currentView = 'send';

		ensureWrappersResolved(entry).then(async () => {
			await ensureInflationaryConversion(entry);
			// Trigger reactivity by reassigning the issuerMap reference.
			issuerMap = new Map(issuerMap);
		});
	}

	// ─── Recipient search (debounced) ───────────────────────────
	function onRecipientInput() {
		const q = recipientSearchQuery.trim();
		if (selectedRecipient) selectedRecipient = null;
		if (pendingSearchTimer) clearTimeout(pendingSearchTimer);
		if (q.length === 0) {
			recipientResultsState = { kind: 'idle' };
			return;
		}
		recipientResultsState = { kind: 'searching' };
		pendingSearchTimer = setTimeout(async () => {
			try {
				await runSearch(q);
			} catch (e) {
				recipientResultsState = { kind: 'error', message: decodeError(e) };
			}
		}, 200);
	}

	async function runSearch(query: string) {
		const trimmed = query.trim();
		if (recipientSearchQuery.trim() !== trimmed) return;
		let addressMatch: Address | null = null;
		if (isAddress(trimmed)) addressMatch = getAddress(trimmed) as Address;

		const { results, error } = await searchProfiles(trimmed);
		if (recipientSearchQuery.trim() !== trimmed) return; // stale

		const out = [...results];
		if (addressMatch && !out.some((r) => (r.address || r.avatarAddress)?.toLowerCase() === addressMatch!.toLowerCase())) {
			const profile = await getProfile(addressMatch);
			out.unshift({
				address: addressMatch,
				avatarAddress: addressMatch,
				name: profile?.name,
				description: profile?.description,
				imageUrl: profile?.imageUrl,
				previewImageUrl: profile?.previewImageUrl
			});
		}

		const seen = new Set<string>();
		const renderable: { addr: Address; row: any }[] = [];
		for (const r of out) {
			const raw = r.address || r.avatarAddress || r.account || r.owner || r.avatar;
			if (!raw || !isAddress(raw)) continue;
			const addr = getAddress(raw) as Address;
			const k = addr.toLowerCase();
			if (seen.has(k)) continue;
			seen.add(k);
			renderable.push({ addr, row: r });
		}

		if (renderable.length === 0) {
			if (error) recipientResultsState = { kind: 'error', message: error };
			else if (isAddress(trimmed)) recipientResultsState = { kind: 'empty', message: 'No matches.' };
			else
				recipientResultsState = {
					kind: 'empty',
					message: 'No matches. Paste a 0x… address to send to any wallet.'
				};
			return;
		}
		recipientResultsState = { kind: 'results', rows: renderable };
	}

	function selectRecipient(addr: Address, profile: any) {
		selectedRecipient = { address: addr, profile };
		recipientResultsState = { kind: 'idle' };
		recipientSearchQuery = '';
	}

	function clearRecipientSearch() {
		recipientSearchQuery = '';
		recipientResultsState = { kind: 'idle' };
		selectedRecipient = null;
	}

	// ─── Max button ─────────────────────────────────────────────
	function handleMaxClick() {
		const e = selectedIssuer;
		if (!e) return;
		const total = e.erc1155 + e.demurraged.attoCircles + e.inflationary.attoCircles;
		let cap: bigint;
		if (targetForm === 'ERC1155') cap = total;
		else if (targetForm === 'ERC20_DEM')
			cap = e.demurraged.addr === ZERO_ADDRESS ? e.demurraged.attoCircles : total;
		else cap = e.inflationary.addr === ZERO_ADDRESS ? e.inflationary.attoCircles : total;
		const capDisplay = toDisplayAtto(cap, e);
		const floored = floorAttoTo2Decimals(capDisplay);
		const n = Number(formatUnits(floored, 18));
		amountInput = n.toFixed(2);
	}

	// ─── Route preview ──────────────────────────────────────────
	const route = $derived.by<RoutePlan>(() => {
		if (currentView !== 'send' || !selectedIssuer) {
			return { steps: [], errors: [], warnings: [] };
		}
		const amountAtto = parseAmountInputAtto();
		const recipient = selectedRecipient?.address ?? null;
		const plan = computeRoutePure({
			entry: selectedIssuer,
			amountAtto,
			targetForm,
			recipient,
			fromAddress: connectedAddress!
		});
		// Rewrite atto step labels to use fmtCrc with the current display unit.
		const e = selectedIssuer;
		plan.steps = plan.steps.map((s) => {
			let label = s.label;
			label = label.replace(/(\d+) atto/g, (_, atto) => fmtCrc(BigInt(atto), e));
			label = label.replace(/0x[a-fA-F0-9]{40}/g, (addr) => shortAddress(addr));
			return { ...s, label };
		});
		plan.errors = plan.errors.map((err) =>
			err.replace(/(\d+) atto/g, (_, atto) => fmtCrc(BigInt(atto), e))
		);
		return plan;
	});

	const sendButtonReady = $derived(
		!isSending && route.steps.length > 0 && route.errors.length === 0
	);

	// ─── Send action ────────────────────────────────────────────
	async function handleSendClick() {
		if (isSending || route.errors.length > 0 || route.steps.length === 0) return;
		isSending = true;
		sendResult = null;
		try {
			const txs = route.steps.map((s) => s.tx);
			const hashes = await sendTransactions(txs);
			showToast('Transactions submitted, waiting for confirmation…', 'info');
			const lastHash = hashes[hashes.length - 1] as `0x${string}`;
			const receipt = await waitForReceipt(lastHash);
			if (receipt.status === 'reverted') throw new Error('Transaction reverted on-chain');
			sendResult = { kind: 'success', message: `Sent successfully. (${hashes.length} tx${hashes.length > 1 ? 's' : ''})` };
			showToast('Transfer confirmed', 'success');
			setTimeout(async () => {
				await loadBalances();
			}, 1500);
		} catch (err) {
			console.error('[direct-transfer] send failed:', err);
			sendResult = { kind: 'error', message: `Failed: ${decodeError(err)}` };
			showToast(decodeError(err), 'error', 5000);
		} finally {
			isSending = false;
		}
	}

	function goBack() {
		selectedIssuer = null;
		selectedRecipient = null;
		currentView = 'balances';
	}

	// ─── View labels ────────────────────────────────────────────
	const screenTitle = $derived(currentView === 'send' ? 'Send' : 'Your CRC balance');
	const screenSubtitle = $derived(
		currentView === 'send'
			? 'Choose recipient, amount, and the form to send in.'
			: 'Send CRC you hold directly to others.'
	);

	// Derived: total for the currently-selected issuer (for the send header).
	const selectedIssuerTotal = $derived(
		selectedIssuer
			? selectedIssuer.erc1155 + selectedIssuer.demurraged.attoCircles + selectedIssuer.inflationary.attoCircles
			: 0n
	);

	// ─── Mount ──────────────────────────────────────────────────
	onMount(() => {
		const unsubscribe = onWalletChange(async (address) => {
			if (!address) {
				connectedAddress = null;
				issuerMap = new Map();
				currentView = 'disconnected';
				return;
			}
			connectedAddress = getAddress(address) as Address;
			await loadBalances();
		});

		if (!isMiniappMode()) {
			console.warn('[direct-transfer] Not running inside the Circles MiniApp host.');
		}

		return () => {
			if (typeof unsubscribe === 'function') unsubscribe();
		};
	});
</script>

<svelte:head>
	<title>Direct Transfer</title>
</svelte:head>

<div class="app-shell">
	<header class="app-header">
		<div class="title-row">
			<h1>{screenTitle}</h1>
			<span class="badge {connectedAddress ? 'badge-connected' : 'badge-disconnected'}">
				{connectedAddress ? 'Connected' : 'Not connected'}
			</span>
		</div>
		<p class="subtitle">{screenSubtitle}</p>
	</header>

	{#if !isMiniappMode()}
		<div class="standalone-warning">
			⚠️ Standalone mode — wallet operations require the Circles host.
			Load via <a href="https://circles.gnosis.io/miniapps" target="_blank" rel="noopener">circles.gnosis.io/miniapps</a> to test fully.
		</div>
	{/if}

	{#if currentView === 'disconnected'}
		<div class="view">
			<div class="card">
				<div class="card-icon">🔗</div>
				<h2>Connect your wallet</h2>
				<p class="card-text">Open this app from the Circles wallet to view your balances and send transfers.</p>
			</div>
		</div>
	{:else if currentView === 'loading'}
		<div class="view">
			<div class="card">
				<div class="spinner"></div>
				<p class="card-text" style="text-align:center;margin-top:16px">Loading your balances…</p>
			</div>
		</div>
	{:else if currentView === 'balances'}
		<div class="view">
			<div class="balances-search-row">
				<input
					type="text"
					placeholder="Filter tokens by name or address…"
					autocomplete="off"
					spellcheck="false"
					bind:value={balancesSearchQuery}
				/>
				{#if balancesSearchQuery.length > 0}
					<button class="btn-clear" type="button" title="Clear" onclick={() => (balancesSearchQuery = '')}>×</button>
				{/if}
			</div>

			<div class="filter-row">
				<label class="toggle">
					<input type="checkbox" bind:checked={hideTinyEnabled} />
					<span class="toggle-track"><span class="toggle-thumb"></span></span>
					<span class="toggle-label">Hide under 0.1 CRC</span>
				</label>
				<div class="unit-switch-wrap">
					<div class="unit-switch" role="radiogroup" aria-label="Display unit">
						<button
							class="unit-btn {displayUnit === 'demurraged' ? 'unit-active' : ''}"
							type="button"
							role="radio"
							aria-checked={displayUnit === 'demurraged'}
							onclick={() => applyDisplayUnit('demurraged')}
						>demurraged</button>
						<button
							class="unit-btn {displayUnit === 'static' ? 'unit-active' : ''}"
							type="button"
							role="radio"
							aria-checked={displayUnit === 'static'}
							onclick={() => applyDisplayUnit('static')}
						>static</button>
					</div>
					<span class="unit-switch-label">units</span>
				</div>
				<button class="btn-ghost" type="button" title="Refresh" onclick={loadBalances}>↻</button>
			</div>

			{#if filteredBalances.length === 0}
				<div class="card">
					<div class="card-icon">📭</div>
					<h2>No balances</h2>
					<p class="card-text">No Circles tokens above the current threshold. Toggle the filter or clear the search to see everything.</p>
				</div>
			{:else}
				{#each filteredBalances as entry (entry.issuer)}
					{@const issuerName = entry.profile?.name || entry.profile?.registeredName || shortAddress(entry.issuer)}
					{@const total = entry.erc1155 + entry.demurraged.attoCircles + entry.inflationary.attoCircles}
					{@const open = openIssuerKeys.has(entry.issuer)}
					{@const img = avatarImageOf(entry.profile)}
					{@const desc = entry.profile?.description?.trim()}
					{@const regName = entry.profile?.registeredName}
					<div class="card balance-card" class:open>
						<div class="balance-summary">
							<button
								class="balance-toggle"
								type="button"
								aria-label="Show breakdown"
								onclick={() => toggleIssuerOpen(entry.issuer)}
							>
								<div class="balance-avatar">
									{#if img}
										<img src={img} alt="" />
									{:else}
										{avatarInitial(issuerName)}
									{/if}
								</div>
								<div class="balance-info">
									<div class="balance-name">{suffixCrcName(issuerName)}</div>
									<div class="balance-address">{shortAddress(entry.issuer)}</div>
								</div>
								<div class="balance-amount">{fmtCrc(total, entry)}</div>
								<div class="balance-chevron">▾</div>
							</button>
							<button class="btn-send-inline" type="button" onclick={() => openSendScreen(entry)}>Send</button>
						</div>

						{#if open}
							<div class="balance-details">
								<div class="token-meta">
									{#if regName && regName !== entry.profile?.name}
										<div class="token-meta-row">
											<span class="detail-label">Registered name</span>
											<span class="detail-value">{regName}</span>
										</div>
									{/if}
									{#if desc}
										<div class="token-description">{desc}</div>
									{/if}
									<div class="token-meta-row">
										<span class="detail-label">Avatar address</span>
										<span class="detail-value mono">{entry.issuer}</span>
									</div>
									<div class="token-meta-row">
										<span class="detail-label">ERC1155 token id</span>
										<span class="detail-value mono">{BigInt(entry.issuer).toString()}</span>
									</div>
									{#if entry.demurraged.addr !== ZERO_ADDRESS}
										<div class="token-meta-row">
											<span class="detail-label">ERC20 demurraged</span>
											<span class="detail-value mono">{shortAddress(entry.demurraged.addr)}</span>
										</div>
									{/if}
									{#if entry.inflationary.addr !== ZERO_ADDRESS}
										<div class="token-meta-row">
											<span class="detail-label">ERC20 inflationary</span>
											<span class="detail-value mono">{shortAddress(entry.inflationary.addr)}</span>
										</div>
									{/if}
								</div>
								<div class="detail-row">
									<span class="detail-label">ERC1155 (Hub native)</span>
									<span class="detail-value {entry.erc1155 === 0n ? 'zero' : ''}">{fmtCrc(entry.erc1155, entry)}</span>
								</div>
								<div class="detail-row">
									<span class="detail-label">ERC20 — Demurraged</span>
									<span class="detail-value {entry.demurraged.attoCircles === 0n ? 'zero' : ''}">{fmtCrc(entry.demurraged.attoCircles, entry)}</span>
								</div>
								<div class="detail-row">
									<span class="detail-label">ERC20 — Inflationary</span>
									<span class="detail-value {entry.inflationary.attoCircles === 0n ? 'zero' : ''}">{fmtCrc(entry.inflationary.attoCircles, entry)}</span>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{:else if currentView === 'send' && selectedIssuer}
		{@const issuerName = selectedIssuer.profile?.name || selectedIssuer.profile?.registeredName || shortAddress(selectedIssuer.issuer)}
		{@const img = avatarImageOf(selectedIssuer.profile)}
		<div class="view">
			<button class="btn-back" type="button" onclick={goBack}>← Back to balances</button>

			<div class="card token-card">
				<div class="community-row">
					<div class="community-avatar">
						{#if img}
							<img src={img} alt="" />
						{:else}
							{avatarInitial(issuerName)}
						{/if}
					</div>
					<div class="community-info">
						<div class="community-label">Sending</div>
						<div class="community-name">{suffixCrcName(issuerName)}</div>
					</div>
				</div>
				<div class="token-total-row">
					<span class="detail-label">Total available</span>
					<span class="detail-value">{fmtCrc(selectedIssuerTotal, selectedIssuer)}</span>
				</div>
			</div>

			<div class="card">
				<h2>Recipient</h2>
				<div class="search-row">
					<input
						type="text"
						placeholder="Search by name or paste address (0x…)"
						autocomplete="off"
						spellcheck="false"
						bind:value={recipientSearchQuery}
						oninput={onRecipientInput}
					/>
					{#if recipientSearchQuery.length > 0}
						<button class="btn-clear" type="button" title="Clear" onclick={clearRecipientSearch}>×</button>
					{/if}
				</div>
				{#if recipientResultsState.kind === 'searching'}
					<div class="search-results">
						<div class="search-empty">Searching…</div>
					</div>
				{:else if recipientResultsState.kind === 'empty'}
					<div class="search-results">
						<div class="search-empty">{recipientResultsState.message}</div>
					</div>
				{:else if recipientResultsState.kind === 'error'}
					<div class="search-results">
						<div class="search-empty">Search failed: {recipientResultsState.message}</div>
					</div>
				{:else if recipientResultsState.kind === 'results' && recipientResultsState.rows}
					<div class="search-results">
						{#each recipientResultsState.rows as r (r.addr)}
							{@const rImg = avatarImageOf(r.row)}
							{@const rName = r.row.name || r.row.registeredName || shortAddress(r.addr)}
							<button
								class="search-result"
								type="button"
								onclick={() => selectRecipient(r.addr, r.row)}
							>
								<div class="balance-avatar">
									{#if rImg}<img src={rImg} alt="" />{:else}{avatarInitial(rName)}{/if}
								</div>
								<div class="search-result-info">
									<div class="search-result-name">{rName}</div>
									<div class="search-result-address">{r.addr}</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
				{#if selectedRecipient}
					{@const rImg = avatarImageOf(selectedRecipient.profile)}
					{@const rName = selectedRecipient.profile?.name || selectedRecipient.profile?.registeredName || shortAddress(selectedRecipient.address)}
					<div class="recipient-selected">
						<div class="community-avatar">
							{#if rImg}<img src={rImg} alt="" />{:else}{avatarInitial(rName)}{/if}
						</div>
						<div class="recipient-meta">
							<div class="recipient-name">{rName}</div>
							<div class="recipient-address">{selectedRecipient.address}</div>
						</div>
					</div>
				{/if}
			</div>

			<div class="card">
				<h2>Amount</h2>
				<div class="amount-row">
					<input type="text" inputmode="decimal" placeholder="0.00" bind:value={amountInput} />
					<span class="amount-unit">{unitLabel()}</span>
					<button class="btn-mini" type="button" onclick={handleMaxClick}>Max</button>
				</div>
			</div>

			<div class="card">
				<h2>Send as</h2>
				<div class="form-options">
					<label class="form-option">
						<input type="radio" name="target-form" value="ERC1155" bind:group={targetForm} />
						<div class="form-option-body">
							<div class="form-option-title">ERC1155 (Hub native)</div>
							<div class="form-option-sub">Personal/group token transfer through Hub V2</div>
						</div>
					</label>
					<label class="form-option">
						<input type="radio" name="target-form" value="ERC20_DEM" bind:group={targetForm} />
						<div class="form-option-body">
							<div class="form-option-title">ERC20 — Demurraged</div>
							<div class="form-option-sub">Wrapped ERC-20, decays over time (1:1 with CRC today)</div>
						</div>
					</label>
					<label class="form-option">
						<input type="radio" name="target-form" value="ERC20_INFL" bind:group={targetForm} />
						<div class="form-option-body">
							<div class="form-option-title">ERC20 — Static / Inflationary</div>
							<div class="form-option-sub">Non-decaying wrapper, ideal for DeFi integrations</div>
						</div>
					</label>
				</div>
			</div>

			<details class="card route-card" bind:open={routeOpen}>
				<summary>Route details</summary>
				<div class="route-body">
					<div class="route-preview">
						{#if route.errors.length > 0}
							{#if !selectedRecipient || parseAmountInputAtto() == null}
								<em class="route-empty">Pick recipient and amount to see the route.</em>
							{:else}
								<div class="route-error">{route.errors[0]}</div>
							{/if}
						{:else if route.steps.length === 0}
							<em class="route-empty">Pick recipient and amount to see the route.</em>
						{:else}
							{#each route.steps as s, i}
								<div class="route-step">
									<div class="route-step-num">{i + 1}</div>
									<div class="route-step-text">{s.label}</div>
								</div>
							{/each}
							{#each route.warnings as w}
								<div class="route-warning">{w}</div>
							{/each}
						{/if}
					</div>
				</div>
			</details>

			<button class="btn-primary" type="button" disabled={!sendButtonReady} onclick={handleSendClick}>
				<span class="btn-text">{isSending ? 'Sending…' : 'Send'}</span>
				{#if isSending}<span class="btn-spinner spinner"></span>{/if}
			</button>

			{#if sendResult}
				<div class="result-box {sendResult.kind === 'error' ? 'result-error' : ''}">
					<div class="card-icon">{sendResult.kind === 'success' ? '✅' : '❌'}</div>
					<p>{sendResult.message}</p>
				</div>
			{/if}
		</div>
	{:else if currentView === 'error'}
		<div class="view">
			<div class="card card-warning">
				<div class="card-icon">⚠️</div>
				<h2>Something went wrong</h2>
				<p class="card-text">{errorMessage}</p>
				<button class="btn-primary" type="button" style="margin-top:14px" onclick={loadBalances}>Try again</button>
			</div>
		</div>
	{/if}
</div>

{#if toast}
	<div class="toast-host">
		<div class="toast {toast.type}">{toast.message}</div>
	</div>
{/if}

<style>
	/* Direct Transfer — Gnosis design system */

	:root {
		--bg-a: #faf5f1;
		--bg-b: #f6f7f9;
		--ink: #05061a;
		--muted: #51526e;
		--card: #ffffff;
		--line: #eee7e2;
		--line-soft: #f4eee9;
		--accent: #0e00a8;
		--accent-mid: #4335df;
		--accent-soft: #eae8ff;
		--success-bg: #dcfce7;
		--success-ink: #145324;
		--warn-bg: #feebc7;
		--warn-ink: #8a482c;
		--error-bg: #fee2e2;
		--error-ink: #7f1d1d;
	}

	:global(body) {
		font-family: 'Space Grotesk', -apple-system, ui-sans-serif, system-ui, 'Segoe UI', sans-serif;
		color: var(--ink);
		background:
			radial-gradient(1200px 500px at 0% 0%, rgba(14, 0, 168, 0.03) 0%, transparent 65%),
			radial-gradient(900px 500px at 100% 20%, rgba(255, 125, 62, 0.05) 0%, transparent 70%),
			linear-gradient(145deg, var(--bg-a), var(--bg-b));
		min-height: 100vh;
		margin: 0;
		padding: 20px 16px 40px;
	}

	.app-shell {
		max-width: 520px;
		margin: 0 auto;
	}

	.app-header {
		margin-bottom: 24px;
	}

	.title-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 6px;
	}

	h1 {
		margin: 0;
		letter-spacing: -0.02em;
		font-size: 28px;
		line-height: 1.1;
	}

	h2 {
		margin: 0 0 10px;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
	}

	.subtitle {
		color: var(--muted);
		font-size: 14px;
		line-height: 1.5;
		margin: 0;
	}

	.standalone-warning {
		background: #fff9ea;
		padding: 8px 16px;
		font-size: 12px;
		text-align: center;
		border: 1px solid #eee7e2;
		border-radius: 12px;
		margin-bottom: 16px;
	}

	.standalone-warning a {
		color: var(--accent);
	}

	.badge {
		border-radius: 999px;
		border: 1px solid;
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.badge-disconnected {
		background: var(--error-bg);
		border-color: var(--error-ink);
		color: var(--error-ink);
	}
	.badge-connected {
		background: var(--success-bg);
		border-color: var(--success-ink);
		color: var(--success-ink);
	}

	.card {
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(6px);
		border: 1px solid var(--line);
		border-radius: 22px;
		padding: 22px;
		box-shadow:
			0 8px 30px rgba(5, 6, 26, 0.08),
			inset 0 1px 0 #fff;
		margin-bottom: 16px;
	}
	.card-warning {
		border-color: var(--warn-ink);
		background: var(--warn-bg);
	}
	.card-icon {
		font-size: 36px;
		margin-bottom: 12px;
	}
	.card-text {
		color: var(--muted);
		font-size: 13px;
		line-height: 1.6;
		margin-top: 6px;
	}

	.balances-search-row {
		position: relative;
		display: flex;
		align-items: center;
		margin-bottom: 10px;
	}
	.balances-search-row input {
		flex: 1;
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 12px 14px;
		font-size: 14px;
		font-family: inherit;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
		background: rgba(255, 255, 255, 0.92);
		color: var(--ink);
	}
	.balances-search-row input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(14, 0, 168, 0.1);
	}

	.filter-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 4px 6px;
		margin-bottom: 12px;
	}

	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
		user-select: none;
		font-size: 13px;
		color: var(--ink);
	}
	.toggle input {
		display: none;
	}
	.toggle-track {
		position: relative;
		width: 36px;
		height: 20px;
		border-radius: 999px;
		background: var(--line);
		transition: background 0.2s;
		flex-shrink: 0;
	}
	.toggle-thumb {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: #fff;
		transition: transform 0.2s;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
	}
	.toggle input:checked + .toggle-track {
		background: var(--accent);
	}
	.toggle input:checked + .toggle-track .toggle-thumb {
		transform: translateX(16px);
	}

	.btn-ghost {
		background: transparent;
		border: 1px solid var(--line);
		color: var(--muted);
		border-radius: 999px;
		padding: 6px 12px;
		cursor: pointer;
		font-size: 14px;
		transition: background 0.15s;
	}
	.btn-ghost:hover {
		background: var(--line-soft);
	}

	.unit-switch-wrap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.unit-switch-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--muted);
		font-weight: 600;
	}
	.unit-switch {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 999px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.6);
	}
	.unit-btn {
		background: transparent;
		border: none;
		color: var(--muted);
		padding: 4px 10px;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		transition:
			background 0.15s,
			color 0.15s;
	}
	.unit-btn.unit-active {
		background: var(--accent);
		color: #fff;
	}

	.btn-mini {
		background: var(--accent-soft);
		border: 1px solid var(--accent-soft);
		color: var(--accent);
		border-radius: 999px;
		padding: 4px 12px;
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.btn-mini:hover {
		background: #d8d4ff;
	}

	.btn-primary {
		width: 100%;
		background: linear-gradient(90deg, var(--accent), var(--accent-mid));
		color: #fff;
		border: none;
		border-radius: 18px;
		padding: 16px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		transition:
			opacity 0.2s,
			transform 0.05s;
	}
	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.btn-primary:not(:disabled):active {
		transform: translateY(1px);
	}
	.btn-primary .spinner {
		width: 18px;
		height: 18px;
		border-width: 2px;
		margin: 0;
		border-color: rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
	}

	.btn-back {
		background: transparent;
		border: none;
		color: var(--muted);
		cursor: pointer;
		font-size: 13px;
		padding: 4px 0;
		margin-bottom: 12px;
		font-family: inherit;
	}
	.btn-back:hover {
		color: var(--ink);
	}

	/* Balance row */
	.balance-card {
		padding: 0;
		overflow: hidden;
	}
	.balance-summary {
		display: flex;
		align-items: stretch;
		gap: 0;
	}
	.balance-toggle {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 16px 16px 16px 20px;
		cursor: pointer;
		background: transparent;
		border: none;
		text-align: left;
		font-family: inherit;
		color: inherit;
		min-width: 0;
	}
	.balance-toggle:hover {
		background: var(--line-soft);
	}
	.btn-send-inline {
		flex-shrink: 0;
		margin: 12px 16px 12px 4px;
		background: linear-gradient(90deg, var(--accent), var(--accent-mid));
		color: #fff;
		border: none;
		border-radius: 12px;
		padding: 0 16px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		font-family: inherit;
		transition:
			opacity 0.15s,
			transform 0.05s;
	}
	.btn-send-inline:hover {
		opacity: 0.92;
	}
	.btn-send-inline:active {
		transform: translateY(1px);
	}
	.balance-avatar {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--accent-soft);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 18px;
		font-weight: 700;
		color: var(--accent);
		flex-shrink: 0;
		overflow: hidden;
	}
	.balance-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.balance-info {
		flex: 1;
		min-width: 0;
	}
	.balance-name {
		font-weight: 600;
		font-size: 15px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.balance-address {
		color: var(--muted);
		font-size: 11px;
		font-family: 'JetBrains Mono', monospace;
	}
	.balance-amount {
		font-family: 'JetBrains Mono', monospace;
		font-size: 15px;
		font-weight: 600;
		color: var(--ink);
		flex-shrink: 0;
	}
	.balance-chevron {
		color: var(--muted);
		font-size: 12px;
		transition: transform 0.2s;
		flex-shrink: 0;
	}
	.balance-card.open .balance-chevron {
		transform: rotate(180deg);
	}

	.balance-details {
		border-top: 1px solid var(--line-soft);
		padding: 12px 20px 16px;
	}
	.token-meta {
		padding-bottom: 8px;
		margin-bottom: 6px;
		border-bottom: 1px dashed var(--line-soft);
	}
	.token-meta-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 4px 0;
		font-size: 12px;
	}
	.token-description {
		font-size: 12px;
		color: var(--muted);
		line-height: 1.5;
		margin: 4px 0 8px;
	}
	.detail-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 0;
		font-size: 13px;
	}
	.detail-row + .detail-row {
		border-top: 1px solid var(--line-soft);
	}
	.detail-label {
		color: var(--muted);
	}
	.detail-value {
		font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', monospace;
		color: var(--ink);
		font-weight: 500;
	}
	.detail-value.zero {
		color: var(--muted);
	}
	.detail-value.mono {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 220px;
	}

	/* Token header on send screen */
	.token-card .community-row {
		margin-bottom: 14px;
	}
	.token-total-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-top: 12px;
		border-top: 1px solid var(--line-soft);
		font-size: 13px;
	}
	.community-avatar {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--accent-soft);
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 26px;
		font-weight: 700;
		color: var(--accent);
		flex-shrink: 0;
		overflow: hidden;
	}
	.community-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.community-row {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.community-info {
		flex: 1;
		min-width: 0;
	}
	.community-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		margin-bottom: 4px;
	}
	.community-name {
		font-size: 18px;
		font-weight: 600;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.search-row {
		position: relative;
		display: flex;
		align-items: center;
	}
	.search-row input,
	.amount-row input {
		flex: 1;
		border: 1px solid var(--line);
		border-radius: 14px;
		padding: 12px 14px;
		font-size: 14px;
		font-family: inherit;
		outline: none;
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
		background: #fff;
		color: var(--ink);
	}
	.search-row input:focus,
	.amount-row input:focus {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px rgba(14, 0, 168, 0.1);
	}
	.btn-clear {
		position: absolute;
		right: 8px;
		border: none;
		background: transparent;
		color: var(--muted);
		font-size: 18px;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.btn-clear:hover {
		background: var(--line-soft);
	}

	.search-results {
		margin-top: 8px;
		border: 1px solid var(--line);
		border-radius: 14px;
		overflow: hidden;
		background: #fff;
		max-height: 280px;
		overflow-y: auto;
	}
	.search-result {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		cursor: pointer;
		border: none;
		background: transparent;
		width: 100%;
		text-align: left;
		font-family: inherit;
		color: inherit;
	}
	.search-result:hover {
		background: var(--line-soft);
	}
	.search-result + .search-result {
		border-top: 1px solid var(--line-soft);
	}
	.search-result .balance-avatar {
		width: 36px;
		height: 36px;
		font-size: 14px;
	}
	.search-result-info {
		flex: 1;
		min-width: 0;
	}
	.search-result-name {
		font-weight: 500;
		font-size: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.search-result-address {
		color: var(--muted);
		font-size: 11px;
		font-family: 'JetBrains Mono', monospace;
	}
	.search-empty {
		padding: 12px 14px;
		color: var(--muted);
		font-size: 13px;
		text-align: center;
	}

	.recipient-selected {
		margin-top: 10px;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		background: var(--accent-soft);
		border: 1px solid #d8d4ff;
		border-radius: 14px;
	}
	.recipient-selected .community-avatar {
		width: 40px;
		height: 40px;
		font-size: 16px;
	}
	.recipient-meta {
		flex: 1;
		min-width: 0;
	}
	.recipient-name {
		font-weight: 600;
		font-size: 14px;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.recipient-address {
		color: var(--muted);
		font-size: 11px;
		font-family: 'JetBrains Mono', monospace;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.amount-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.amount-row input {
		flex: 1;
		font-family: 'JetBrains Mono', monospace;
		font-size: 18px;
		font-weight: 500;
	}
	.amount-unit {
		color: var(--muted);
		font-size: 14px;
		font-weight: 600;
	}

	.form-options {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.form-option {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 14px;
		border: 1px solid var(--line);
		border-radius: 14px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background 0.15s;
	}
	.form-option:hover {
		background: var(--line-soft);
	}
	.form-option input {
		margin-top: 4px;
		accent-color: var(--accent);
	}
	.form-option:has(input:checked) {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.form-option-body {
		flex: 1;
	}
	.form-option-title {
		font-weight: 600;
		font-size: 14px;
		color: var(--ink);
	}
	.form-option-sub {
		margin-top: 3px;
		font-size: 12px;
		color: var(--muted);
	}

	/* Route preview (collapsible) */
	.route-card {
		padding: 0;
	}
	.route-card summary {
		cursor: pointer;
		padding: 18px 22px;
		list-style: none;
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--muted);
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.route-card summary::-webkit-details-marker {
		display: none;
	}
	.route-card summary::after {
		content: '▾';
		transition: transform 0.2s ease;
		color: var(--muted);
	}
	.route-card[open] summary::after {
		transform: rotate(180deg);
	}
	.route-body {
		padding: 0 22px 22px;
		border-top: 1px solid var(--line-soft);
		padding-top: 14px;
	}
	.route-preview {
		font-size: 13px;
		color: var(--ink);
		line-height: 1.6;
	}
	.route-empty {
		color: var(--muted);
		font-style: italic;
	}
	.route-step {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 6px 0;
	}
	.route-step + .route-step {
		border-top: 1px solid var(--line-soft);
	}
	.route-step-num {
		flex-shrink: 0;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 11px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.route-step-text {
		flex: 1;
	}
	.route-warning {
		margin-top: 8px;
		font-size: 12px;
		color: var(--warn-ink);
		background: var(--warn-bg);
		padding: 8px 12px;
		border-radius: 10px;
	}
	.route-error {
		font-size: 12px;
		color: var(--error-ink);
		background: var(--error-bg);
		padding: 8px 12px;
		border-radius: 10px;
	}

	.result-box {
		margin-top: 16px;
		padding: 18px;
		border-radius: 18px;
		background: var(--success-bg);
		border: 1px solid var(--success-ink);
		color: var(--success-ink);
		text-align: center;
	}
	.result-box.result-error {
		background: var(--error-bg);
		border-color: var(--error-ink);
		color: var(--error-ink);
	}

	.toast-host {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 1000;
		pointer-events: none;
	}
	.toast {
		background: var(--ink);
		color: #fff;
		padding: 10px 18px;
		border-radius: 999px;
		font-size: 13px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
		animation: toastIn 0.2s ease;
		pointer-events: auto;
	}
	.toast.error {
		background: var(--error-ink);
	}
	.toast.success {
		background: var(--success-ink);
	}
	@keyframes toastIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--line);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: 0 auto;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.view {
		animation: fadeIn 0.3s ease;
	}
	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 560px) {
		h1 {
			font-size: 24px;
		}
		.card {
			padding: 18px;
			border-radius: 18px;
		}
		.balance-toggle {
			padding: 14px 12px 14px 16px;
		}
		.btn-send-inline {
			margin: 10px 12px 10px 4px;
			padding: 0 14px;
			font-size: 12px;
		}
		.balance-details {
			padding: 10px 16px 14px;
		}
	}
</style>
