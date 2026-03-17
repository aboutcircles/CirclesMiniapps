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
	.page-wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.card {
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(6px);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		padding: 48px 40px;
		text-align: center;
		box-shadow: var(--shadow-card);
		max-width: 420px;
		width: 90%;
		margin: auto;
	}

	.card p {
		margin-bottom: 24px;
		color: var(--muted);
		font-size: 15px;
	}

	.spinner {
		width: 36px;
		height: 36px;
		border: 3px solid var(--line);
		border-top-color: var(--accent-mid);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin: 0 auto 20px;
	}

	.btn {
		display: inline-block;
		background: linear-gradient(130deg, var(--accent), var(--accent-mid));
		color: #fff;
		border: none;
		padding: 12px 28px;
		border-radius: var(--radius-pill);
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
		transition: opacity 0.15s;
	}

	.btn:hover {
		opacity: 0.85;
	}
</style>
