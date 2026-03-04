<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';

	const INVITE_API = 'https://circles-invitation-service-57qa7.ondigitalocean.app/referral';
	const DESTINATION_BASE = 'https://app.gnosis.io/referral';

	// Derive the key from the URL so it stays reactive to navigation.
	const key = $derived(page.params.key);
	const cacheKey = $derived(`circles_ref_${key}`);

	type Status = 'loading' | 'redirecting' | 'error';

	let status = $state<Status>('loading');
	let errorMessage = $state('');
	let referralUrl = $state('');

	async function fetchAndRedirect(inviteKey: string, storageKey: string) {
		status = 'loading';
		errorMessage = '';

		// Check localStorage cache first to avoid burning an invite on repeat visits.
		try {
			const cached = localStorage.getItem(storageKey);
			if (cached) {
				const dest = `${DESTINATION_BASE}/${cached}`;
				referralUrl = dest;
				status = 'redirecting';
				window.location.href = dest;
				return;
			}
		} catch {
			// localStorage may be unavailable (private browsing, etc.) – continue.
		}

		try {
			const response = await fetch(`${INVITE_API}/${encodeURIComponent(inviteKey)}`);

			if (!response.ok) {
				throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
			}

			const data = await response.json();

			// The API is expected to return a referral code/token in a `ref` field.
			// Adjust the property name below if the actual response shape differs.
			const ref: string = data.ref ?? data.referral ?? data.code ?? data;

			if (!ref || typeof ref !== 'string') {
				throw new Error('Unexpected response format from invitation service.');
			}

			// Cache so repeat visits skip the API call.
			try {
				localStorage.setItem(storageKey, ref);
			} catch {
				// Ignore storage errors.
			}

			const dest = `${DESTINATION_BASE}/${ref}`;
			referralUrl = dest;
			status = 'redirecting';
			window.location.href = dest;
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
			status = 'error';
		}
	}

	onMount(() => {
		fetchAndRedirect(key, cacheKey);
	});

	function retry() {
		fetchAndRedirect(key, cacheKey);
	}
</script>

<svelte:head>
	<title>Circles – Joining event…</title>
</svelte:head>

<div class="page-wrap">
	<div class="card">
		{#if status === 'loading'}
			<div class="spinner"></div>
			<p>Fetching your invitation&hellip;</p>
		{:else if status === 'redirecting'}
			<div class="spinner"></div>
			<p>Redirecting you now&hellip;</p>
			<a class="btn" href={referralUrl}>Open manually</a>
		{:else if status === 'error'}
			<p class="error-heading">Something went wrong</p>
			<p class="error">{errorMessage}</p>
			<div class="actions">
				<button class="btn" onclick={retry}>Try again</button>
				<a class="btn btn-secondary" href="https://app.gnosis.io">Go to Gnosis</a>
			</div>
		{/if}
	</div>
</div>

<style>
	* {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
	}

	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		background: #f5f5f5;
	}

	.page-wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card {
		background: #fff;
		border-radius: 12px;
		padding: 48px 40px;
		text-align: center;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
		max-width: 420px;
		width: 90%;
		margin: auto;
	}

	.card p {
		color: #555;
		font-size: 15px;
		margin-bottom: 24px;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid #e0e0e0;
		border-top-color: #3e6957;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: 0 auto 20px;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.error-heading {
		font-weight: 600;
		font-size: 17px;
		color: #333;
		margin-bottom: 8px;
	}

	.error {
		color: #c0392b;
		font-size: 14px;
		margin-bottom: 24px;
		word-break: break-word;
	}

	.actions {
		display: flex;
		gap: 12px;
		justify-content: center;
		flex-wrap: wrap;
	}

	.btn {
		display: inline-block;
		background: #3e6957;
		color: #fff;
		border: none;
		padding: 12px 28px;
		border-radius: 8px;
		font-size: 15px;
		cursor: pointer;
		text-decoration: none;
	}

	.btn:hover {
		background: #335a49;
	}

	.btn-secondary {
		background: transparent;
		color: #3e6957;
		border: 2px solid #3e6957;
	}

	.btn-secondary:hover {
		background: #f0f7f4;
	}
</style>
