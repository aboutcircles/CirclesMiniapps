<script lang="ts">
	import { page } from '$app/stores';

	const PLAYGROUND_KEY = 'disclaimer-dismissed-playground';
	const CURATED_KEY = 'disclaimer-dismissed-curated';

	const isPlayground = $derived($page.url.pathname === '/playground');
	const isHidden = $derived($page.url.pathname.startsWith('/pilots/kudos-ga'));
	const disclaimerDismissedKey = $derived(isPlayground ? PLAYGROUND_KEY : CURATED_KEY);

	let disclaimerDismissed = $state(false);

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		disclaimerDismissed =
			localStorage.getItem(disclaimerDismissedKey) === 'true';
	});

	function dismissDisclaimer() {
		localStorage.setItem(disclaimerDismissedKey, 'true');
		disclaimerDismissed = true;
	}
</script>

{#if !disclaimerDismissed && !isHidden}
	<div class="disclaimer-banner">
		<div class="disclaimer-shell" class:compact={!isPlayground}>
			<div class="disclaimer-header">
				<div class="disclaimer-badge">Legal notice</div>
				{#if isPlayground}
					<h2 class="disclaimer-title">DEVELOPMENT PREVIEW - USE AT YOUR OWN RISK</h2>
				{:else}
					<h2 class="disclaimer-title">Curated mini-app notice</h2>
				{/if}
			</div>

			<div class="disclaimer-content">
				{#if isPlayground}
					<p class="disclaimer-text">
						This experimental mini-apps feature is made available in connection with the Gnosis App
						offered by Gnosis Ecosystem (Cayman) Ltd (“Gnosis”). This website, the mini-apps listing
						and the mini-apps accessible through it are provided solely for limited testing and product
						evaluation. Mini-apps are contributed by independent builders, and their code is not
						reviewed, audited, whitelisted or simulated by Gnosis at this stage.
					</p>
					<p class="disclaimer-text">
						When you use a mini-app, you may be asked to sign transactions directly from your Gnosis
						App Safe using your passkey. Once signed, transactions are irreversible. Gnosis does not
						control how mini-apps use your signatures and does not assume any responsibility for, or
						obligation to compensate you for, any resulting loss. Any funds, tokens or assets you use
						to interact with a mini-app are entirely at your sole risk. Do not sign transactions
						relating to assets you cannot afford to lose.
					</p>
					<p class="disclaimer-text">
						To the maximum extent permitted by law, the mini-apps feature is provided as is, without
						any warranty of any kind relating to functionality, availability, reliability, security,
						legality or fitness for any purpose. By continuing, you confirm that you understand and
						accept all associated risks.
					</p>
				{:else}
					<p class="disclaimer-text">
						Mini-apps on this page trigger on-chain transactions from your Safe wallet. Gnosis does
						not provide investment advice or guarantees and cannot reverse transactions or compensate
						you for any loss. Always check what you sign. For further details, please refer to the
						Gnosis App Terms of Use available via
						<a
							href="https://app.gnosis.io"
							target="_blank"
							rel="noopener noreferrer"
						>
							app.gnosis.io
						</a>.
					</p>
				{/if}
			</div>

			<div class="disclaimer-actions">
				<button class="disclaimer-close" onclick={dismissDisclaimer}>
					{isPlayground ? 'I understand the risks' : 'Continue'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.disclaimer-banner {
		position: sticky;
		top: 0;
		z-index: 9999;
		padding: 18px 20px 0;
		background:
			linear-gradient(180deg, rgba(250, 245, 241, 0.96) 0%, rgba(250, 245, 241, 0.88) 78%, rgba(250, 245, 241, 0) 100%);
		backdrop-filter: blur(14px);
	}

	.disclaimer-shell {
		max-width: 1100px;
		margin: 0 auto;
		padding: 22px 24px;
		border: 1px solid rgba(14, 0, 168, 0.1);
		border-radius: var(--radius-card);
		background:
			linear-gradient(135deg, rgba(234, 232, 255, 0.9) 0%, rgba(255, 255, 255, 0.98) 38%, rgba(254, 235, 199, 0.34) 100%);
		box-shadow: var(--shadow-card);
		position: relative;
		overflow: hidden;
	}

	.disclaimer-shell.compact {
		max-width: 960px;
		padding: 18px 22px;
	}

	.disclaimer-shell::before {
		content: '';
		position: absolute;
		inset: 0 auto 0 0;
		width: 6px;
		background: linear-gradient(180deg, var(--accent) 0%, #ff7d3e 100%);
	}

	.disclaimer-header {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 14px;
	}

	.compact .disclaimer-header {
		gap: 8px;
		margin-bottom: 10px;
	}

	.disclaimer-badge {
		width: fit-content;
		padding: 7px 12px;
		border-radius: var(--radius-pill);
		background: rgba(14, 0, 168, 0.08);
		color: var(--accent);
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.disclaimer-title {
		max-width: 760px;
		font-size: clamp(1.1rem, 1rem + 0.7vw, 1.55rem);
		font-weight: 800;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}

	.disclaimer-content {
		max-width: 920px;
	}

	.compact .disclaimer-content {
		max-width: none;
	}

	.disclaimer-text {
		font-size: 0.95rem;
		color: var(--muted);
		line-height: 1.62;
		margin: 0 0 12px;
	}

	.compact .disclaimer-text {
		margin-bottom: 0;
	}

	.disclaimer-text a {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.disclaimer-actions {
		display: flex;
		justify-content: flex-end;
		padding-top: 8px;
	}

	.compact .disclaimer-actions {
		padding-top: 14px;
	}

	.disclaimer-close {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent);
		color: white;
		border: 1px solid transparent;
		border-radius: var(--radius-pill);
		padding: 12px 20px;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 10px 24px rgba(14, 0, 168, 0.18);
		transition:
			transform 0.15s ease,
			background 0.15s ease,
			box-shadow 0.15s ease;
	}

	.disclaimer-close:hover {
		background: var(--accent-mid);
		transform: translateY(-1px);
		box-shadow: 0 14px 28px rgba(14, 0, 168, 0.24);
	}

	@media (max-width: 720px) {
		.disclaimer-banner {
			padding: 12px 12px 0;
		}

		.disclaimer-shell {
			padding: 18px 18px 20px;
			border-radius: 18px;
		}

		.disclaimer-text {
			font-size: 0.92rem;
		}

		.disclaimer-actions {
			justify-content: stretch;
		}

		.disclaimer-close {
			width: 100%;
		}
	}
</style>
