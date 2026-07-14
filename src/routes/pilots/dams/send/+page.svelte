<script lang="ts">
	/**
	 * Send dAMS to the org — unlisted transfer page (URL-only for now, no link
	 * in the app menu; to be rolled out later).
	 *
	 * Transfers travel as GROUP ERC1155 via the Hub, NOT as the dAMS ERC20 that
	 * offer redemptions use — the redemption history and the first-purchase
	 * stage are derived from ERC20 Transfer logs, so sends stay invisible to
	 * them by construction.
	 */
	import { onMount } from 'svelte';
	import { getAddress, type Address } from 'viem';
	import { wallet } from '$lib/wallet.svelte';
	import {
		readUserState,
		deliverableWholeDams,
		buildSendGatherTxs,
		transferGroup1155Tx,
		shortAddress,
		ONE,
		type UserState
	} from '../circles';
	import { maxConvertibleToDams, buildBoostTxs } from '../boost';
	import { SHOPS } from '../shops';

	// The org receiving transfers — the pilot's configured shop.
	const ORG = SHOPS[0];

	let userState = $state<UserState | null>(null);
	let convertibleRaw = $state(0);
	let amountInput = $state('');
	let sending = $state(false);
	let sentAmount = $state(0);
	let errorMsg = $state('');

	const connectedAddress = $derived(
		wallet.connected && wallet.address ? (getAddress(wallet.address) as Address) : null
	);
	// Same balance formula as the main pilot page: held dAMS + mintable, plus
	// the user's own personal CRC as far as the pathfinder routes it (clamped by
	// what's actually held; display-tolerant of the pathfinder's ~1e-6 shave).
	const personalWhole = $derived(userState ? Math.floor(Number(userState.personalCrc) / 1e18) : 0);
	// Established accounts show their personal CRC from the chain even before
	// the pathfinder graph catches up (mirrors the main pilot page).
	const convertibleShown = $derived(
		userState?.isMember && userState.registered
			? personalWhole
			: Math.min(Math.floor(convertibleRaw * 1.0005), personalWhole)
	);
	const availableWhole = $derived(
		(userState ? deliverableWholeDams(userState) : 0) + convertibleShown
	);
	const amountWhole = $derived(Math.floor(Number(amountInput) || 0));
	const amountValid = $derived(amountWhole >= 1 && amountWhole <= availableWhole);

	let loadedFor = '';

	async function load(a: Address) {
		userState = await readUserState(a);
		try {
			convertibleRaw = Number(await maxConvertibleToDams(a)) / 1e18;
		} catch {
			convertibleRaw = 0;
		}
	}

	$effect(() => {
		const a = connectedAddress;
		if (a && a !== loadedFor) {
			loadedFor = a;
			load(a);
		}
	});

	onMount(() => {
		if (wallet.getSavedSafeAddress()) wallet.autoConnect();
		const refresh = setInterval(() => {
			if (connectedAddress && !sending) load(connectedAddress);
		}, 5_000);
		return () => clearInterval(refresh);
	});

	async function handleSend() {
		const a = connectedAddress;
		if (!a || !amountValid || sending || !userState) return;
		errorMsg = '';
		sending = true;
		try {
			const s = await readUserState(a);
			userState = s;
			let payWei = BigInt(amountWhole) * ONE;
			const gather = buildSendGatherTxs(a, s, payWei);
			let boostTxs: typeof gather.txs = [];
			if (gather.shortfallWei > 0n) {
				// Cover the rest from personal CRC via the pathfinder (own token
				// only). Neglect the dust it can't route (demurrage shave, ≤0.01):
				// shave it off the transfer instead of failing.
				let shortfall = gather.shortfallWei;
				const routable = await maxConvertibleToDams(a);
				const DUST_WEI = ONE / 100n;
				if (routable < shortfall && shortfall - routable <= DUST_WEI) {
					payWei -= shortfall - routable;
					shortfall = routable;
				}
				if (shortfall > routable) {
					throw new Error(`Not enough dAMS — you can send up to ${availableWhole}.`);
				}
				boostTxs = await buildBoostTxs(a, shortfall, { erc1155: true });
			}
			await wallet.sendTransactions([
				...gather.txs,
				...boostTxs,
				transferGroup1155Tx(a, ORG.address, payWei)
			]);
			sentAmount = amountWhole;
			amountInput = '';
			load(a);
		} catch (e: any) {
			const m = e?.message ?? 'Transfer failed.';
			errorMsg = /reject|cancel|denied|rejected/i.test(m) ? 'Transfer cancelled.' : m;
		} finally {
			sending = false;
		}
	}
</script>

