<script lang="ts">
	/**
	 * Coffee Loyalty — Circles miniapp embedded route.
	 *
	 * Lives at /apps/coffee-loyalty; loaded inside an iframe by the host page
	 * /miniapps/coffee-loyalty. Customers scan the shop's daily QR, sign in, and
	 * collect stamps; the 10th earns a free-coffee NFT. Signing in also adds them to
	 * the shop's Circles group (the backend's group-Safe signer calls Hub.trust).
	 *
	 * Pure logic (challenge strings, QR payload, stamp math) lives in ./loyalty.ts
	 * and is unit-tested in ./loyalty.test.ts. On-chain trust + NFT mint happen in
	 * the loyalty-backend; this UI only signs messages and calls that backend.
	 */
	import { onMount } from 'svelte';
	import { onWalletChange, onAppData, signMessage, isMiniappMode } from '@aboutcircles/miniapp-sdk';
	import QRCode from 'qrcode';
	import { getAddress, type Address } from 'viem';
	import {
		stampChallenge,
		ownerChallenge,
		redeemChallenge,
		decodeAppData,
		buildQrUrl,
		stampsRemaining,
		filledStamps,
		unredeemedCount,
		todayUtc,
		type QrPayload
	} from './loyalty';

	// Backend base URL — override at build time with VITE_LOYALTY_API.
	const LOYALTY_API =
		(import.meta.env.VITE_LOYALTY_API as string | undefined) ??
		'https://coffee-loyalty-backend.ondigitalocean.app';

	type ShopConfig = { owner: Address; group: Address; nft: Address; stampsPerReward: number };
	type Reward = { tokenId: string; mintedAt: string; txHash: string; redeemed: boolean };
	type CustomerState = { stamps: number; rewards: Reward[]; isMember: boolean };
	type OwnerCustomer = { address: Address; stamps: number; rewards: Reward[] };

	type View = 'loading' | 'customer' | 'owner' | 'error';

	let view = $state<View>('loading');
	let errorMessage = $state('');
	let connectedAddress = $state<Address | null>(null);
	let config = $state<ShopConfig | null>(null);
	let scanned = $state<QrPayload | null>(null);

	// Customer state
	let customer = $state<CustomerState | null>(null);
	let collecting = $state(false);
	let collectResult = $state<{ kind: 'joined' | 'stamped' | 'reward' | 'already'; message: string } | null>(null);

	// Owner state
	let ownerUnlocked = $state(false);
	let ownerBusy = $state(false);
	let ownerSecret = $state<string>('');
	let qrDataUrl = $state<string>('');
	let ownerCustomers = $state<OwnerCustomer[]>([]);
	let redeemingToken = $state<string | null>(null);

	let toast = $state<{ message: string; type: 'info' | 'success' | 'error' } | null>(null);
	function flash(message: string, type: 'info' | 'success' | 'error' = 'info') {
		toast = { message, type };
		setTimeout(() => (toast = null), 4000);
	}

	const isOwner = $derived(
		!!connectedAddress && !!config && getAddress(connectedAddress) === getAddress(config.owner)
	);

	// ─── Lifecycle ──────────────────────────────────────────────
	onMount(() => {
		onAppData((raw) => {
			const payload = decodeAppData(raw);
			if (payload) scanned = payload;
		});
		const unsub = onWalletChange((addr) => {
			connectedAddress = addr ? getAddress(addr) : null;
			void refresh();
		});
		void loadConfig();
		return unsub;
	});

	async function loadConfig() {
		try {
			const res = await fetch(`${LOYALTY_API}/config`);
			if (!res.ok) throw new Error(`config ${res.status}`);
			config = await res.json();
			await refresh();
		} catch (err) {
			errorMessage = 'Could not reach the loyalty service. Please try again later.';
			view = 'error';
		}
	}

	async function refresh() {
		if (!config) return;
		if (!connectedAddress) {
			view = isMiniappMode() ? 'loading' : 'customer';
			return;
		}
		if (isOwner) {
			view = 'owner';
		} else {
			await loadCustomer();
			view = 'customer';
		}
	}

	// ─── Customer ───────────────────────────────────────────────
	async function loadCustomer() {
		if (!connectedAddress) return;
		try {
			const res = await fetch(`${LOYALTY_API}/customer/${connectedAddress}`);
			if (!res.ok) throw new Error(`customer ${res.status}`);
			const data = await res.json();
			customer = { stamps: data.stamps, rewards: data.rewards, isMember: data.isMember };
		} catch {
			customer = { stamps: 0, rewards: [], isMember: false };
		}
	}

	async function collectStamp() {
		if (!config || !connectedAddress || !scanned) return;
		if (getAddress(scanned.shop) !== getAddress(config.group)) {
			flash('This QR code is for a different shop.', 'error');
			return;
		}
		collecting = true;
		collectResult = null;
		try {
			const message = stampChallenge(config.group, scanned.secret);
			const { signature } = await signMessage(message);
			const res = await fetch(`${LOYALTY_API}/stamp`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ address: connectedAddress, secret: scanned.secret, signature })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? `stamp ${res.status}`);

			await loadCustomer();
			scanned = null; // consume the QR so it can't be re-submitted

			if (data.alreadyStampedToday) {
				collectResult = { kind: 'already', message: 'You already collected your stamp today. See you tomorrow!' };
			} else if (data.reward) {
				collectResult = { kind: 'reward', message: 'Free coffee unlocked! Show your reward to the barista. ☕' };
			} else if (data.justJoined) {
				collectResult = { kind: 'joined', message: "You're in the coffee club — first stamp collected!" };
			} else {
				collectResult = { kind: 'stamped', message: 'Stamp collected!' };
			}
		} catch (err) {
			flash(err instanceof Error ? err.message : 'Could not collect your stamp.', 'error');
		} finally {
			collecting = false;
		}
	}

	// ─── Owner ──────────────────────────────────────────────────
	async function unlockDashboard() {
		if (!config || !connectedAddress) return;
		ownerBusy = true;
		try {
			const message = ownerChallenge(config.group, todayUtc());
			const { signature } = await signMessage(message);
			const res = await fetch(`${LOYALTY_API}/owner/dashboard`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ signature })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? `dashboard ${res.status}`);
			ownerSecret = data.secret;
			ownerCustomers = data.customers;
			qrDataUrl = await QRCode.toDataURL(buildQrUrl(config.group, data.secret), {
				width: 260,
				margin: 2
			});
			ownerUnlocked = true;
		} catch (err) {
			flash(err instanceof Error ? err.message : 'Could not unlock the dashboard.', 'error');
		} finally {
			ownerBusy = false;
		}
	}

	async function redeem(target: OwnerCustomer, reward: Reward) {
		if (!connectedAddress) return;
		redeemingToken = reward.tokenId;
		try {
			const message = redeemChallenge(target.address, reward.tokenId);
			const { signature } = await signMessage(message);
			const res = await fetch(`${LOYALTY_API}/redeem`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ customer: target.address, tokenId: reward.tokenId, signature })
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? `redeem ${res.status}`);
			reward.redeemed = true;
			ownerCustomers = [...ownerCustomers];
			flash('Free coffee redeemed.', 'success');
		} catch (err) {
			flash(err instanceof Error ? err.message : 'Could not redeem.', 'error');
		} finally {
			redeemingToken = null;
		}
	}

	function shortAddr(a: string): string {
		return `${a.slice(0, 6)}…${a.slice(-4)}`;
	}

	const perReward = $derived(config?.stampsPerReward ?? 10);
