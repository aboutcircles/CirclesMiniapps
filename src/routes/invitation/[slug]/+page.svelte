<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { env } from '$env/dynamic/public';

	const REFERRALS_BASE = env.PUBLIC_REFERRALS_BASE ?? 'https://staging.circlesubi.network/referrals';
	const DESTINATION_BASE = 'https://app.gnosis.io/referral';

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
				const dest = `${DESTINATION_BASE}/${cached}${window.location.search}`;
				referralUrl = dest;
				status = 'redirecting';
				window.location.href = dest;
				return;
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
		<div class="logo">⭕</div>
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
	:global(body) {
		margin: 0;
		background: #0d0d1a;
		color: #f0eeff;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
		to {
			transform: rotate(360deg);
		}
	}

	.manual-link {
		margin-top: 16px;
		font-size: 0.875rem;
		color: #6e6e99;
	}

	.manual-link a {
		color: #8888cc;
		text-decoration: underline;
	}

	.error-detail {
		margin-top: 12px;
		font-size: 0.875rem;
		color: #f87171;
		opacity: 0.8;
		word-break: break-word;
	}

	.retry-btn {
		margin-top: 20px;
		padding: 10px 28px;
		background: #2a2a4a;
		color: #c0b8ff;
		border: 1px solid #3a3a6a;
		border-radius: 10px;
		font-size: 0.95rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.retry-btn:hover {
		background: #32325a;
	}
</style>
