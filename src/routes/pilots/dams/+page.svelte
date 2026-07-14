<script lang="ts">
	import { onMount } from 'svelte';
	import { getAddress, isAddress, type Address } from 'viem';
	import { wallet } from '$lib/wallet.svelte';
	import {
		createPasskeySafe,
		inviteAccount,
		confirmRegistered,
		buildUpdateNameTx
	} from '$lib/onboarding.svelte';
	import {
		readUserState,
		buildClaimTxs,
		deliverableWholeDams,
		fetchProfileName,
		fetchShopPayments,
		shortAddress,
		ONE,
		type UserState
	} from './circles';
	import {
		SHOPS,
		resolveShop,
		activeOffers,
		SIGNUP_OFFER,
		DEFAULT_OFFER,
		SECOND_OFFER,
		type Offer
	} from './shops';
	import {
		addOrder,
		readOrders,
		writeOrders,
		mergeOrders,
		isFirstPurchase,
		type Order
	} from './orders';
	import { maxConvertibleToDams, buildBoostTxs } from './boost';

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

	// dAMS the pathfinder can route from the user's OWN personal CRC into the
	// group (fromTokens = the user's personal token). Raw float; the derived
	// values below clamp it by the personal CRC actually still held, so a stale
	// pathfinder graph (it lags the chain by blocks) can never resurrect tokens
	// that were just spent — the 3.5s state refresh zeroes the clamp instantly.
	let convertibleRaw = $state(0);

	// Change-name sheet (opened from the avatar menu).
	let showNameEdit = $state(false);
	let nameDraft = $state('');
	let nameSaving = $state(false);
	let nameError = $state('');

	let membershipTried = '';
	let loadedFor = '';

	// True until the connected account has redeemed at least once. Drives the
	// two-stage offer: first purchase shows the 48-dAMS signup offer, then the
	// 100-dAMS follow-up. Kept in sync with the order history on load + redeem.
	let firstPurchase = $state(true);
	// The local cache can be stale (new device / cleared storage): until the
	// on-chain history read settles, a user who already redeemed elsewhere would
	// briefly see the outdated 48-dAMS welcome offer. While unresolved and the
	// welcome offer WOULD show, the offer areas show a loader instead.
	let historyResolved = $state(false);
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
	let accountAlreadyCreated = $state(false);

	// Conditions of Participation: no gating popup — the landing page states
	// "By signing up, you agree…" with a link to /pilots/dams-terms, and per the
	// terms themselves, signing up / connecting constitutes acceptance.

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
	// The welcome offer shows while the account has never redeemed — an on-chain
	// fact (dAMS transfer history), so it follows the account across devices and
	// logins. The offersPending loader keeps a stale local cache from flashing it
	// for someone who already redeemed elsewhere.
	const welcomeStage = $derived(firstPurchase);
	// The 48-dAMS welcome offer must not flash for someone who already redeemed
	// elsewhere — hold the offer areas behind a loader until the on-chain history
	// confirms (only needed when the welcome offer would show).
	const offersPending = $derived(welcomeStage && !historyResolved);
	// Past the welcome stage there are two offers to pick from (1€/100 and
	// 2€/200); the index selects which one the Redeem button acts on.
	let selectedOfferIdx = $state(0);
	const offers = $derived<Offer[]>(
		selectedShop
			? offersFor(selectedShop)
			: welcomeStage
				? [SIGNUP_OFFER]
				: [DEFAULT_OFFER, SECOND_OFFER]
	);
	const offer = $derived<Offer>(offers[Math.min(selectedOfferIdx, offers.length - 1)]);
	// Balance comes straight from chain — never synthesized. It counts held dAMS
	// + mintable issuance (deliverableWholeDams) plus the user's own personal CRC
	// as far as the pathfinder can route it into the group (fromTokens-restricted
	// — this is where the 48-CRC signup bonus lives).
	//
	// Two corrections on the pathfinder number:
	// - CLAMP by the personal CRC actually still held (fresh 3.5s read): the
	//   pathfinder graph lags the chain, so right after a spend it still reports
	//   the old routable amount — without the clamp the main page kept showing
	//   the pre-purchase balance.
	// - Tolerate the ~1e-6 the pathfinder shaves off (demurrage projection: an
	//   exact 48 reads as 47.999952) before flooring, so the signup bonus shows
	//   as 48. Eligibility uses the same tolerant number; at redeem the dust the
	//   pathfinder can't route (≤0.01 dAMS) is shaved off the transfer.
	const personalWhole = $derived(userState ? Math.floor(Number(userState.personalCrc) / 1e18) : 0);
	const convertibleShown = $derived(Math.min(Math.floor(convertibleRaw * 1.0005), personalWhole));
	const availableWhole = $derived(
		(userState ? deliverableWholeDams(userState) : 0) + convertibleShown
	);
	const nextMint = $derived(mintCountdown(now));
	// The Hub caps unclaimed issuance at two weeks (MAX_CLAIM_DURATION; the
	// demurraged ceiling is ≈335.5 CRC). At the ceiling the balance stops
	// growing — each new hour just pushes the oldest one out of the claim
	// window — so warn instead of showing an hourly countdown that won't land.
	// Redeeming always mints (personalMint is part of the claim batch), which
	// restarts the clock.
	const MINT_CAP_WARN_DAMS = 335;
	const mintCapped = $derived(
		userState ? Math.floor(Number(userState.mintable) / 1e18) >= MINT_CAP_WARN_DAMS : false
	);
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

	function offersFor(shop: Address): Offer[] {
		// Two-stage: welcome stage → 48-dAMS signup offer, then the shop's follow-up
		// offers. A ?amount= override collapses the list to one custom-amount offer.
		const base = activeOffers(resolveShop(shop), welcomeStage);
		return amountOverride ? [{ ...base[0], amountDams: amountOverride }] : base;
	}

	function isEnoughDeliver(s: UserState, shop: Address, amountDams: number): boolean {
		const amountWei = BigInt(amountDams) * ONE;
		// Tolerant capacity, matching the displayed balance — never say "Almost
		// there" while the ball shows enough. The dust the pathfinder can't route
		// (≤ DUST_WEI) is shaved off the transfer at redeem instead of failing.
		const extraWei = BigInt(convertibleShown) * ONE;
		return buildClaimTxs(shop, s, shop, amountWei).deliverableErc20 + extraWei >= amountWei;
	}

	// After a spend, re-read state + pathfinder until the displayed balance
	// reflects it — an immediate read often still sees pre-transaction values.
	// Runs detached so the redeem button frees up as soon as the tx is done.
	async function pollBalanceAfterSpend(a: Address) {
		const before = availableWhole;
		for (let i = 0; i < 6; i++) {
			if (connectedAddress !== a) return; // account changed meanwhile
			await loadState(a);
			await refreshConvertible(a);
			if (availableWhole !== before) break;
			await new Promise((r) => setTimeout(r, 2500));
		}
	}

	// Refresh how much of the user's own personal CRC the pathfinder can route
	// into dAMS (raw — the deriveds above clamp and round it). Failures read as
	// 0 (balance degrades to held + mintable).
	async function refreshConvertible(a: Address) {
		try {
			convertibleRaw = Number(await maxConvertibleToDams(a)) / 1e18;
		} catch {
			convertibleRaw = 0;
		}
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
			// Group must trust the user before their 48-CRC bonus counts as dAMS.
			await waitForMembership(a);
			await loadState(a);
			// The account effect fetched the convertible amount before the group
			// trusted the user (it read 0) — re-read now so the 48-CRC bonus shows.
			// No collect prompt: the bonus simply appears in the balance, and it's
			// converted inside the redeem batch when an offer is used.
			await refreshConvertible(a);
			// Registration succeeded — invite them to install the app.
			offerInstall();
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
			let payWei = amountWei;
			let plan = buildClaimTxs(a, s, shop, payWei);
			let boostTxs: typeof plan.txs = [];
			if (plan.deliverableErc20 < payWei) {
				// Held dAMS + fresh issuance don't cover the offer — route the shortfall
				// from the user's own personal CRC via the pathfinder (this is how the
				// 48-CRC signup bonus pays for the welcome offer). The pathfinder txs run
				// first and deliver demurraged ERC20, so the claim batch is re-planned as
				// if that ERC20 were already held.
				let shortfallWei = payWei - plan.deliverableErc20;
				// The pathfinder routes a hair less than the nominal bonus (demurrage:
				// 48 reads as 47.9999… on day 0, 47.99… after a day). Neglect that dust:
				// cap the request at what's actually routable and shave the difference
				// off the transfer, rather than failing the whole redemption.
				const DUST_WEI = ONE / 100n; // 0.01 dAMS
				const routableWei = await maxConvertibleToDams(a);
				if (routableWei < shortfallWei && shortfallWei - routableWei <= DUST_WEI) {
					payWei -= shortfallWei - routableWei;
					shortfallWei = routableWei;
				}
				boostTxs = await buildBoostTxs(a, shortfallWei);
				plan = buildClaimTxs(
					a,
					{ ...s, damsDemurraged: s.damsDemurraged + shortfallWei },
					shop,
					payWei
				);
			}
			const hash = await wallet.sendTransactions([...boostTxs, ...plan.txs]);
			const data: ReceiptData = {
				amount,
				shop,
				shopName: resolveShop(shop).name,
				// `welcomeStage` is still true here — orders flip it after addOrder below.
				offerLabel: welcomeStage ? 'Welcome offer' : 'Follow-up offer',
				txHash: String(hash),
				at: Date.now()
			};
			receipt = data;
			showReceipt = true;
			// Append to order history and advance out of the first-purchase stage, so
			// the offer flips from the 48-dAMS signup deal to the 100-dAMS follow-up.
			orders = addOrder(a, data);
			firstPurchase = isFirstPurchase(a);
			// Reload the balance until the redemption is reflected (RPC/indexer
			// lag) — in the background: awaiting it here kept `claiming` true, so
			// the button read "Sending…" for seconds after the receipt was up.
			pollBalanceAfterSpend(a);
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
		historyResolved = false;
		showHistory = false;
		convertibleRaw = 0;
	}

	// ----- Change name -----
	function openNameEdit() {
		menuOpen = false;
		nameDraft = wallet.avatarName || '';
		nameError = '';
		showNameEdit = true;
	}

	async function saveName() {
		const next = nameDraft.trim();
		if (!next || nameSaving) return;
		nameError = '';
		nameSaving = true;
		try {
			// Pin the new profile, then update the NameRegistry digest from the Safe.
			const tx = await buildUpdateNameTx(next);
			await wallet.sendTransactions([tx]);
			// The indexer lags the chain by a moment — poll until the new name lands.
			for (let i = 0; i < 6; i++) {
				await wallet.refreshAvatarProfile();
				if (wallet.avatarName === next) break;
				await new Promise((r) => setTimeout(r, 2000));
			}
			showNameEdit = false;
		} catch (e: any) {
			const m = e?.message ?? 'Could not update your name.';
			nameError = /reject|cancel|denied|rejected/i.test(m) ? 'Cancelled.' : m;
		} finally {
			nameSaving = false;
		}
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
		// The pilot's own manifest link is prerendered by the root layout (a JS
		// swap here came too late for install-time evaluation and pinned the
		// Miniapps manifest to the shortcut). Only the chrome colour is set here.
		try {
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
			// Silent session restore — a Safe is already saved locally.
			wallet.autoConnect();
		} else if (accountAlreadyCreated) {
			// Known returning user (URL/flag says registered) but no saved Safe on this
			// device — prompt the passkey to log them in rather than let them create a
			// second account. handleLogin() surfaces any error and loads their state.
			handleLogin();
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
		// Keep the displayed balance fresh: re-read the on-chain state every few
		// seconds while signed in (a handful of cheap eth_calls; the heavier
		// pathfinder amount refreshes on events — connect, membership, spends).
		const refresh = setInterval(() => {
			if (wallet.connected && wallet.address) {
				const a = getAddress(wallet.address) as Address;
				loadState(a).then((s) => {
					// The pathfinder graph lags the chain by blocks: right after signup
					// the one-shot refresh can run before it sees the fresh group trust,
					// reading 0 routable for an account that holds its 48-CRC bonus —
					// the balance then showed 0. Re-ask until it catches up.
					if (s.isMember && s.personalCrc >= ONE && convertibleRaw === 0) {
						refreshConvertible(a);
					}
				});
			}
		}, 3_500);
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
			historyResolved = false;
			// Rehydrate this account's history + offer stage from local storage for an
			// instant render; the on-chain read below corrects it.
			orders = readOrders(a);
			firstPurchase = orders.length === 0;
			receipt = orders[0] ?? null;
			// The durable truth is on-chain: dAMS transfers to shop addresses. This
			// survives new devices and cleared storage, and recognizes redemptions
			// made before local history existed — so the welcome offer can't be
			// claimed twice just because localStorage is fresh.
			fetchShopPayments(
				a,
				SHOPS.map((s) => s.address)
			)
				.then((pays) => {
					if (loadedFor !== a) return; // account changed while fetching
					const chainOrders: Order[] = pays.map((p) => ({
						amount: Math.round(Number(p.amountWei) / 1e18),
						shop: p.shop,
						shopName: resolveShop(p.shop).name,
						offerLabel:
							Math.round(Number(p.amountWei) / 1e18) === SIGNUP_OFFER.amountDams
								? 'Welcome offer'
								: 'Follow-up offer',
						txHash: p.txHash,
						at: p.at
					}));
					orders = mergeOrders(readOrders(a), chainOrders);
					writeOrders(a, orders);
					firstPurchase = orders.length === 0;
					historyResolved = true;
				})
				.catch(() => {
					// RPC down/offline — the local cache keeps working; stop holding
					// the offer areas behind the loader.
					if (loadedFor === a) historyResolved = true;
				});
			loadState(a).then((s) => {
				if (!s.isMember)
					ensureMembership(a).then(() => {
						loadState(a);
						// Group trust just landed — the pathfinder amount read before it
						// was 0; personal CRC only routes once the group trusts the user.
						refreshConvertible(a);
					});
			});
			refreshConvertible(a);
		}
	});

	// Resolve the selected shop's display name (config first, then profile).
	$effect(() => {
		const shop = selectedShop;
		// Entering (or leaving) a shop always starts back at the first offer.
		selectedOfferIdx = 0;
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
									<p class="shop-offer">{SIGNUP_OFFER.discountEuro}€ off on signup</p>
									<p class="shop-offer">
										{s.offer.discountEuro}€ off for {s.offer.amountDams} dAMS or {SECOND_OFFER.discountEuro}€
										off for {SECOND_OFFER.amountDams} dAMS
									</p>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<div class="actions">
					{#if accountAlreadyCreated}
						<!-- Already registered (local flag or ?registered=1 in the URL) —
						     log in with the passkey instead of creating a second account. -->
						<button class="btn-primary stacked" onclick={handleLogin}>
							<span>{wallet.connecting ? 'Connecting…' : 'Log in'}</span>
							<span class="sub">welcome back</span>
						</button>
					{:else}
						<button class="btn-primary stacked" onclick={handleSignup}>
							<span>Join the community</span>
							<span class="sub">no email required</span>
						</button>
						<button class="btn-text" onclick={handleLogin}>
							{wallet.connecting ? 'Connecting…' : 'I already have an account'}
						</button>
					{/if}
				</div>

				<p class="legal-link">
					By signing up, you agree to the
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
				{#if offersPending}
					<!-- Don't flash a possibly-outdated welcome offer while the on-chain
					     history check is still running. -->
					<div class="offers-loading">
						<div class="spinner"></div>
						<p class="muted small">Checking your offers…</p>
					</div>
				{:else if offers.length > 1}
					<!-- Follow-up stage: two offers to pick from — tap a card to select. -->
					<div class="offer-select" role="radiogroup" aria-label="Choose an offer">
						{#each offers as o, i (o.amountDams)}
							<button
								class="card offer selectable"
								class:selected={i === selectedOfferIdx}
								role="radio"
								aria-checked={i === selectedOfferIdx}
								onclick={() => (selectedOfferIdx = i)}
							>
								<p class="offer-big">{o.discountEuro}€ off</p>
								<p class="offer-sub">
									for <strong>{o.amountDams} dAMS</strong>
									{#if o.minPurchaseEuro > 0}
										when purchasing above {o.minPurchaseEuro}€
									{:else}
										on any purchase
									{/if}
								</p>
							</button>
						{/each}
					</div>
				{:else}
					<div class="card offer">
						{#if welcomeStage}
							<span class="offer-badge">Welcome offer</span>
						{/if}
						<p class="offer-big">{offer.discountEuro}€ off</p>
						<p class="offer-sub">
							for <strong>{offer.amountDams} dAMS</strong>
							{#if welcomeStage}
								on your first purchase
							{:else if offer.minPurchaseEuro > 0}
								when purchasing above {offer.minPurchaseEuro}€
							{:else}
								on any purchase
							{/if}
						</p>
					</div>
				{/if}

				{#if !offersPending}
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
				{/if}
			</section>

			<!-- Home -->
		{:else}
			<section class="screen">
				<!-- The balance ball: display only, not interactive. -->
				<div class="coin coin-lg" role="img" aria-label="Your dAMS balance: {availableWhole}">
					<div class="coin-num">
						<span class="num big">{availableWhole}</span>
						<span class="unit">Your dAMS</span>
					</div>
				</div>

				{#if mintCapped}
					<!-- Unclaimed issuance is at the two-week ceiling — the hourly countdown
					     would promise a dAMS that never lands, so show the stall warning
					     instead. Redeeming mints (personalMint is always in the batch),
					     which restarts the clock. -->
					<div class="cap-warning" role="status">
						<span aria-hidden="true">⚠️</span>
						<span>
							Your dAMS stopped accumulating — you haven't redeemed for over two weeks. Redeem an
							offer to restart the clock.
						</span>
					</div>
				{:else}
					<div class="countdown">
						<div class="countdown-row">
							<span aria-hidden="true">⏳</span>
							<span>Next dAMS in <strong>{nextMint.label}</strong></span>
						</div>
						<div class="meter"><div class="meter-fill" style="width:{nextMint.progressPct}%"></div></div>
					</div>
					<p class="cap-note">
						dAMS stop accumulating after two weeks without redeeming — use them on offers.
					</p>
				{/if}

				<div class="block">
					<h2 class="eyebrow">Available offers</h2>
					{#if offersPending}
						<!-- Don't flash a possibly-outdated offer while the on-chain history
						     check is still running. -->
						<div class="offers-loading">
							<div class="spinner"></div>
							<p class="muted small">Checking your offers…</p>
						</div>
					{:else}
						<!-- One line per shop, matching the offer that's actually active:
						     the welcome offer while unused, else the headline follow-up.
						     The full choice opens on the shop screen. -->
						<ul class="shop-list">
							{#each SHOPS as s (s.address)}
								<li>
									<button class="shop-row" onclick={() => (selectedShop = s.address)}>
										<span>
											<span class="shop-name">{s.name}</span>
											{#if welcomeStage}
												<span class="shop-offer">{SIGNUP_OFFER.discountEuro}€ off on signup</span>
											{:else}
												<span class="shop-offer">
													{s.offer.discountEuro}€ off for {s.offer.amountDams} dAMS or {SECOND_OFFER.discountEuro}€
													off for {SECOND_OFFER.amountDams} dAMS
												</span>
											{/if}
										</span>
										<span class="chev" aria-hidden="true">›</span>
									</button>
								</li>
							{/each}
						</ul>
					{/if}
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
				</div>
				<p class="muted small">Show this to the cashier to claim your discount.</p>
			</div>
			<button class="btn-secondary receipt-done" onclick={closeReceipt}>Done</button>
		</div>
	{/if}

	<!-- Account menu -->
	{#if menuOpen}
		<button class="menu-backdrop" aria-label="Close" onclick={() => (menuOpen = false)}></button>
		<div class="menu">
			<p class="menu-name">{wallet.avatarName || 'Your account'}</p>
			{#if connectedAddress}<p class="menu-addr">{shortAddress(connectedAddress)}</p>{/if}
			<button class="btn-secondary wide" onclick={openNameEdit}>Change name</button>
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

	<!-- Change name -->
	{#if showNameEdit}
		<button class="sheet-backdrop" aria-label="Close" onclick={() => (showNameEdit = false)}
		></button>
		<div class="sheet" role="dialog" aria-modal="true">
			<div class="grab"></div>
			<h2 class="sheet-title">Change your name</h2>
			<p class="muted small">Shown to other participants. Names aren't unique.</p>
			<input
				class="name-input"
				type="text"
				maxlength="48"
				bind:value={nameDraft}
				disabled={nameSaving}
				placeholder="Your name"
				aria-label="New name"
			/>
			{#if nameError}<p class="error">{nameError}</p>{/if}
			{#if nameSaving}
				<div class="name-saving">
					<div class="spinner"></div>
					<p class="muted small">Saving… confirm with your device when prompted.</p>
				</div>
			{:else}
				<button class="btn-primary" disabled={!nameDraft.trim()} onclick={saveName}>Save</button>
				<button class="btn-text" onclick={() => (showNameEdit = false)}>Cancel</button>
			{/if}
		</div>
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
		display: flex;
		align-items: center;
		justify-content: center;
		/* iOS Safari applies default button padding asymmetrically, nudging the
		   icon off-centre — zero it and let flex do the centering. */
		padding: 0;
		width: 36px;
		height: 36px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.15);
		background: transparent;
		color: rgba(255, 255, 255, 0.85);
		cursor: pointer;
	}
	.iconbtn svg {
		display: block;
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
		display: block;
		margin: 2px 0 0;
		font-size: 0.88rem;
		color: #76cd9c;
	}
	/* The offer line must wrap inside the card — nowrap overflowed it on
	   narrow phones ("2€ off for 48 dAMS on your first purchase"). */
	.shop-card .shop-offer {
		white-space: normal;
		overflow-wrap: anywhere;
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

	/* Follow-up stage: the two offers stack as full-width rows, tap to pick one. */
	.offer-select {
		display: grid;
		grid-template-columns: 1fr;
		gap: 12px;
		width: 100%;
		margin-top: 18px;
	}
	.offer.selectable {
		margin-top: 0;
		padding: 18px 12px;
		color: inherit;
		font: inherit;
		cursor: pointer;
		opacity: 0.75;
		transition:
			opacity 0.15s ease,
			border-color 0.15s ease;
	}
	.offer.selectable .offer-big {
		font-size: 1.6rem;
	}
	.offer.selectable .offer-sub {
		font-size: 0.88rem;
	}
	.offer.selectable.selected {
		opacity: 1;
		border-color: #76cd9c;
		box-shadow: 0 0 0 1px #76cd9c inset;
	}

	/* Countdown */
	.countdown {
		width: 176px;
		margin-top: 18px;
	}
	/* Two-week accrual notices */
	.cap-note {
		margin: 10px 0 0;
		max-width: 300px;
		text-align: center;
		font-size: 0.78rem;
		line-height: 1.4;
		color: rgba(255, 255, 255, 0.5);
	}
	.cap-warning {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin-top: 18px;
		max-width: 320px;
		padding: 12px 16px;
		border-radius: 16px;
		background: rgba(246, 97, 30, 0.14);
		border: 1px solid rgba(246, 97, 30, 0.5);
		font-size: 0.88rem;
		line-height: 1.45;
		color: rgba(255, 255, 255, 0.92);
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
	/* Contained, centered — not a full-width bar. */
	.receipt-done {
		align-self: center;
		min-width: 180px;
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
		/* Stay inside the app column (max-width 460px, centered) instead of
		   hugging the viewport's right edge on wide screens. */
		right: max(22px, calc((100vw - 460px) / 2 + 22px));
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
	.sheet-title {
		font-family: 'Poppins', sans-serif;
		font-size: 1.3rem;
		font-weight: 600;
		margin: 0 0 4px;
	}
	/* Offer areas while the on-chain history check runs */
	.offers-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 26px 0;
	}

	/* Change-name sheet */
	.name-input {
		width: 100%;
		margin: 12px 0 14px;
		padding: 14px 16px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
		font: inherit;
		font-size: 1.05rem;
	}
	.name-input:focus {
		outline: none;
		border-color: #76cd9c;
	}
	.name-input::placeholder {
		color: rgba(255, 255, 255, 0.4);
	}
	.name-saving {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 12px 0 6px;
	}

	/* Conditions of Participation links */
	.legal-link {
		margin: 18px 0 0;
		text-align: center;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.55);
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
	.sheet .btn-primary {
		margin-top: 6px;
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