</script>

<svelte:head>
	<title>Coffee Loyalty</title>
</svelte:head>

<main>
	<header class="app-head">
		<span class="cup" aria-hidden="true">☕</span>
		<h1>Coffee Loyalty</h1>
	</header>

	{#if view === 'loading'}
		<div class="card center">
			<div class="spinner"></div>
			<p class="muted">Loading…</p>
			{#if !isMiniappMode()}
				<p class="muted small">Open this app inside the Gnosis wallet to collect stamps.</p>
			{/if}
		</div>
	{:else if view === 'error'}
		<div class="card center">
			<p class="error-heading">Something went wrong</p>
			<p class="muted">{errorMessage}</p>
			<button class="btn" onclick={() => loadConfig()}>Try again</button>
		</div>
	{:else if view === 'customer'}
		{#if !connectedAddress}
			<div class="card center">
				<p class="muted">Connect your Circles wallet to see your stamp card.</p>
			</div>
		{:else if customer}
			<!-- Stamp card -->
			<div class="card">
				<div class="card-top">
					<span class="muted small">Your stamp card</span>
					{#if customer.isMember}<span class="pill ok">Club member</span>{/if}
				</div>
				<div class="stamp-grid">
					{#each Array(perReward) as _, i}
						<span class="stamp" class:filled={i < filledStamps(customer.stamps, perReward)}>
							{#if i < filledStamps(customer.stamps, perReward)}☕{/if}
						</span>
					{/each}
				</div>
				<p class="remaining">
					{#if stampsRemaining(customer.stamps, perReward) === 0 && customer.stamps > 0}
						<strong>Card full — free coffee ready!</strong>
					{:else}
						<strong>{stampsRemaining(customer.stamps, perReward)}</strong> more until a free coffee
					{/if}
				</p>
			</div>

			{#if scanned}
				<button class="btn big" onclick={collectStamp} disabled={collecting}>
					{collecting ? 'Signing…' : 'Sign in & collect stamp'}
				</button>
			{:else}
				<p class="muted center small">Scan the shop's QR code to collect today's stamp.</p>
			{/if}

			{#if collectResult}
				<div class="card result {collectResult.kind === 'reward' ? 'reward' : ''}">
					<p>{collectResult.message}</p>
				</div>
			{/if}

			{#if unredeemedCount(customer.rewards) > 0}
				<div class="card">
					<span class="muted small">Free coffees to claim</span>
					<div class="rewards">
						{#each customer.rewards.filter((r) => !r.redeemed) as r}
							<div class="reward-chip">☕ Free coffee #{r.tokenId}</div>
						{/each}
					</div>
					<p class="muted small">Show this to the barista to redeem.</p>
				</div>
			{/if}
		{/if}
	{:else if view === 'owner'}
		<div class="card">
			<span class="muted small">Store owner</span>
			{#if !ownerUnlocked}
				<p class="muted">Unlock today's QR code and your customer list.</p>
				<button class="btn" onclick={unlockDashboard} disabled={ownerBusy}>
					{ownerBusy ? 'Signing…' : 'Unlock dashboard'}
				</button>
			{:else}
				<h2 class="sub">Today's QR code</h2>
				<p class="muted small">Display this at the till. It rotates daily.</p>
				{#if qrDataUrl}<img class="qr" src={qrDataUrl} alt="Today's loyalty QR code" />{/if}
				<code class="secret">secret: {ownerSecret}</code>
			{/if}
		</div>

		{#if ownerUnlocked}
			<div class="card">
				<span class="muted small">Customers ({ownerCustomers.length})</span>
				{#if ownerCustomers.length === 0}
					<p class="muted">No stamps collected yet.</p>
				{:else}
					<ul class="cust-list">
						{#each ownerCustomers as cust}
							<li>
								<div class="cust-row">
									<span class="mono">{shortAddr(cust.address)}</span>
									<span class="pill">{cust.stamps}/{perReward}</span>
								</div>
								{#each cust.rewards.filter((r) => !r.redeemed) as r}
									<div class="cust-reward">
										<span>☕ Free coffee #{r.tokenId}</span>
										<button class="btn small" onclick={() => redeem(cust, r)} disabled={redeemingToken === r.tokenId}>
											{redeemingToken === r.tokenId ? '…' : 'Redeem'}
										</button>
									</div>
								{/each}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/if}

	{#if toast}
		<div class="toast {toast.type}">{toast.message}</div>
	{/if}
</main>

<style>
	main {
		max-width: 460px;
		margin: 0 auto;
		padding: 20px 16px 48px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.app-head {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 4px;
	}
	.app-head h1 {
		font-size: 22px;
		margin: 0;
		color: var(--ink);
	}
	.cup {
		font-size: 26px;
	}

	.card {
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.card.center {
		align-items: center;
		text-align: center;
	}
	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.muted {
		color: var(--muted);
		margin: 0;
	}
	.small {
		font-size: 13px;
	}
	.center {
		text-align: center;
	}

	.stamp-grid {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 10px;
	}
	.stamp {
		aspect-ratio: 1;
		border: 2px dashed var(--line);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		color: var(--muted);
		background: var(--bg-a);
	}
	.stamp.filled {
		border-style: solid;
		border-color: var(--accent-mid);
		background: var(--accent-soft);
	}

	.remaining {
		text-align: center;
		margin: 0;
		color: var(--ink);
		font-size: 15px;
	}

	.btn {
		background: linear-gradient(130deg, var(--accent), var(--accent-mid));
		color: #fff;
		border: none;
		padding: 12px 24px;
		border-radius: var(--radius-pill);
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}
	.btn:hover {
		opacity: 0.88;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.btn.big {
		padding: 16px;
		font-size: 16px;
	}
	.btn.small {
		padding: 7px 14px;
		font-size: 13px;
	}

	.result {
		background: var(--success-bg);
		border-color: transparent;
	}
	.result p {
		margin: 0;
		color: var(--success-ink);
		font-weight: 600;
		text-align: center;
	}
	.result.reward {
		background: var(--warn-bg);
	}
	.result.reward p {
		color: var(--warn-ink);
	}

	.pill {
		background: var(--accent-soft);
		color: var(--accent);
		border-radius: var(--radius-pill);
		padding: 3px 10px;
		font-size: 12px;
		font-weight: 600;
	}
	.pill.ok {
		background: var(--success-bg);
		color: var(--success-ink);
	}

	.rewards {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.reward-chip {
		background: var(--warn-bg);
		color: var(--warn-ink);
		border-radius: var(--radius-sm);
		padding: 8px 12px;
		font-weight: 600;
		font-size: 14px;
	}

	.sub {
		font-size: 16px;
		margin: 0;
		color: var(--ink);
	}
	.qr {
		align-self: center;
		border-radius: var(--radius-sm);
		border: 1px solid var(--line);
	}
	.secret {
		font-size: 12px;
		color: var(--muted);
		word-break: break-all;
		background: var(--bg-b);
		padding: 6px 10px;
		border-radius: var(--radius-sm);
	}

	.cust-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.cust-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.mono {
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		color: var(--ink);
	}
	.cust-reward {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 8px;
		font-size: 14px;
		color: var(--warn-ink);
	}

	.error-heading {
		font-weight: 600;
		color: var(--ink);
		margin: 0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--line);
		border-top-color: var(--accent-mid);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.toast {
		position: fixed;
		left: 50%;
		bottom: 24px;
		transform: translateX(-50%);
		padding: 12px 18px;
		border-radius: var(--radius-pill);
		font-size: 14px;
		font-weight: 600;
		box-shadow: var(--shadow-popup);
		z-index: 10;
	}
	.toast.info {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.toast.success {
		background: var(--success-bg);
		color: var(--success-ink);
	}
	.toast.error {
		background: var(--error-bg);
		color: var(--error-ink);
	}
</style>
