<script lang="ts">
	import { onMount } from 'svelte';
	import { getAddress, isAddress, type Address } from 'viem';
	import { wallet } from '$lib/wallet.svelte';
	import { createPasskeySafe, inviteAccount, confirmRegistered } from '$lib/onboarding.svelte';
	import {
		readUserState,
		buildClaimTxs,
		totalAvailableWei,
		fetchProfileName,
		shortAddress,
		ONE,
		type UserState
	} from './circles';
	import { SHOPS, resolveShop, offerSentence, DEFAULT_OFFER, type Offer } from './shops';

	// Server (service EOA) that adds new users to the Circles Amsterdam group so
	// they can mint dAMS. Defaults to the deployed pilot endpoint; override with
	// VITE_DAMS_MEMBERSHIP_URL.
	const MEMBERSHIP_URL =
		(import.meta.env.VITE_DAMS_MEMBERSHIP_URL as string | undefined) ??
		'https://amsterdam-ashy.vercel.app/api/add-member';

	interface ReceiptData {
		amount: number;
		shop: string;
		shopName: string;
		txHash: string;
		at: number;
	}

	// ----- State -----
	let userState = $state<UserState | null>(null);
	let now = $state(Date.now());
	let selectedShop = $state<Address | null>(null);
	let shopName = $state<string | null>(null);
	let amountOverride = $state<number | null>(null);
	let username = $state('');
	let signingUp = $state(false);
	let signupNote = $state('');
	let claiming = $state(false);
	let errorMsg = $state('');
	let receipt = $state<ReceiptData | null>(null);
	let showReceipt = $state(false);
	let menuOpen = $state(false);

	let membershipTried = '';
	let loadedFor = '';

	// ----- Derived -----
	const connectedAddress = $derived(
		wallet.connected && wallet.address ? (getAddress(wallet.address) as Address) : null
	);
	const offer = $derived<Offer>(selectedShop ? offerFor(selectedShop) : DEFAULT_OFFER);
	// Balance comes straight from chain (held dAMS + Hub mintable) — never
	// synthesized. The counter just ticks down to the next top-of-hour, when the
	// next whole dAMS is minted.
	const availableWhole = $derived(
		userState ? Math.floor(Number(totalAvailableWei(userState)) / 1e18) : 0
	);
	const nextMint = $derived(mintCountdown(now));
	const elig = $derived(userState ? eligibility(availableWhole, now, offer.amountDams) : null);
	const enough = $derived(
		userState && selectedShop ? isEnoughDeliver(userState, selectedShop, offer.amountDams) : false
	);

	// ----- Helpers -----
	const ADJ = ['Canal', 'Tulip', 'Velvet', 'Amber', 'Bramble', 'Gable', 'Clever', 'Mellow', 'Brave', 'Sunny'];
	const NOUN = ['Heron', 'Otter', 'Sparrow', 'Linden', 'Ferry', 'Lantern', 'Bicycle', 'Windmill', 'Pancake', 'Stroopwafel'];
	function randomUsername(): string {
		const a = ADJ[Math.floor(Math.random() * ADJ.length)];
		const n = NOUN[Math.floor(Math.random() * NOUN.length)];
		return `${a}${n}${Math.floor(Math.random() * 90 + 10)}`;
	}
	function shuffleUsername() {
		username = randomUsername();
	}

	function offerFor(shop: Address): Offer {
		const base = resolveShop(shop).offer;
		return amountOverride ? { ...base, amountDams: amountOverride } : base;
	}

	function isEnoughDeliver(s: UserState, shop: Address, amountDams: number): boolean {
		const amountWei = BigInt(amountDams) * ONE;
		return buildClaimTxs(shop, s, shop, amountWei).deliverableErc20 >= amountWei;
	}

	// Whole CRCs mint at the top of each UTC hour (issuance is hour-aligned to the
	// protocol's inflation day-zero). The epoch is UTC-hour-aligned, so ms-into-hour
	// is just `t % 3_600_000`.
	function mintCountdown(t: number) {
		const msIntoHour = t % 3_600_000;
		const secs = Math.max(0, Math.round((3_600_000 - msIntoHour) / 1000));
		const mm = Math.floor(secs / 60);
		const ss = secs % 60;
		return { label: `${mm}:${String(ss).padStart(2, '0')}`, progressPct: (msIntoHour / 3_600_000) * 100 };
	}

	function eligibility(availableWhole: number, t: number, amountDams: number) {
		const remaining = amountDams - availableWhole;
		if (remaining <= 0) return { eligible: true, label: '' };
		// First missing dAMS lands at the next top-of-hour, then one per hour.
		const minsToNextHour = Math.ceil((3_600_000 - (t % 3_600_000)) / 60_000);
		const totalMins = (remaining - 1) * 60 + minsToNextHour;
		const h = Math.floor(totalMins / 60);
		const m = totalMins % 60;
		return { eligible: false, label: h > 0 ? `${h}h ${m}m` : `${m}m` };
	}

	function receiptKey(addr: string) {
		return `dams.receipt.${addr.toLowerCase()}`;
	}

	async function loadState(addr: Address): Promise<UserState> {
		const s = await readUserState(addr);
		userState = s;
		return s;
	}

	async function ensureMembership(addr: Address) {
		if (membershipTried === addr) return;
		membershipTried = addr;
		try {
			await fetch(MEMBERSHIP_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: addr })
			});
		} catch {
			/* best-effort */
		}
	}

	// ----- Actions -----
	async function handleSignup() {
		const name = username.trim() || randomUsername();
		errorMsg = '';
		signingUp = true;
		signupNote = 'Creating your account…';
		try {
			const { safeAddress, smartAccountClient } = await createPasskeySafe(name);
			signupNote = 'Registering you in Circles…';
			const invite = await inviteAccount(safeAddress);
			if (invite.status !== 'invited' && invite.status !== 'already') {
				throw new Error(
					invite.error
						? `Couldn't register your account: ${invite.error}`
						: "Couldn't register your account. Please try again."
				);
			}
			const registered = await confirmRegistered(safeAddress);
			if (!registered) {
				throw new Error('Almost there — your account is still registering. Try again in a moment.');
			}
			// Log in by adopting the client we already built (no second passkey prompt).
			wallet.adoptSmartAccount(smartAccountClient, safeAddress);
			signupNote = 'Joining Circles Amsterdam…';
			const a = getAddress(safeAddress) as Address;
			await ensureMembership(a);
			await loadState(a);
		} catch (e: any) {
			errorMsg = e?.message ?? String(e);
		} finally {
			signingUp = false;
			signupNote = '';
		}
	}

	async function handleLogin() {
		errorMsg = '';
		await wallet.connectAndPick();
		if (wallet.connected && wallet.address) {
			const a = getAddress(wallet.address) as Address;
			await ensureMembership(a);
			await loadState(a);
		} else if (wallet.connectionError) {
			errorMsg = wallet.connectionError;
		}
	}

	async function handleRedeem() {
		const shop = selectedShop;
		const a = connectedAddress;
		if (!shop || !a) return;
		const amount = offer.amountDams;
		errorMsg = '';
		claiming = true;
		try {
			const s = await loadState(a);
			if (!s.isMember) await ensureMembership(a);
			const amountWei = BigInt(amount) * ONE;
			const plan = buildClaimTxs(a, s, shop, amountWei);
			if (plan.deliverableErc20 < amountWei) {
				throw new Error(`Not enough dAMS yet — you need ${amount}.`);
			}
			const hash = await wallet.sendTransactions(plan.txs);
			const data: ReceiptData = {
				amount,
				shop,
				shopName: resolveShop(shop).name,
				txHash: String(hash),
				at: Date.now()
			};
			receipt = data;
			showReceipt = true;
			try {
				localStorage.setItem(receiptKey(a), JSON.stringify(data));
			} catch {
				/* ignore */
			}
			await loadState(a);
		} catch (e: any) {
			const m = e?.message ?? 'Payment failed.';
			errorMsg = /reject|cancel|denied|rejected/i.test(m) ? 'Payment cancelled.' : m;
		} finally {
			claiming = false;
		}
	}

	function signOut() {
		menuOpen = false;
		wallet.disconnect();
		userState = null;
		loadedFor = '';
		receipt = null;
	}

	// ----- Lifecycle -----
	onMount(() => {
		username = randomUsername();

		const url = new URL(window.location.href);
		const shopRaw = url.searchParams.get('shop') ?? url.searchParams.get('recipient');
		if (shopRaw && isAddress(shopRaw)) selectedShop = getAddress(shopRaw);
		const amt = url.searchParams.get('amount');
		if (amt && Number(amt) > 0) amountOverride = Number(amt);

		// Silent session restore — only when a Safe is already saved (never prompt
		// the passkey on a cold landing; newcomers use the explicit buttons).
		if (wallet.getSavedSafeAddress()) wallet.autoConnect();

		const tick = setInterval(() => {
			const t = Date.now();
			const rolledOver = Math.floor(t / 3_600_000) !== Math.floor(now / 3_600_000);
			now = t;
			// At the top of the hour a new dAMS mints — re-read so the balance updates.
			if (rolledOver && wallet.connected && wallet.address) {
				loadState(getAddress(wallet.address) as Address);
			}
		}, 1000);
		const refresh = setInterval(() => {
			if (wallet.connected && wallet.address) loadState(getAddress(wallet.address) as Address);
		}, 60_000);
		return () => {
			clearInterval(tick);
			clearInterval(refresh);
		};
	});

	// Load on-chain state whenever the connected account changes.
	$effect(() => {
		const a = connectedAddress;
		if (a && a !== loadedFor) {
			loadedFor = a;
			try {
				const raw = localStorage.getItem(receiptKey(a));
				if (raw) receipt = JSON.parse(raw);
			} catch {
				/* ignore */
			}
			loadState(a).then((s) => {
				if (!s.isMember) ensureMembership(a).then(() => loadState(a));
			});
		}
	});

	// Resolve the selected shop's display name (config first, then profile).
	$effect(() => {
		const shop = selectedShop;
		if (!shop) {
			shopName = null;
			return;
		}
		const cfg = resolveShop(shop);
		shopName = cfg.name;
		if (cfg.name === 'Participating shop') {
			fetchProfileName(shop).then((n) => {
				if (n) shopName = n;
			});
		}
	});

	const avatarInitial = $derived((wallet.avatarName || 'C').slice(0, 1).toUpperCase());
