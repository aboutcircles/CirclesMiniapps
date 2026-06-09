<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';
	import { createPublicClient, http, type Address } from 'viem';
	import { privateKeyToAddress } from 'viem/accounts';
	import { gnosis } from 'viem/chains';

	const REFERRALS_BASE = env.PUBLIC_REFERRALS_BASE ?? 'https://referrals.aboutcircles.com';
	const DESTINATION_BASE = 'https://app.gnosis.io/referral';

	// ReferralsModule on Gnosis Chain — exposes accounts(signer) → (account, claimed).
	const ONCHAIN_RPC_URL = 'https://rpc.aboutcircles.com/';
	const REFERRALS_MODULE_ADDRESS =
		(env.PUBLIC_REFERRALS_MODULE_ADDRESS as Address) ??
		('0x12105a9B291aF2ABb0591001155A75949b062CE5' as Address);

	const referralsModuleAbi = [
		{
			type: 'function',
			name: 'accounts',
			stateMutability: 'view',
			inputs: [{ name: 'signer', type: 'address' }],
			outputs: [
				{ name: 'account', type: 'address' },
				{ name: 'claimed', type: 'bool' }
			]
		}
	] as const;

	/**
	 * Check on-chain whether the referral behind a cached private key has been claimed.
	 *
	 * Derives the signer address from the key and reads ReferralsModule.accounts(signer).
	 * Returns true only when we can positively confirm the referral is claimed; on any
	 * RPC/derivation error we return false so a transient failure never strands the user.
	 */
	async function isReferralClaimed(privateKey: string): Promise<boolean> {
		try {
			const key = (privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`) as `0x${string}`;
			const signer = privateKeyToAddress(key);

			const client = createPublicClient({ chain: gnosis, transport: http(ONCHAIN_RPC_URL) });
			const [, claimed] = await client.readContract({
				address: REFERRALS_MODULE_ADDRESS,
				abi: referralsModuleAbi,
				functionName: 'accounts',
				args: [signer]
			});

			return claimed === true;
		} catch {
			return false;
		}
	}

	type Status = 'loading' | 'redirecting' | 'exhausted' | 'paused' | 'error';

	let status = $state<Status>('loading');
	let errorMessage = $state('');
	let referralUrl = $state('');

	async function fetchAndRedirect(currentSlug: string, storageKey: string) {
		status = 'loading';
		errorMessage = '';

		try {
			const cached = localStorage.getItem(storageKey);
			if (cached) {
				// Only reuse the cached link if its referral hasn't been claimed on-chain.
				// If it's already claimed, drop it and fall through to fetch the next one.
				const claimed = await isReferralClaimed(cached);
				if (!claimed) {
					const dest = `${DESTINATION_BASE}/${cached}${window.location.search}`;
					referralUrl = dest;
					status = 'redirecting';
					window.location.href = dest;
					return;
				}
				try { localStorage.removeItem(storageKey); } catch { }
			}
		} catch { }

		try {
			const response = await fetch(`${REFERRALS_BASE}/d/${encodeURIComponent(currentSlug)}`, {
				headers: { Accept: 'application/json' }
			});

			if (!response.ok) {
				if (response.status === 410) {
					status = 'exhausted';
					return;
				}
				if (response.status === 423) {
					status = 'paused';
					return;
				}
				if (response.status === 404) {
					status = 'exhausted';
					return;
				}
				throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
			}

			const data = await response.json();
			const privateKey: string = data.privateKey;
			if (!privateKey || typeof privateKey !== 'string') {
				throw new Error('Unexpected response format from invitation service.');
			}

			try { localStorage.setItem(storageKey, privateKey); } catch { }

			const dest = `${DESTINATION_BASE}/${privateKey}${window.location.search}`;
			referralUrl = dest;
			status = 'redirecting';
			window.location.href = dest;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
			status = 'error';
		}
	}

	onMount(() => {
		const slug = page.params.slug;
		fetchAndRedirect(slug, `circles_inv_${slug}`);
	});
	function retry() {
		const slug = page.params.slug;
		fetchAndRedirect(slug, `circles_inv_${slug}`);
	}
</script>

<svelte:head>
	<title>Circles — Joining…</title>
</svelte:head>

<div class="page">
	<div class="card">
		<h1 class="title">Circles</h1>

		{#if status === 'loading'}
			<div class="status loading">
				<span class="spinner"></span>
				Fetching your invitation…
			</div>
		{:else if status === 'redirecting'}
			<div class="status loading">
				<span class="spinner"></span>
				Redirecting you now…
			</div>
			<p class="manual-link">
				Not redirected? <a href={referralUrl}>Click here</a>
			</p>
		{:else if status === 'exhausted'}
			<div class="status muted">
				No more invitations available
			</div>
		{:else if status === 'paused'}
			<div class="status muted">
				This session is currently paused
			</div>
		{:else if status === 'error'}
			<div class="status error">
				Something went wrong
			</div>
			{#if errorMessage}
				<p class="error-detail">{errorMessage}</p>
			{/if}
			<button class="retry-btn" onclick={retry}>Try again</button>
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

	.title {
		font-size: 1.4rem;
		font-weight: 700;
		color: var(--ink);
		margin: 0 0 24px;
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

	.manual-link {
		margin-top: 16px;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.manual-link a {
		color: var(--accent-mid);
		text-decoration: underline;
	}

	.error-detail {
		margin-top: 12px;
		font-size: 0.875rem;
		color: var(--error-ink);
		opacity: 0.8;
		word-break: break-word;
	}

	.retry-btn {
		margin-top: 20px;
		padding: 10px 28px;
		background: var(--card);
		color: var(--accent);
		border: 1px solid var(--line);
		border-radius: var(--radius-pill);
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.retry-btn:hover {
		background: var(--accent-soft);
	}
</style>
