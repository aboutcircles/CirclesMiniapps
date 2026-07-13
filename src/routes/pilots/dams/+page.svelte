<script lang="ts">
	import { onMount } from 'svelte';
	import { getAddress, isAddress, type Address } from 'viem';
	import { wallet } from '$lib/wallet.svelte';
	import { createPasskeySafe, inviteAccount, confirmRegistered } from '$lib/onboarding.svelte';
	import {
		readUserState,
		buildClaimTxs,
		deliverableWholeDams,
		fetchProfileName,
		shortAddress,
		ONE,
		type UserState
	} from './circles';
	import {
		SHOPS,
		resolveShop,
		offerSentence,
		activeOffer,
		SIGNUP_OFFER,
		DEFAULT_OFFER,
		type Offer
	} from './shops';
	import { maxConvertibleToDams, buildBoostTxs } from './boost';
	import { addOrder, readOrders, isFirstPurchase, type Order } from './orders';

	// Server (service EOA) that adds new users to the Circles Amsterdam group so
	// they can mint dAMS. Defaults to the deployed pilot endpoint; override with
	// VITE_DAMS_MEMBERSHIP_URL.
	const MEMBERSHIP_URL =
		(import.meta.env.VITE_DAMS_MEMBERSHIP_URL as string | undefined) ??
		'https://amsterdam-ashy.vercel.app/api/add-member';

	type ReceiptData = Order;

	// ----- State -----
	let userState = $state<UserState | null>(null);
	let now = $state(Date.now());
	let selectedShop = $state<Address | null>(null);
	let shopName = $state<string | null>(null);
	let amountOverride = $state<number | null>(null);
	let signingUp = $state(false);
	let signupNote = $state('');
	let claiming = $state(false);
	let errorMsg = $state('');
	let receipt = $state<ReceiptData | null>(null);
	let showReceipt = $state(false);
	let menuOpen = $state(false);

	// Boost ("secret" route): convert existing Circles into max dAMS.
	let showBoostHint = $state(false);
	let boostPhase = $state<'idle' | 'computing' | 'choose' | 'converting'>('idle');
	let boostMax = $state(0); // whole dAMS the user can convert
	let boostAmount = $state(0); // whole dAMS the user chose
	let boostError = $state('');
	let boostDone = $state(0); // whole dAMS converted in the last run (for the toast)

	// Signup bonus: collect the 48-CRC welcome bonus as dAMS (one tap).
	let bonusPhase = $state<'idle' | 'offer' | 'collecting'>('idle');
	let bonusAmount = $state(0);
	let bonusError = $state('');

	let membershipTried = '';
	let loadedFor = '';
	let lastCoinTap = 0;

	// True until the connected account has redeemed at least once. Drives the
	// two-stage offer: first purchase shows the 48-dAMS signup offer, then the
	// 100-dAMS follow-up. Kept in sync with the order history on load + redeem.
	let firstPurchase = $state(true);
	// Recent orders for the connected account (newest first) — the history sheet.
	let orders = $state<Order[]>([]);
	let showHistory = $state(false);

	// ----- PWA install -----
	// The captured beforeinstallprompt event (Chromium). Present → we can trigger
	// the native install prompt; absent on iOS/other browsers (manual instructions).
	let installEvent = $state<any>(null);
	let showInstall = $state(false);
	let isIos = $state(false);
	// Already running as an installed PWA? Then never nag to install.
	let isStandalone = $state(false);
	// The add-to-home-screen prompt is shown once per device, remembered in a cookie.
	const INSTALL_COOKIE = 'dams_install_prompted';

	function getCookie(name: string): string | null {
		try {
			const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
			return m ? decodeURIComponent(m[1]) : null;
		} catch {
			return null;
		}
	}
	function setCookie(name: string, value: string, days = 365) {
		try {
			const maxAge = days * 24 * 60 * 60;
			document.cookie = `${name}=${encodeURIComponent(value)}; path=/pilots/dams; max-age=${maxAge}; SameSite=Lax`;
		} catch {
			/* ignore */
		}
	}

	// One-account-per-device guard. Once this device has created an account we
	// never let it create a second one — the "Join" CTA routes to login instead.
	// (Cleared only by an explicit sign-out is NOT desired: the point is to stop
	// a single device from farming multiple welcome bonuses.)
	const ACCOUNT_CREATED_KEY = 'dams.account.created';
	// The signup welcome offer: 48 dAMS, per the pilot spec.
	const SIGNUP_BONUS_DAMS = 48;
	let accountAlreadyCreated = $state(false);

	// ----- Conditions of Participation (Pilot Terms) -----
	// Acceptance is stored per terms version (the date at the top of the terms);
	// bumping TERMS_VERSION re-prompts everyone after a material update.
	const TERMS_KEY = 'dams.terms.accepted';
	const TERMS_VERSION = '2026-07-03';
	let showTerms = $state(false);
	// The action (signup/login) the user was attempting, resumed after acceptance.
	let termsNext: (() => void) | null = null;

	function termsAccepted(): boolean {
		try {
			return localStorage.getItem(TERMS_KEY) === TERMS_VERSION;
		} catch {
			return false;
		}
	}

	// Run `next` immediately if the terms are already accepted, otherwise show
	// the consent sheet and run it once the user taps Continue.
	function requireTerms(next: () => void) {
		if (termsAccepted()) {
			next();
			return;
		}
		termsNext = next;
		showTerms = true;
	}

	function acceptTerms() {
		try {
			localStorage.setItem(TERMS_KEY, TERMS_VERSION);
		} catch {
			/* private mode — they'll be asked again next time */
		}
		showTerms = false;
		const next = termsNext;
		termsNext = null;
		next?.();
	}

	function dismissTerms() {
		showTerms = false;
		termsNext = null;
	}

	// URL marker mirroring the localStorage flag. Recording "already registered" in
	// the URL means a returning user who reopens/shares the link — even with no
	// localStorage (incognito, cleared storage, another browser) — is prompted for
	// their passkey to log in, instead of being offered a brand-new account.
	const REGISTERED_PARAM = 'registered';

	function urlSaysRegistered(): boolean {
		try {
			return new URL(window.location.href).searchParams.get(REGISTERED_PARAM) === '1';
		} catch {
			return false;
		}
	}

	// Persist "registered" into the URL (without a navigation) so it survives reloads
	// and travels when the link is copied.
	function markRegisteredInUrl() {
		try {
			const url = new URL(window.location.href);
			if (url.searchParams.get(REGISTERED_PARAM) === '1') return;
			url.searchParams.set(REGISTERED_PARAM, '1');
			history.replaceState(history.state, '', url);
		} catch {
			/* ignore */
		}
	}

	function hasCreatedAccount(): boolean {
		try {
			if (localStorage.getItem(ACCOUNT_CREATED_KEY) === '1') return true;
		} catch {
			/* ignore */
		}
		// The URL marker is the cross-storage fallback.
		return urlSaysRegistered();
	}
	function markAccountCreated() {
		try {
			localStorage.setItem(ACCOUNT_CREATED_KEY, '1');
		} catch {
			/* ignore */
		}
		markRegisteredInUrl();
		accountAlreadyCreated = true;
	}

	// ----- Derived -----
	const connectedAddress = $derived(
		wallet.connected && wallet.address ? (getAddress(wallet.address) as Address) : null
	);
	const offer = $derived<Offer>(
		selectedShop ? offerFor(selectedShop) : firstPurchase ? SIGNUP_OFFER : DEFAULT_OFFER
	);
	// Balance comes straight from chain — never synthesized. It counts everything
	// redeemable as dAMS: held dAMS, personal Circles convertible 1:1 via group-mint
	// (this is where the 48-CRC signup bonus lives), and what's mintable right now.
	// Uses the same flooring as the claim batch so the number matches what "Redeem"
	// can actually deliver. The counter ticks down to the next top-of-hour mint.
	const availableWhole = $derived(userState ? deliverableWholeDams(userState) : 0);
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

	function offerFor(shop: Address): Offer {
		// Two-stage: first purchase → 48-dAMS signup offer, then the shop's follow-up.
		const base = activeOffer(resolveShop(shop), firstPurchase);
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

	// Poll until the group trusts the user (membership tx mined), updating state.
	async function waitForMembership(addr: Address, attempts = 12, intervalMs = 1500): Promise<boolean> {
		for (let i = 0; i < attempts; i++) {
			try {
				const s = await readUserState(addr);
				if (s.isMember) {
					userState = s;
					return true;
				}
			} catch {
				/* transient — retry */
			}
			await new Promise((r) => setTimeout(r, intervalMs));
		}
		return false;
	}

	// ----- Actions -----
	async function handleSignup() {
		// One account per device: if this device already made one, log in instead
		// of minting a second Safe (and a second welcome bonus).
		if (hasCreatedAccount()) {
			await handleLogin();
			return;
		}
		// Always auto-register with a random name — no user-chosen username.
		const name = randomUsername();
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
			// From here on the account exists on-chain — block this device from
			// creating another one, even if the bonus/membership steps below fail.
			markAccountCreated();
			// Log in by adopting the client we already built (no second passkey prompt).
			wallet.adoptSmartAccount(smartAccountClient, safeAddress);
			signupNote = 'Joining Circles Amsterdam…';
			const a = getAddress(safeAddress) as Address;
			await ensureMembership(a);
			// Group must trust the user before their welcome bonus can be converted.
			const member = await waitForMembership(a);
			await loadState(a);
			// Offer the 48-CRC welcome bonus as collectable dAMS (needs a fresh
			// passkey gesture, so it's a tap — surfaced as a celebratory modal).
			let shownBonus = false;
			if (member) {
				try {
					const max = Math.floor(Number(await maxConvertibleToDams(a)) / 1e18);
					// The signup offer is 48 dAMS — never gift more than that here.
					bonusAmount = Math.min(SIGNUP_BONUS_DAMS, max);
					if (bonusAmount > 0) {
						bonusPhase = 'offer';
						shownBonus = true;
					}
				} catch {
					/* bonus is optional — never block sign-up on it */
				}
			}
			// Registration succeeded — invite them to install the app. If the welcome
			// bonus sheet is up, defer the install prompt until that's closed so the
			// two sheets never stack.
			if (!shownBonus) offerInstall();
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
				// `firstPurchase` is still true here — it's flipped after addOrder below.
				offerLabel: firstPurchase ? 'Welcome offer' : 'Follow-up offer',
				txHash: String(hash),
				at: Date.now()
			};
			receipt = data;
			showReceipt = true;
			// Append to order history and advance out of the first-purchase stage, so
			// the offer flips from the 48-dAMS signup deal to the 100-dAMS follow-up.
			orders = addOrder(a, data);
			firstPurchase = isFirstPurchase(a);
			await loadState(a);
		} catch (e: any) {
			const m = e?.message ?? 'Payment failed.';
			errorMsg = /reject|cancel|denied|rejected/i.test(m) ? 'Payment cancelled.' : m;
		} finally {
			claiming = false;
		}
	}

	// Dismiss the receipt and return to the home screen (participating shops), so
	// the user sees the next offer rather than staying on the just-redeemed shop.
	function closeReceipt() {
		showReceipt = false;
		selectedShop = null;
	}

	function signOut() {
		menuOpen = false;
		wallet.disconnect();
		userState = null;
		loadedFor = '';
		receipt = null;
		orders = [];
		firstPurchase = true;
		showHistory = false;
	}

	// ----- Boost: double-tap the coin to convert existing Circles into dAMS -----
	function handleCoinTap() {
		const t = Date.now();
		if (t - lastCoinTap < 400) {
			lastCoinTap = 0;
			startBoost();
		} else {
			lastCoinTap = t;
		}
	}

	async function startBoost() {
		const a = connectedAddress;
		if (!a || boostPhase !== 'idle') return;
		showBoostHint = false;
		boostError = '';
		boostPhase = 'computing';
		try {
			const max = await maxConvertibleToDams(a);
			boostMax = Math.floor(Number(max) / 1e18);
			boostAmount = boostMax;
			boostPhase = 'choose';
		} catch (e: any) {
			boostError = e?.message ?? 'Could not check your balance.';
			boostPhase = 'idle';
		}
	}

	async function confirmBoost() {
		const a = connectedAddress;
		if (!a || boostAmount <= 0) return;
		boostError = '';
		boostPhase = 'converting';
		try {
			const txs = await buildBoostTxs(a, BigInt(boostAmount) * ONE);
			await wallet.sendTransactions(txs);
			boostDone = boostAmount;
			await loadState(a);
			boostPhase = 'idle';
		} catch (e: any) {
			const m = e?.message ?? 'Conversion failed.';
			boostError = /reject|cancel|denied|rejected/i.test(m) ? 'Cancelled.' : m;
			boostPhase = 'choose';
		}
	}

	function closeBoost() {
		boostPhase = 'idle';
		boostError = '';
	}

	// ----- Signup bonus -----
	async function collectBonus() {
		const a = connectedAddress;
		if (!a || bonusAmount <= 0) return;
		bonusError = '';
		bonusPhase = 'collecting';
		try {
			const txs = await buildBoostTxs(a, BigInt(bonusAmount) * ONE);
			await wallet.sendTransactions(txs);
			await loadState(a);
			boostDone = bonusAmount; // reuse the success toast
			bonusPhase = 'idle';
			offerInstall(); // now that the bonus sheet is gone, offer install
		} catch (e: any) {
			const m = e?.message ?? 'Could not collect your bonus.';
			bonusError = /reject|cancel|denied|rejected/i.test(m) ? 'Cancelled.' : m;
			bonusPhase = 'offer';
		}
	}

	function dismissBonus() {
		bonusPhase = 'idle';
		bonusError = '';
		offerInstall(); // offer install after the bonus sheet is dismissed
	}

	// ----- PWA install -----
	// Open the "Add to home screen" sheet after sign-up. Shown once per device
	// (remembered in a cookie) and never when already installed. Works on all
	// mobile browsers: if the native prompt isn't available we show manual steps.
	function offerInstall() {
		if (isStandalone) return;
		if (getCookie(INSTALL_COOKIE) === '1') return;
		setCookie(INSTALL_COOKIE, '1'); // shown once — don't offer again on this device
		showInstall = true;
	}

	// Manually open the sheet from the account menu (ignores the once-only cookie).
	function openInstall() {
		menuOpen = false;
		showInstall = true;
	}

	// Fire the native Chromium install prompt if we have it; otherwise the sheet
	// shows platform instructions and this just closes it.
	async function confirmInstall() {
		if (installEvent) {
			try {
				installEvent.prompt();
				await installEvent.userChoice;
			} catch {
				/* user dismissed — nothing to do */
			}
			installEvent = null;
		}
		showInstall = false;
	}

	function dismissInstall() {
		showInstall = false;
	}

	// ----- Lifecycle -----
	onMount(() => {
		const url = new URL(window.location.href);
		const shopRaw = url.searchParams.get('shop') ?? url.searchParams.get('recipient');
		if (shopRaw && isAddress(shopRaw)) selectedShop = getAddress(shopRaw);
		const amt = url.searchParams.get('amount');
		if (amt && Number(amt) > 0) amountOverride = Number(amt);

		accountAlreadyCreated = hasCreatedAccount();

		// ----- PWA install wiring -----
		// Point the installable app at this pilot ("Circles Amsterdam") instead of
		// the generic app-wide manifest, and colour the standalone chrome purple.
		try {
			document
				.querySelectorAll('link[rel="manifest"]')
				.forEach((el) => el.setAttribute('href', '/pilots/dams.webmanifest'));
			const themeMeta = document.querySelector('meta[name="theme-color"]');
			if (themeMeta) themeMeta.setAttribute('content', '#4428d4');
		} catch {
			/* head not writable — non-fatal */
		}
		// Are we already installed / running standalone?
		isStandalone =
			window.matchMedia?.('(display-mode: standalone)').matches ||
			(navigator as any).standalone === true;
		// iOS never fires beforeinstallprompt — detect it so we can show manual steps.
		const ua = navigator.userAgent || '';
		isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
		// Capture the Chromium install prompt so we can trigger it on our terms.
		const onBeforeInstall = (e: Event) => {
			e.preventDefault();
			installEvent = e;
		};
		const onInstalled = () => {
			installEvent = null;
			showInstall = false;
			isStandalone = true;
		};
		window.addEventListener('beforeinstallprompt', onBeforeInstall);
		window.addEventListener('appinstalled', onInstalled);

		if (wallet.getSavedSafeAddress()) {
			// Silent session restore — a Safe is already saved locally. Users from
			// before the Pilot Terms existed still owe one acceptance: surface the
			// consent sheet over the restored session (Continue just records it).
			wallet.autoConnect();
			if (!termsAccepted()) showTerms = true;
		} else if (accountAlreadyCreated) {
			// Known returning user (URL/flag says registered) but no saved Safe on this
			// device — prompt the passkey to log them in rather than let them create a
			// second account. handleLogin() surfaces any error and loads their state.
			// The Pilot Terms sheet comes first if they haven't accepted yet.
			requireTerms(handleLogin);
		}
		// Otherwise it's a genuine cold landing for a newcomer — show the explicit
		// Join / "I already have an account" buttons; never auto-prompt the passkey.

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
			window.removeEventListener('beforeinstallprompt', onBeforeInstall);
			window.removeEventListener('appinstalled', onInstalled);
		};
	});

	// Load on-chain state whenever the connected account changes.
	$effect(() => {
		const a = connectedAddress;
		if (a && a !== loadedFor) {
			loadedFor = a;
			// Rehydrate this account's history + offer stage from local storage.
			orders = readOrders(a);
			firstPurchase = orders.length === 0;
			receipt = orders[0] ?? null;
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
	<title>Circles Amsterdam</title>
	<meta name="apple-mobile-web-app-capable" content="yes" />
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
	<meta name="apple-mobile-web-app-title" content="Circles AMS" />
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
					<h2 class="eyebrow">Available offers</h2>
					<div class="carousel">
						{#each SHOPS as s (s.address)}
							<div class="shop-card">
								<div class="coin coin-sm"></div>
								<div class="shop-card-text">
									<p class="shop-name">{s.name}</p>
									<p class="shop-offer">{offerSentence(SIGNUP_OFFER)}</p>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<div class="actions">
					{#if accountAlreadyCreated}
						<!-- Already registered (local flag or ?registered=1 in the URL) —
						     log in with the passkey instead of creating a second account. -->
						<button class="btn-primary stacked" onclick={() => requireTerms(handleLogin)}>
							<span>{wallet.connecting ? 'Connecting…' : 'Log in'}</span>
							<span class="sub">welcome back</span>
						</button>
					{:else}
						<button class="btn-primary stacked" onclick={() => requireTerms(handleSignup)}>
							<span>Join the community</span>
							<span class="sub">no email required</span>
						</button>
						<button class="btn-text" onclick={() => requireTerms(handleLogin)}>
							{wallet.connecting ? 'Connecting…' : 'I already have an account'}
						</button>
					{/if}
				</div>

				<p class="legal-link">
					<a href="/pilots/dams-terms">Conditions of Participation</a>
				</p>
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
					{#if firstPurchase}
						<span class="offer-badge">Welcome offer</span>
					{/if}
					<p class="offer-big">{offer.discountEuro}€ off</p>
					<p class="offer-sub">
						for <strong>{offer.amountDams} dAMS</strong>
						{#if firstPurchase}
							on your first purchase
						{:else if offer.minPurchaseEuro > 0}
							when purchasing above {offer.minPurchaseEuro}€
						{:else}
							on any purchase
						{/if}
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
				<button class="coin coin-lg" onclick={handleCoinTap} aria-label="Your dAMS balance">
					<div class="coin-num">
						<span class="num big">{availableWhole}</span>
						<span class="unit">Your dAMS</span>
					</div>
				</button>

				<div class="countdown">
					<div class="countdown-row">
						<span aria-hidden="true">⏳</span>
						<span>Next dAMS in <strong>{nextMint.label}</strong></span>
						<button
							class="helper"
							aria-label="Can I have more dAMS?"
							onclick={() => (showBoostHint = true)}>?</button
						>
					</div>
					<div class="meter"><div class="meter-fill" style="width:{nextMint.progressPct}%"></div></div>
				</div>

				<div class="block">
					<h2 class="eyebrow">Available offers</h2>
					<ul class="shop-list">
						{#each SHOPS as s (s.address)}
							<li>
								<button class="shop-row" onclick={() => (selectedShop = s.address)}>
									<span>
										<span class="shop-name">{s.name}</span>
										<span class="shop-offer">{offerSentence(activeOffer(s, firstPurchase))}</span>
									</span>
									<span class="chev" aria-hidden="true">›</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
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
			<button class="btn-secondary wide" onclick={closeReceipt}>Done</button>
		</div>
	{/if}

	<!-- Account menu -->
	{#if menuOpen}
		<button class="menu-backdrop" aria-label="Close" onclick={() => (menuOpen = false)}></button>
		<div class="menu">
			<p class="menu-name">{wallet.avatarName || 'Your account'}</p>
			{#if connectedAddress}<p class="menu-addr">{shortAddress(connectedAddress)}</p>{/if}
			<button
				class="btn-secondary wide"
				onclick={() => {
					menuOpen = false;
					showHistory = true;
				}}
			>
				Redeemed Offers
			</button>
			{#if !isStandalone}
				<button class="btn-secondary wide" onclick={openInstall}>Add to home screen</button>
			{/if}
			<button class="btn-secondary wide" onclick={signOut}>Sign out</button>
			<p class="menu-legal">
				<a href="/pilots/dams-terms">Conditions of Participation</a>
			</p>
		</div>
	{/if}

	<!-- Redeem history -->
	{#if showHistory}
		<button class="sheet-backdrop" aria-label="Close" onclick={() => (showHistory = false)}></button>
		<div class="sheet" role="dialog" aria-modal="true">
			<div class="grab"></div>
			<h2 class="sheet-title">Redeemed Offers</h2>
			{#if orders.length === 0}
				<p class="muted">No offers redeemed yet. Redeem an offer and it'll show up here.</p>
			{:else}
				<ul class="order-list">
					{#each orders as o (o.txHash + o.at)}
						<li class="order-row">
							<span class="order-info">
								<span class="order-datetime">
									{new Date(o.at).toLocaleDateString([], { day: 'numeric', month: 'short' })}
									· {new Date(o.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
								</span>
								<span class="order-shop">{o.shopName}</span>
								{#if o.offerLabel}<span class="order-offer">{o.offerLabel}</span>{/if}
							</span>
							<span class="order-amount">{o.amount} <span class="order-unit">dAMS</span></span>
						</li>
					{/each}
				</ul>
			{/if}
			<button class="btn-secondary wide" onclick={() => (showHistory = false)}>Close</button>
		</div>
	{/if}

	<!-- Pilot Terms consent -->
	{#if showTerms}
		<button class="sheet-backdrop" aria-label="Close" onclick={dismissTerms}></button>
		<div class="sheet" role="dialog" aria-modal="true">
			<div class="grab"></div>
			<h2 class="sheet-title">Conditions of Participation</h2>
			<p class="muted small">Amsterdam Pilot · 3.7.2026</p>
			<p class="sheet-body">
				The Amsterdam Pilot is an experimental programme by Gnosis. Before you continue, please
				note:
			</p>
			<ul class="terms-points">
				<li>
					Gnosis only provides this interface — it offers no redemption, exchange, brokerage or
					cash-out service for CRC or dAMS.
				</li>
				<li>CRC and dAMS have no guaranteed value.</li>
				<li>
					Participation gives no right to fiat, reimbursement or compensation from Gnosis;
					discounts are offered by the merchants themselves.
				</li>
				<li>Any use of CRC or dAMS outside the Pilot is at your own risk.</li>
			</ul>
			<p class="muted small">
				By tapping Continue or connecting your wallet you confirm that you have read and agree to
				the full <a class="terms-link" href="/pilots/dams-terms" target="_blank"
					>Conditions of Participation</a
				>.
			</p>
			<button class="btn-primary" onclick={acceptTerms}>Continue</button>
			<button class="btn-text" onclick={dismissTerms}>Not now</button>
		</div>
	{/if}

	<!-- Signup bonus -->
	{#if bonusPhase !== 'idle'}
		<button class="sheet-backdrop" aria-label="Close" onclick={dismissBonus}></button>
		<div class="sheet" role="dialog" aria-modal="true">
			<div class="grab"></div>
			<div class="bonus">
				<div class="coin coin-md drift"></div>
				<h2 class="sheet-title">Welcome — here's your bonus 🎉</h2>
				<p class="muted">
					You've been gifted Circles to get started. Collect them as
					<strong>{bonusAmount} dAMS</strong>.
				</p>
				{#if bonusError}<p class="error">{bonusError}</p>{/if}
				{#if bonusPhase === 'collecting'}
					<div class="sheet-center">
						<div class="spinner"></div>
						<p class="muted">Collecting…</p>
						<p class="muted small">Confirm with your device when prompted.</p>
					</div>
				{:else}
					<button class="btn-primary" onclick={collectBonus}>Collect {bonusAmount} dAMS</button>
					<button class="btn-text" onclick={dismissBonus}>Maybe later</button>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Boost: hint -->
	{#if showBoostHint}
		<button class="sheet-backdrop" aria-label="Close" onclick={() => (showBoostHint = false)}></button>
		<div class="sheet" role="dialog" aria-modal="true">
			<div class="grab"></div>
			<p class="sheet-body">
				Already had an account for a while and think it should be more? Tap the red ball twice to
				see whether you can increase your balance.
			</p>
			<button class="btn-secondary wide" onclick={() => (showBoostHint = false)}>Got it</button>
		</div>
	{/if}

	<!-- Boost: computing / choose / converting -->
	{#if boostPhase !== 'idle'}
		<button class="sheet-backdrop" aria-label="Close" onclick={closeBoost}></button>
		<div class="sheet" role="dialog" aria-modal="true">
			<div class="grab"></div>
			{#if boostPhase === 'computing'}
				<div class="sheet-center">
					<div class="spinner"></div>
					<p class="muted">Checking how much you can convert…</p>
				</div>
			{:else if boostPhase === 'choose'}
				{#if boostMax <= 0}
					<h2 class="sheet-title">Nothing extra to convert</h2>
					<p class="muted">Your balance is already as high as it can go right now.</p>
					<button class="btn-secondary wide" onclick={closeBoost}>Close</button>
				{:else}
					<h2 class="sheet-title">Increase your balance</h2>
					<p class="muted">
						You can convert your other Circles into up to <strong>{boostMax} dAMS</strong>.
					</p>
					<div class="boost-amount">
						<span class="boost-num">{boostAmount}</span>
						<span class="boost-unit">dAMS</span>
					</div>
					<input
						class="slider"
						type="range"
						min="1"
						max={boostMax}
						bind:value={boostAmount}
						aria-label="Amount to convert"
					/>
					<div class="slider-ends"><span>1</span><span>{boostMax} (max)</span></div>
					{#if boostError}<p class="error">{boostError}</p>{/if}
					<button class="btn-primary" onclick={confirmBoost}>Convert {boostAmount} dAMS</button>
					<button class="btn-text" onclick={closeBoost}>Cancel</button>
				{/if}
			{:else if boostPhase === 'converting'}
				<div class="sheet-center">
					<div class="spinner"></div>
					<p class="muted">Converting…</p>
					<p class="muted small">Confirm with your device when prompted.</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Boost: success toast -->
	{#if boostDone > 0 && boostPhase === 'idle'}
		<button class="toast" onclick={() => (boostDone = 0)}>
			✅ Added {boostDone} dAMS to your balance
		</button>
	{/if}

	<!-- Add to home screen -->
	{#if showInstall}
		<button class="sheet-backdrop" aria-label="Close" onclick={dismissInstall}></button>
		<div class="sheet" role="dialog" aria-modal="true">
			<div class="grab"></div>
			<div class="install">
				<div class="coin coin-md drift"></div>
				<h2 class="sheet-title">Add to your home screen</h2>
				<p class="muted">
					Install Circles Amsterdam for one-tap access and a full-screen app — no app store,
					no download.
				</p>
				{#if installEvent}
					<!-- Native prompt available (Chromium / Android). -->
					<button class="btn-primary" onclick={confirmInstall}>Add to home screen</button>
					<button class="btn-text" onclick={dismissInstall}>Maybe later</button>
				{:else if isIos}
					<ol class="install-steps">
						<li>Tap the <strong>Share</strong> button <span aria-hidden="true">⬆️</span> in the toolbar.</li>
						<li>Scroll down and choose <strong>Add to Home Screen</strong>.</li>
						<li>Tap <strong>Add</strong> — done!</li>
					</ol>
					<button class="btn-secondary wide" onclick={dismissInstall}>Got it</button>
				{:else}
					<!-- Other browsers: generic manual steps. -->
					<ol class="install-steps">
						<li>Open your browser’s <strong>menu</strong> (⋮ or ⋯).</li>
						<li>Choose <strong>Add to Home screen</strong> or <strong>Install app</strong>.</li>
						<li>Confirm — done!</li>
					</ol>
					<button class="btn-secondary wide" onclick={dismissInstall}>Got it</button>
				{/if}
			</div>
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
	button.coin {
		border: none;
		font: inherit;
		color: inherit;
		cursor: pointer;
	}
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
		width: 100%;
		scroll-snap-align: center;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 22px;
		padding: 16px 18px;
		backdrop-filter: blur(12px);
		display: flex;
		align-items: center;
		gap: 14px;
	}
	/* On the carousel card the coin sits beside the text, not above it. */
	.shop-card .coin-sm {
		margin-bottom: 0;
	}
	.shop-card-text {
		min-width: 0;
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
	/* Keep the offer line on the carousel card to a single line. */
	.shop-card .shop-offer {
		white-space: nowrap;
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
	.offer-badge {
		display: inline-block;
		margin-bottom: 8px;
		padding: 4px 12px;
		border-radius: 999px;
		background: rgba(118, 205, 156, 0.18);
		border: 1px solid rgba(118, 205, 156, 0.5);
		color: #76cd9c;
		font-family: 'Poppins', sans-serif;
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
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

	/* Boost */
	.helper {
		width: 20px;
		height: 20px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.3);
		background: transparent;
		color: rgba(255, 255, 255, 0.7);
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}
	.sheet-backdrop {
		position: fixed;
		inset: 0;
		z-index: 45;
		background: rgba(46, 31, 140, 0.6);
		border: none;
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 46;
		max-width: 460px;
		margin: 0 auto;
		background: #3a2aaf;
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-bottom: none;
		border-radius: 28px 28px 0 0;
		padding: 14px 22px 28px;
		box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.35);
		animation: riseIn 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
	}
	.grab {
		width: 44px;
		height: 5px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.25);
		margin: 0 auto 16px;
	}
	.sheet-body {
		font-size: 1.05rem;
		line-height: 1.5;
		color: rgba(255, 255, 255, 0.85);
		margin: 4px 0 18px;
	}
	.sheet-title {
		font-family: 'Poppins', sans-serif;
		font-size: 1.3rem;
		font-weight: 600;
		margin: 0 0 4px;
	}
	.sheet-center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 24px 0 8px;
	}

	/* Pilot Terms consent + links */
	.terms-points {
		margin: 0 0 14px;
		padding-left: 20px;
		font-size: 0.92rem;
		line-height: 1.45;
		color: rgba(255, 255, 255, 0.85);
	}
	.terms-points li {
		margin-bottom: 6px;
	}
	.terms-link {
		color: #b7aaff;
	}
	.legal-link {
		margin: 18px 0 0;
		text-align: center;
		font-size: 0.85rem;
	}
	.legal-link a,
	.menu-legal a {
		color: rgba(255, 255, 255, 0.55);
		text-decoration: underline;
	}
	.menu-legal {
		margin: 10px 0 0;
		text-align: center;
		font-size: 0.85rem;
	}

	/* Order history */
	.order-list {
		list-style: none;
		margin: 14px 0 18px;
		padding: 0;
		max-height: 46vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
	}
	.order-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 2px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}
	.order-row:last-child {
		border-bottom: none;
	}
	.order-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		line-height: 1.25;
		min-width: 0;
	}
	.order-datetime {
		font-size: 0.82rem;
		color: rgba(255, 255, 255, 0.5);
	}
	.order-shop {
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		font-size: 0.98rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.order-offer {
		align-self: flex-start;
		margin-top: 2px;
		padding: 2px 9px;
		border-radius: 999px;
		background: rgba(153, 145, 239, 0.16);
		border: 1px solid rgba(153, 145, 239, 0.4);
		color: #b7b1f5;
		font-size: 0.72rem;
		font-weight: 600;
	}
	.order-amount {
		flex: none;
		padding-left: 12px;
		font-family: 'Archivo', sans-serif;
		font-weight: 900;
		font-size: 1.5rem;
	}
	.order-unit {
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		font-size: 0.8rem;
		color: #9991ef;
	}
	.bonus {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 6px;
	}
	.bonus .coin-md {
		margin: 4px 0 10px;
	}
	.bonus .btn-primary {
		margin-top: 14px;
	}

	/* Install / add-to-home-screen sheet */
	.install {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 6px;
	}
	.install .coin-md {
		margin: 4px 0 10px;
	}
	.install .btn-primary {
		margin-top: 14px;
	}
	.install-steps {
		text-align: left;
		margin: 14px 0 18px;
		padding-left: 20px;
		color: rgba(255, 255, 255, 0.85);
		line-height: 1.6;
		font-size: 0.95rem;
	}
	.install-steps li {
		margin-bottom: 4px;
	}
	.boost-amount {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 8px;
		margin: 18px 0 6px;
	}
	.boost-num {
		font-family: 'Archivo', sans-serif;
		font-weight: 900;
		font-size: 3rem;
		line-height: 1;
	}
	.boost-unit {
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		color: #9991ef;
	}
	.slider {
		width: 100%;
		accent-color: #f26e2e;
		margin: 6px 0 2px;
	}
	.slider-ends {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: rgba(255, 255, 255, 0.5);
		margin-bottom: 16px;
	}
	.sheet .btn-primary {
		margin-top: 6px;
	}
	.toast {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		z-index: 47;
		border: 1px solid rgba(118, 205, 156, 0.5);
		background: rgba(46, 31, 140, 0.96);
		color: #fff;
		border-radius: 999px;
		padding: 12px 20px;
		font-weight: 600;
		cursor: pointer;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
		animation: riseIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) both;
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