</script>

<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link
		href="https://fonts.googleapis.com/css2?family=Archivo:wght@800;900&family=Inter:wght@400;600&family=Poppins:wght@500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="dams-root">
	<div class="dams-app">
		<!-- Header -->
		<header class="topbar">
			<div class="left">
				{#if selectedShop && wallet.connected && userState}
					<button class="iconbtn" aria-label="Back" onclick={() => (selectedShop = null)}>
						<svg viewBox="0 0 24 24" width="20" height="20"
							><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg
						>
					</button>
				{/if}
				<span class="wordmark">Circles <span class="accent">Amsterdam</span></span>
			</div>
			{#if wallet.connected}
				<button class="avatar" aria-label="Account" onclick={() => (menuOpen = !menuOpen)}>
					{#if wallet.avatarImageUrl}
						<img src={wallet.avatarImageUrl} alt="" />
					{:else}
						<span>{avatarInitial}</span>
					{/if}
				</button>
			{/if}
		</header>

		<!-- Newcomer -->
		{#if !wallet.connected && !signingUp}
			<section class="screen">
				<div class="coin coin-lg drift"></div>
				<h1 class="display">Join the<br />community</h1>
				<p class="lede">
					We let locals create their own community currency and spend them for discounts at local
					shops. You can create <strong>1 dAMS per hour</strong>, free, forever.
				</p>

				{#if selectedShop}
					<p class="ctx">Join to redeem at <strong>{shopName ?? 'this shop'}</strong>.</p>
				{/if}

				<div class="block">
					<h2 class="eyebrow">Participating shops</h2>
					<div class="carousel">
						{#each SHOPS as s (s.address)}
							<div class="shop-card">
								<div class="coin coin-sm"></div>
								<p class="shop-name">{s.name}</p>
								<p class="shop-offer">{offerSentence(s.offer)}</p>
							</div>
						{/each}
					</div>
				</div>

				<label class="field">
					<span class="field-label">Pick a username</span>
					<div class="field-row">
						<input bind:value={username} maxlength="24" spellcheck="false" autocomplete="off" />
						<button class="shuffle" aria-label="Random username" onclick={shuffleUsername}>⟳</button>
					</div>
				</label>

				<div class="actions">
					<button class="btn-primary stacked" onclick={handleSignup}>
						<span>Join the community</span>
						<span class="sub">no email required</span>
					</button>
					<button class="btn-text" onclick={handleLogin}>
						{wallet.connecting ? 'Connecting…' : 'I already have an account'}
					</button>
				</div>
			</section>

			<!-- Signing up -->
		{:else if signingUp}
			<section class="screen center">
				<div class="coin coin-lg spin-slow"></div>
				<p class="note">{signupNote || 'Setting up…'}</p>
				<p class="muted small">Confirm with your device when prompted.</p>
			</section>

			<!-- Loading balance -->
		{:else if !userState}
			<section class="screen center">
				<div class="spinner"></div>
				<p class="muted">Reading your balance…</p>
			</section>

			<!-- Shop screen -->
		{:else if selectedShop}
			<section class="screen">
				<div class="coin coin-md">
					<div class="coin-num">
						<span class="num">{availableWhole}</span>
						<span class="unit">Your dAMS</span>
					</div>
				</div>
				<h1 class="display sm">{shopName ?? shortAddress(selectedShop)}</h1>
				<div class="card offer">
					<p class="offer-big">{offer.discountEuro}€ off</p>
					<p class="offer-sub">
						for <strong>{offer.amountDams} dAMS</strong> when purchasing above {offer.minPurchaseEuro}€
					</p>
				</div>

				<div class="actions">
					<button class="btn-primary" disabled={claiming || !enough} onclick={handleRedeem}>
						{#if claiming}
							Sending…
						{:else if enough}
							Redeem this offer
						{:else if elig?.eligible}
							Almost there…
						{:else}
							Eligible in {elig?.label}
						{/if}
					</button>
					{#if !enough && !claiming}
						<p class="muted small center-text">
							{#if elig?.eligible}
								Try again in a moment.
							{:else}
								You have {availableWhole} of {offer.amountDams} dAMS. They grow by one every hour.
							{/if}
						</p>
					{/if}
				</div>
			</section>

			<!-- Home -->
		{:else}
			<section class="screen">
				<div class="coin coin-lg">
					<div class="coin-num">
						<span class="num big">{availableWhole}</span>
						<span class="unit">Your dAMS</span>
					</div>
				</div>

				<div class="countdown">
					<div class="countdown-row">
						<span aria-hidden="true">⏳</span>
						<span>Next dAMS in <strong>{nextMint.label}</strong></span>
					</div>
					<div class="meter"><div class="meter-fill" style="width:{nextMint.progressPct}%"></div></div>
				</div>

				<div class="block">
					<h2 class="eyebrow">Participating shops</h2>
					<ul class="shop-list">
						{#each SHOPS as s (s.address)}
							<li>
								<button class="shop-row" onclick={() => (selectedShop = s.address)}>
									<span>
										<span class="shop-name">{s.name}</span>
										<span class="shop-offer">{offerSentence(s.offer)}</span>
									</span>
									<span class="chev" aria-hidden="true">›</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>

				{#if receipt}
					<button class="btn-secondary" onclick={() => (showReceipt = true)}>Show last receipt</button>
				{/if}
			</section>
		{/if}

		{#if errorMsg}
			<p class="error">{errorMsg}</p>
		{/if}
	</div>

	<!-- Receipt overlay -->
	{#if showReceipt && receipt}
		<div class="receipt" role="dialog" aria-modal="true">
			<div class="receipt-body">
				<div class="tick">
					<svg viewBox="0 0 24 24" width="58" height="58"
						><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="#2E1F8C" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg
					>
				</div>
				<p class="muted">Paid</p>
				<p class="paid">{receipt.amount} <span>dAMS</span></p>
				<div class="card rcard">
					<div class="rrow"><span>To</span><strong>{receipt.shopName}</strong></div>
					<div class="rrow">
						<span>When</span>
						<strong>{new Date(receipt.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
					</div>
					<div class="rrow">
						<span>Tx</span>
						<a href={`https://gnosisscan.io/tx/${receipt.txHash}`} target="_blank" rel="noreferrer"
							>{shortAddress(receipt.txHash)}</a
						>
					</div>
				</div>
				<p class="muted small">Show this to the cashier to claim your discount.</p>
			</div>
			<button class="btn-secondary wide" onclick={() => (showReceipt = false)}>Done</button>
		</div>
	{/if}

	<!-- Account menu -->
	{#if menuOpen}
		<button class="menu-backdrop" aria-label="Close" onclick={() => (menuOpen = false)}></button>
		<div class="menu">
			<p class="menu-name">{wallet.avatarName || 'Your account'}</p>
			{#if connectedAddress}<p class="menu-addr">{shortAddress(connectedAddress)}</p>{/if}
			<button class="btn-secondary wide" onclick={signOut}>Sign out</button>
		</div>
	{/if}
</div>

<style>
	.dams-root {
		position: fixed;
		inset: 0;
		overflow-y: auto;
		background: linear-gradient(180deg, #4428d4 0%, #3a2aaf 70%, #2e1f8c 100%);
		color: #fff;
		font-family: 'Inter', system-ui, sans-serif;
		-webkit-font-smoothing: antialiased;
	}
	.dams-app {
		max-width: 460px;
		min-height: 100%;
		margin: 0 auto;
		padding: 18px 22px 40px;
		display: flex;
		flex-direction: column;
	}
	strong {
		font-weight: 600;
		color: #fff;
	}

	/* Header */
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	.topbar .left {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.wordmark {
		font-family: 'Poppins', system-ui, sans-serif;
		font-weight: 600;
		font-size: 1.05rem;
		color: #fbf6f3;
	}
	.accent {
		color: #f26e2e;
	}
	.iconbtn {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.15);
		background: transparent;
		color: rgba(255, 255, 255, 0.85);
		cursor: pointer;
	}
	.avatar {
		width: 40px;
		height: 40px;
		border-radius: 999px;
		overflow: hidden;
		border: 1.5px solid rgba(153, 145, 239, 0.8);
		background: #6e47b6;
		display: grid;
		place-items: center;
		cursor: pointer;
		padding: 0;
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.avatar span {
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
	}

	/* Screens */
	.screen {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		animation: riseIn 0.48s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.screen.center {
		justify-content: center;
		gap: 16px;
	}

	.display {
		font-family: 'Archivo', system-ui, sans-serif;
		font-weight: 900;
		text-transform: uppercase;
		letter-spacing: -0.02em;
		line-height: 0.9;
		color: #9991ef;
		text-align: center;
		font-size: 2.5rem;
		margin: 26px 0 0;
	}
	.display.sm {
		font-size: 1.9rem;
		margin-top: 22px;
	}
	.lede {
		margin: 16px 0 0;
		max-width: 22rem;
		text-align: center;
		color: rgba(255, 255, 255, 0.78);
		line-height: 1.5;
	}
	.ctx {
		margin: 12px 0 0;
		font-size: 0.9rem;
		color: rgba(255, 255, 255, 0.7);
	}
	.note {
		font-family: 'Poppins', sans-serif;
		font-size: 1.1rem;
	}
	.muted {
		color: rgba(255, 255, 255, 0.6);
	}
	.small {
		font-size: 0.85rem;
	}
	.center-text {
		text-align: center;
	}

	/* Coin orb */
	.coin {
		background-image: radial-gradient(
			circle at 35% 30%,
			#76cd9c 0%,
			#f6611e 22%,
			#f26e2e 45%,
			#af4b8a 72%,
			#6e47b6 100%
		);
		border-radius: 50%;
		box-shadow: 0 0 40px rgba(242, 110, 46, 0.45), inset 0 0 0 1.5px rgba(255, 255, 255, 0.35);
		display: grid;
		place-items: center;
		flex: none;
	}
	.coin-lg {
		width: 220px;
		height: 220px;
	}
	.coin-md {
		width: 150px;
		height: 150px;
		margin-top: 6px;
	}
	.coin-sm {
		width: 46px;
		height: 46px;
		margin-bottom: 10px;
	}
	.coin-num {
		display: flex;
		flex-direction: column;
		align-items: center;
	}
	.coin-num .num {
		font-family: 'Archivo', sans-serif;
		font-weight: 900;
		line-height: 1;
		font-size: 2.6rem;
		text-shadow: 0 2px 12px rgba(0, 0, 0, 0.25);
	}
	.coin-num .num.big {
		font-size: 4.2rem;
	}
	.coin-num .unit {
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		font-size: 0.8rem;
		letter-spacing: 0.04em;
		color: rgba(255, 255, 255, 0.9);
	}

	/* Blocks */
	.block {
		width: 100%;
		margin-top: 28px;
	}
	.eyebrow {
		font-family: 'Poppins', sans-serif;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgba(255, 255, 255, 0.55);
		margin: 0 0 12px;
	}

	/* Carousel + cards */
	.carousel {
		display: flex;
		gap: 12px;
		overflow-x: auto;
		padding-bottom: 8px;
		margin: 0 -22px;
		padding-left: 22px;
		padding-right: 22px;
		scroll-snap-type: x mandatory;
	}
	.shop-card {
		min-width: 78%;
		scroll-snap-align: center;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 22px;
		padding: 16px 18px;
		backdrop-filter: blur(12px);
	}
	.shop-name {
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		margin: 0;
	}
	.shop-offer {
		margin: 2px 0 0;
		font-size: 0.88rem;
		color: #76cd9c;
	}

	.shop-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.shop-row {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		text-align: left;
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 18px;
		padding: 15px 16px;
		color: #fff;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.shop-row:hover {
		background: rgba(255, 255, 255, 0.1);
	}
	.shop-row .shop-name,
	.shop-row .shop-offer {
		display: block;
	}
	.chev {
		font-size: 1.3rem;
		color: rgba(255, 255, 255, 0.4);
	}

	/* Field */
	.field {
		width: 100%;
		margin-top: 22px;
	}
	.field-label {
		display: block;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.6);
		margin-bottom: 6px;
	}
	.field-row {
		display: flex;
		gap: 8px;
	}
	.field-row input {
		flex: 1;
		height: 50px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.07);
		color: #fff;
		padding: 0 16px;
		font-size: 1rem;
		font-family: 'Poppins', sans-serif;
	}
	.field-row input:focus {
		outline: none;
		border-color: #9991ef;
	}
	.shuffle {
		width: 50px;
		height: 50px;
		border-radius: 14px;
		border: 1px solid rgba(153, 145, 239, 0.6);
		background: transparent;
		color: #fff;
		font-size: 1.2rem;
		cursor: pointer;
	}

	/* Cards */
	.card {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 24px;
		backdrop-filter: blur(12px);
	}
	.offer {
		width: 100%;
		margin-top: 18px;
		padding: 20px;
		text-align: center;
	}
	.offer-big {
		font-family: 'Archivo', sans-serif;
		font-weight: 900;
		text-transform: uppercase;
		font-size: 2rem;
		margin: 0;
	}
	.offer-sub {
		margin: 4px 0 0;
		color: rgba(255, 255, 255, 0.8);
	}

	/* Countdown */
	.countdown {
		width: 176px;
		margin-top: 18px;
	}
	.countdown-row {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		font-size: 0.9rem;
		color: rgba(255, 255, 255, 0.7);
	}
	.countdown-row strong {
		font-family: 'Poppins', sans-serif;
		color: #9991ef;
		font-variant-numeric: tabular-nums;
	}
	.meter {
		margin-top: 8px;
		height: 6px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		overflow: hidden;
	}
	.meter-fill {
		height: 100%;
		border-radius: 999px;
		background: linear-gradient(135deg, #f6611e, #f26e2e);
	}

	/* Buttons */
	.actions {
		width: 100%;
		margin-top: auto;
		padding-top: 28px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}
	.btn-primary {
		width: 100%;
		min-height: 62px;
		border: none;
		border-radius: 999px;
		background: linear-gradient(135deg, #f6611e 0%, #f26e2e 100%);
		color: #fbf6f3;
		font-weight: 700;
		font-size: 1.15rem;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		line-height: 1.15;
		box-shadow: 0 6px 20px rgba(242, 110, 46, 0.35);
		transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.16s ease;
	}
	.btn-primary:not(:disabled):hover {
		transform: scale(1.03);
		box-shadow: 0 0 40px rgba(242, 110, 46, 0.55);
	}
	.btn-primary:disabled {
		opacity: 0.45;
		filter: saturate(0.6);
		cursor: not-allowed;
		box-shadow: none;
	}
	.btn-primary .sub {
		font-size: 0.75rem;
		font-weight: 400;
		opacity: 0.85;
	}
	.btn-secondary {
		width: 100%;
		min-height: 48px;
		border-radius: 999px;
		border: 1.5px solid #9991ef;
		background: transparent;
		color: #fff;
		font-weight: 600;
		font-size: 1rem;
		cursor: pointer;
	}
	.btn-secondary.wide {
		margin-top: 8px;
	}
	.btn-text {
		background: none;
		border: none;
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.95rem;
		padding: 10px;
		cursor: pointer;
		text-decoration: underline;
		text-decoration-style: dotted;
	}
	.btn-secondary {
		margin-top: auto;
	}

	.error {
		margin-top: 16px;
		border-radius: 12px;
		background: rgba(246, 97, 30, 0.2);
		color: #f26e2e;
		padding: 12px 16px;
		text-align: center;
		font-size: 0.9rem;
	}

	/* Spinner */
	.spinner {
		width: 28px;
		height: 28px;
		border-radius: 999px;
		border: 3px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		animation: spin 1s linear infinite;
	}

	/* Receipt */
	.receipt {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		flex-direction: column;
		background: rgba(46, 31, 140, 0.96);
		backdrop-filter: blur(6px);
		padding: 24px;
	}
	.receipt-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
	}
	.tick {
		width: 112px;
		height: 112px;
		border-radius: 999px;
		background: #76cd9c;
		display: grid;
		place-items: center;
		box-shadow: 0 0 24px rgba(118, 205, 156, 0.4);
		animation: pop 0.42s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.paid {
		font-family: 'Archivo', sans-serif;
		font-weight: 900;
		font-size: 3.4rem;
		margin: 4px 0 0;
	}
	.paid span {
		font-family: 'Poppins', sans-serif;
		font-size: 1.4rem;
		font-weight: 600;
		color: #9991ef;
	}
	.rcard {
		width: 100%;
		max-width: 340px;
		margin-top: 22px;
		padding: 6px 18px;
		text-align: left;
	}
	.rrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 0;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}
	.rrow:last-child {
		border-bottom: none;
	}
	.rrow span {
		color: rgba(255, 255, 255, 0.55);
		font-size: 0.9rem;
	}
	.rrow a {
		color: #76cd9c;
		text-decoration: underline dotted;
	}

	/* Account menu */
	.menu-backdrop {
		position: fixed;
		inset: 0;
		z-index: 40;
		background: transparent;
		border: none;
	}
	.menu {
		position: fixed;
		top: 70px;
		right: 22px;
		z-index: 41;
		width: 220px;
		background: #3a2aaf;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 18px;
		padding: 16px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
	}
	.menu-name {
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		margin: 0;
	}
	.menu-addr {
		margin: 2px 0 12px;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.55);
	}

	/* Animations */
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.spin-slow {
		animation: spin 1.1s linear infinite;
	}
	@keyframes drift {
		0%,
		100% {
			transform: translateY(-8px);
		}
		50% {
			transform: translateY(8px);
		}
	}
	.drift {
		animation: drift 8s ease-in-out infinite;
	}
	@keyframes riseIn {
		from {
			opacity: 0;
			transform: translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	@keyframes pop {
		0% {
			opacity: 0;
			transform: scale(0.8);
		}
		60% {
			transform: scale(1.04);
		}
		100% {
			opacity: 1;
			transform: scale(1);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.drift,
		.screen,
		.tick {
			animation: none;
		}
	}
</style>
