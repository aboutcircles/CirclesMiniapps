<script lang="ts">
</script>

<nav class="route-nav" aria-label="Primary">
	<a
		class="home-link"
		href="/"
		aria-label="Home"
	>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
	</a>
</nav>

<style>
	.route-nav {
		display: inline-flex;
	}

	a {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 8px 10px;
		border: 1px solid var(--line);
		border-radius: var(--radius-pill);
		background: rgba(255, 255, 255, 0.72);
		color: var(--muted);
		text-decoration: none;
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	a:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
</style>