<svelte:head>
	<title>Send dAMS — Circles Amsterdam</title>
	<meta name="robots" content="noindex" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link
		href="https://fonts.googleapis.com/css2?family=Archivo:wght@800;900&family=Inter:wght@400;600&family=Poppins:wght@500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="send-root">
	<div class="send-app">
		<header class="topbar">
			<a class="back" href="/pilots/dams" aria-label="Back to Circles Amsterdam">←</a>
			<span class="wordmark">Send <span class="accent">dAMS</span></span>
		</header>

		{#if !wallet.connected}
			<section class="center">
				<p class="muted">Log in to send dAMS to {ORG.name}.</p>
				<button class="btn-primary" onclick={() => wallet.connectAndPick()}>
					{wallet.connecting ? 'Connecting…' : 'Log in'}
				</button>
			</section>
		{:else if !userState}
			<section class="center">
				<div class="spinner"></div>
				<p class="muted">Reading your balance…</p>
			</section>
		{:else if sentAmount > 0}
			<section class="center">
				<div class="tick">✓</div>
				<h1 class="title">Sent</h1>
				<p class="muted">
					You sent <strong>{sentAmount} dAMS</strong> to {ORG.name}.
				</p>
				<button class="btn-secondary" onclick={() => (sentAmount = 0)}>Send more</button>
				<a class="textlink" href="/pilots/dams">Back to the app</a>
			</section>
		{:else}
			<section class="form">
				<p class="label">To</p>
				<div class="card recipient">
					<p class="name">{ORG.name}</p>
					<p class="addr">{shortAddress(ORG.address)}</p>
				</div>

				<p class="label">Amount</p>
				<div class="amount-row">
					<input
						class="amount-input"
						type="number"
						inputmode="numeric"
						min="1"
						max={availableWhole}
						placeholder="0"
						bind:value={amountInput}
						disabled={sending}
						aria-label="Amount of dAMS to send"
					/>
					<button
						class="btn-max"
						disabled={sending || availableWhole < 1}
						onclick={() => (amountInput = String(availableWhole))}>Max</button
					>
				</div>
				<p class="muted small">Available: {availableWhole} dAMS</p>

				{#if errorMsg}<p class="error">{errorMsg}</p>{/if}

				<button class="btn-primary" disabled={!amountValid || sending} onclick={handleSend}>
					{#if sending}
						Sending… confirm with your device
					{:else if amountWhole > 0}
						Send {amountWhole} dAMS
					{:else}
						Send
					{/if}
				</button>
			</section>
		{/if}
	</div>
</div>

<style>
	.send-root {
		min-height: 100vh;
		background: #2e1f8c;
		color: #fff;
		font-family: 'Inter', sans-serif;
	}
	.send-app {
		max-width: 460px;
		margin: 0 auto;
		padding: 18px 22px 48px;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 26px;
	}
	.back {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: rgba(255, 255, 255, 0.85);
		text-decoration: none;
		font-size: 1.1rem;
	}
	.wordmark {
		font-family: 'Poppins', sans-serif;
		font-weight: 700;
		font-size: 1.05rem;
	}
	.accent {
		color: #f6611e;
	}
	.center {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding-top: 60px;
		text-align: center;
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.label {
		font-family: 'Poppins', sans-serif;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgba(255, 255, 255, 0.55);
		margin: 14px 0 6px;
	}
	.card {
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.14);
		border-radius: 18px;
		padding: 14px 16px;
	}
	.recipient .name {
		font-family: 'Poppins', sans-serif;
		font-weight: 600;
		margin: 0;
	}
	.recipient .addr {
		margin: 2px 0 0;
		font-size: 0.85rem;
		color: rgba(255, 255, 255, 0.55);
	}
	.amount-row {
		display: flex;
		gap: 10px;
	}
	.amount-input {
		flex: 1;
		min-width: 0;
		padding: 14px 16px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
		font: inherit;
		font-size: 1.4rem;
		font-weight: 600;
	}
	.amount-input:focus {
		outline: none;
		border-color: #f6611e;
	}
	.btn-max {
		padding: 0 18px;
		border-radius: 14px;
		border: 1px solid rgba(255, 255, 255, 0.25);
		background: transparent;
		color: rgba(255, 255, 255, 0.85);
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-primary {
		margin-top: 18px;
		padding: 16px;
		border: none;
		border-radius: 999px;
		background: #f6611e;
		color: #fff;
		font-family: 'Poppins', sans-serif;
		font-size: 1.05rem;
		font-weight: 600;
		cursor: pointer;
	}
	.btn-primary:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.btn-secondary {
		padding: 12px 26px;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.3);
		background: transparent;
		color: #fff;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
	}
	.textlink {
		color: rgba(255, 255, 255, 0.65);
		font-size: 0.9rem;
	}
	.muted {
		color: rgba(255, 255, 255, 0.7);
		margin: 0;
	}
	.small {
		font-size: 0.85rem;
	}
	.error {
		color: #ffb3a0;
		margin: 8px 0 0;
	}
	.tick {
		width: 74px;
		height: 74px;
		border-radius: 50%;
		background: #76cd9c;
		color: #2e1f8c;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 2.2rem;
		font-weight: 800;
	}
	.title {
		font-family: 'Archivo', sans-serif;
		font-weight: 900;
		text-transform: uppercase;
		font-size: 2rem;
		margin: 0;
	}
	.spinner {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		border: 3px solid rgba(255, 255, 255, 0.25);
		border-top-color: #f6611e;
		animation: spin 0.9s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
