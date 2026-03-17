<script lang="ts">
	let disclaimerDismissed = $state(
		typeof localStorage !== 'undefined' &&
			localStorage.getItem('disclaimer-dismissed') === 'true'
	);

	function dismissDisclaimer() {
		localStorage.setItem('disclaimer-dismissed', 'true');
		disclaimerDismissed = true;
	}
</script>

{#if !disclaimerDismissed}
	<div class="disclaimer-banner">
		<div class="disclaimer-icon">⚠️</div>
		<div class="disclaimer-content">
			<h2 class="disclaimer-title">Development Preview — Use at Your Own Risk</h2>
			<p class="disclaimer-text">
				This website is currently <strong>under active development</strong> and is provided for testing
				and evaluation purposes only. There is <strong>no warranty</strong> of any kind — express or implied
				— regarding the functionality, reliability, security, or fitness for any purpose. Features may
				be incomplete, change without notice, or behave unexpectedly. Any funds, tokens, or assets interacted
				with through this interface are at <strong>your sole risk</strong>. Do not use this platform
				with assets you cannot afford to lose. By continuing, you acknowledge that you understand and
				accept all associated risks.
			</p>
		</div>
		<button class="disclaimer-close" onclick={dismissDisclaimer}>
			I understand the risks — close this notice
		</button>
	</div>
{/if}

<style>
	.disclaimer-banner {
		background: var(--warn-ink);
		border-bottom: 2px solid #d97706;
		padding: 28px 24px 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		text-align: center;
		box-shadow: 0 4px 24px rgba(138, 72, 44, 0.3);
		position: sticky;
		top: 0;
		z-index: 9999;
	}

	.disclaimer-icon {
		font-size: 3rem;
		line-height: 1;
	}

	.disclaimer-title {
		font-size: 1.35rem;
		font-weight: 800;
		color: var(--warn-bg);
		margin: 0 0 10px;
		letter-spacing: -0.01em;
		text-transform: uppercase;
	}

	.disclaimer-text {
		font-size: 0.97rem;
		color: #fde68a;
		line-height: 1.65;
		margin: 0;
		max-width: 680px;
	}

	.disclaimer-text strong {
		color: var(--warn-bg);
		font-weight: 700;
	}

	.disclaimer-close {
		margin-top: 8px;
		background: #d97706;
		color: #fff;
		border: none;
		border-radius: var(--radius-pill);
		padding: 12px 28px;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
		transition: background 0.15s;
	}

	.disclaimer-close:hover {
		background: #b45309;
	}
</style>
