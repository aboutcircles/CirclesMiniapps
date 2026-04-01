<svelte:head>
	<title>Offline - Circles</title>
</svelte:head>

<div class="page-wrap">
	<div class="card">
		<img class="logo" src="/circles-token.svg" alt="Circles" />
		<span class="eyebrow">Offline</span>
		<h1>You&apos;re offline</h1>
		<p>
			The Circles shell and previously cached pages can still load, but wallet actions, invites,
			events, and remote miniapps need an internet connection.
		</p>
		<div class="buttons">
			<a class="btn" href="/">Go home</a>
			<a class="btn btn-outline" href="/miniapps">Browse miniapps</a>
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
		max-width: 460px;
		width: 100%;
	}

	.logo {
		width: 64px;
		height: 64px;
		margin-bottom: 18px;
	}

	.eyebrow {
		display: inline-block;
		margin-bottom: 8px;
		padding: 6px 12px;
		border-radius: var(--radius-pill);
		background: var(--warn-bg);
		color: var(--warn-ink);
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	h1 {
		margin: 0 0 12px;
		font-size: 28px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	p {
		margin: 0 0 28px;
		color: var(--muted);
		font-size: 15px;
		line-height: 1.55;
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
