<script lang="ts">
	import Disclaimer from '$lib/Disclaimer.svelte';
</script>

<svelte:head>
	<title>Circles</title>
</svelte:head>

<Disclaimer />

<div class="page-wrap">
	<div class="card">
		<img class="logo" src="/circles-token.svg" alt="Circles" />
		<h1>Circles</h1>
		<p>Choose where you'd like to go</p>
		<div class="buttons">
			<a class="btn" href="/miniapps">Mini Apps</a>
			<a class="btn btn-outline" href="/admin">Admin</a>
		</div>
	</div>
</div>

<style>
	.page-wrap {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
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
		width: 100%;
	}

	.logo {
		width: 64px;
		height: 64px;
		margin-bottom: 16px;
	}

	h1 {
		margin: 0 0 8px;
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	p {
		margin: 0 0 28px;
		color: var(--muted);
		font-size: 15px;
	}

	.buttons {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.btn {
		display: block;
		padding: 14px 28px;
		border-radius: var(--radius-pill);
		font-size: 15px;
		font-weight: 600;
		text-decoration: none;
		text-align: center;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn:hover {
		opacity: 0.85;
	}

	.btn:not(.btn-outline) {
		background: linear-gradient(130deg, var(--accent), var(--accent-mid));
		color: #fff;
		border: none;
	}

	.btn-outline {
		background: transparent;
		color: var(--accent);
		border: 2px solid var(--accent);
	}
</style>
