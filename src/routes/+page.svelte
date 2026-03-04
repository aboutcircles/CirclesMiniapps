<script lang="ts">
	import { onMount } from 'svelte';

	const TARGET_URL = 'https://app.aboutcircles.com';

	let status = $state<'redirecting' | 'done'>('redirecting');

	onMount(() => {
		window.location.href = TARGET_URL;
		status = 'done';
	});
</script>

<svelte:head>
	<title>Circles – Redirecting…</title>
</svelte:head>

<div class="page-wrap">
	<div class="card">
		<div class="spinner"></div>
		<p>Redirecting to Circles&hellip;</p>
		<a class="btn" href={TARGET_URL}>Open manually</a>
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
		margin-bottom: 24px;
		color: #555;
		font-size: 15px;
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
</style>
