<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { createPublicClient, http, isAddress, getAddress } from 'viem';
	import { gnosis } from 'viem/chains';
	import { privateKeyToAddress } from 'viem/accounts';
	import { ORG_ADDRESS } from '../config';

	const HUB_ADDRESS = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8' as const;
	const REFERRALS_ADDRESS = '0x12105a9B291aF2ABb0591001155A75949b062CE5' as const;

	const HUB_ABI = [
		{ name: 'isHuman', type: 'function', stateMutability: 'view',
		  inputs: [{ name: '_human', type: 'address' }],
		  outputs: [{ name: '', type: 'bool' }] },
		{ name: 'isTrusted', type: 'function', stateMutability: 'view',
		  inputs: [{ name: '_truster', type: 'address' }, { name: '_trustee', type: 'address' }],
		  outputs: [{ name: '', type: 'bool' }] }
	] as const;

	const REFERRALS_ABI = [
		{ name: 'accounts', type: 'function', stateMutability: 'view',
		  inputs: [{ name: 'signer', type: 'address' }],
		  outputs: [{ name: 'account', type: 'address' }, { name: 'claimed', type: 'bool' }] }
	] as const;

	type Status =
		| 'loading'
		| 'redirecting'
		| 'not_in_game'
		| 'invalid_param'
		| 'error';

	let status = $state<Status>('loading');
	let errorMsg = $state('');
	let resolvedAddress = $state('');
	let paramType = $state<'address' | 'privkey' | 'unknown'>('unknown');

	const param = $derived($page.params.param);

	/** Returns true if the string looks like a 32-byte hex (with or without 0x prefix) */
	function isBytes32(s: string): boolean {
		const hex = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
		return /^[0-9a-fA-F]{64}$/.test(hex);
	}

	function normalizePrivKey(s: string): `0x${string}` {
		const hex = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
		return `0x${hex}` as `0x${string}`;
	}

	onMount(async () => {
		const client = createPublicClient({ chain: gnosis, transport: http() });

		try {
			if (isAddress(param)) {
				// ── Case 1: Ethereum address ───────────────────────────────────────
				paramType = 'address';
				const checksummed = getAddress(param);
				resolvedAddress = checksummed;

				const human = await client.readContract({
					address: HUB_ADDRESS,
					abi: HUB_ABI,
					functionName: 'isHuman',
					args: [checksummed]
				});

				if (!human) {
					status = 'not_in_game';
					return;
				}

				const trusted = await client.readContract({
					address: HUB_ADDRESS,
					abi: HUB_ABI,
					functionName: 'isTrusted',
					args: [ORG_ADDRESS, checksummed]
				});

				if (!trusted) {
					status = 'not_in_game';
					return;
				}

				status = 'redirecting';
				window.location.href = `/ps-board?address=${checksummed}`;

			} else if (isBytes32(param)) {
				// ── Case 2: bytes32 private key ────────────────────────────────────
				paramType = 'privkey';
				const privKey = normalizePrivKey(param);
				const signer = privateKeyToAddress(privKey);
				resolvedAddress = signer;

				const [account, claimed] = await client.readContract({
					address: REFERRALS_ADDRESS,
					abi: REFERRALS_ABI,
					functionName: 'accounts',
					args: [signer]
				});

				if (account === '0x0000000000000000000000000000000000000000') {
					status = 'not_in_game';
					return;
				}

				const trusted = await client.readContract({
					address: HUB_ADDRESS,
					abi: HUB_ABI,
					functionName: 'isTrusted',
					args: [ORG_ADDRESS, account]
				});

				if (!trusted) {
					status = 'not_in_game';
					return;
				}

				status = 'redirecting';
				if (claimed) {
					window.location.href = `/ps-board?address=${account}`;
				} else {
					window.location.href = `https://app.gnosis.io/referral/${param}`;
				}

			} else {
				paramType = 'unknown';
				status = 'invalid_param';
			}
		} catch (e: any) {
			status = 'error';
			errorMsg = e?.message ?? String(e);
		}
	});

	function truncate(addr: string): string {
		return addr.slice(0, 8) + '...' + addr.slice(-6);
	}
</script>

<svelte:head>
	<title>PS Event — Circles</title>
</svelte:head>

<div class="page">
	<div class="card">
		<h1 class="title">Circles Event Status</h1>

		{#if resolvedAddress}
			<p class="address" title={resolvedAddress}>
				{#if paramType === 'privkey'}Signer:{:else}Account:{/if}
				<code>{truncate(resolvedAddress)}</code>
			</p>
		{/if}

		{#if status === 'loading'}
			<div class="status loading">
				<span class="spinner"></span>
				Checking on-chain…
			</div>

		{:else if status === 'redirecting'}
			<div class="status loading">
				<span class="spinner"></span>
				Redirecting…
			</div>

		{:else if status === 'not_in_game'}
			<div class="status muted">
				<span class="icon">✕</span>
				Sorry, you are not a part of the game
			</div>

		{:else if status === 'invalid_param'}
			<div class="status error">
				<span class="icon">!</span>
				Invalid link — expected an Ethereum address or 32-byte key
			</div>

		{:else if status === 'error'}
			<div class="status error">
				<span class="icon">!</span>
				Error: {errorMsg}
			</div>
		{/if}
	</div>
</div>

<style>
	.page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		box-sizing: border-box;
	}

	.card {
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(6px);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		padding: 48px 40px;
		max-width: 420px;
		width: 100%;
		text-align: center;
		box-shadow: var(--shadow-card);
	}

	.logo {
		font-size: 3rem;
		line-height: 1;
		margin-bottom: 16px;
	}

	.title {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--ink);
		margin: 0 0 24px;
		letter-spacing: -0.01em;
	}

	.address {
		font-size: 0.85rem;
		color: var(--muted);
		margin: 0 0 28px;
	}

	.address code {
		font-family: 'SF Mono', ui-monospace, monospace;
		color: var(--accent-mid);
		background: var(--accent-soft);
		padding: 2px 6px;
		border-radius: 4px;
	}

	.status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		border-radius: var(--radius-sm);
		padding: 18px 20px;
		font-size: 1rem;
		font-weight: 600;
	}

	.status.loading {
		background: var(--accent-soft);
		color: var(--accent-mid);
	}

	.status.muted {
		background: var(--bg-a);
		color: var(--muted);
		border: 1px solid var(--line);
	}

	.status.error {
		background: var(--error-bg);
		color: var(--error-ink);
		border: 1px solid var(--error-bg);
	}

	.icon {
		font-size: 1.1rem;
		font-weight: 800;
		flex-shrink: 0;
	}

	.spinner {
		display: inline-block;
		width: 16px;
		height: 16px;
		border: 2px solid rgba(67, 53, 223, 0.3);
		border-top-color: var(--accent-mid);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		flex-shrink: 0;
	}
</style>
