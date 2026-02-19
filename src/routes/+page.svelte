<script lang="ts">
	const baseUrl = import.meta.env.VITE_BASE_URL;
</script>

<svelte:head>
	<title>Circles - {baseUrl}</title>
</svelte:head>

<div class="landing">
	<h1>Circles</h1>
	<p class="subtitle">{baseUrl}</p>
	<nav>
		<a href="/miniapps">Mini Apps</a>
	</nav>
</div>

<style>
	.landing {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		color: white;
	}

	h1 {
		font-size: 48px;
		margin: 0 0 8px 0;
	}

	.subtitle {
		font-size: 16px;
		opacity: 0.8;
		margin: 0 0 40px 0;
	}

	nav {
		display: flex;
		gap: 16px;
	}

	nav a {
		padding: 14px 28px;
		background: rgba(255, 255, 255, 0.2);
		color: white;
		text-decoration: none;
		border-radius: 12px;
		font-weight: 600;
		font-size: 16px;
		backdrop-filter: blur(10px);
		transition: background 0.2s;
	}

	nav a:hover {
		background: rgba(255, 255, 255, 0.35);
	}
</style>
