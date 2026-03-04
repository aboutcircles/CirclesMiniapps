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
				window.location.href = `https://app.gnosis.io/transfer/${ORG_ADDRESS}/crc/1?data=${checksummed}`;

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
					window.location.href = `https://app.gnosis.io/transfer/${ORG_ADDRESS}/crc/1?data=${account}`;
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
		<div class="logo">⭕</div>
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
	:global(body) {
		margin: 0;
		background: #0d0d1a;
		color: #f0eeff;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	.page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		box-sizing: border-box;
	}

	.card {
		background: #1a1a2e;
		border: 1px solid #2a2a4a;
		border-radius: 20px;
		padding: 48px 40px;
		max-width: 420px;
		width: 100%;
		text-align: center;
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4);
	}

	.logo {
		font-size: 3rem;
		line-height: 1;
		margin-bottom: 16px;
	}

	.title {
		font-size: 1.4rem;
		font-weight: 700;
		color: #e0d8ff;
		margin: 0 0 24px;
		letter-spacing: -0.01em;
	}

	.address {
		font-size: 0.85rem;
		color: #6e6e99;
		margin: 0 0 28px;
	}

	.address code {
		font-family: 'SF Mono', ui-monospace, monospace;
		color: #a0a0cc;
		background: #12122a;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.status {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		border-radius: 12px;
		padding: 18px 20px;
		font-size: 1rem;
		font-weight: 600;
	}

	.status.loading {
		background: #1e1e3a;
		color: #8888cc;
	}

	.status.muted {
		background: #1a1a2e;
		color: #6e6e99;
		border: 1px solid #2a2a4a;
	}

	.status.error {
		background: #2b0d0d;
		color: #f87171;
		border: 1px solid #7f1d1d;
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
		border: 2px solid rgba(136, 136, 204, 0.3);
		border-top-color: #8888cc;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		flex-shrink: 0;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
