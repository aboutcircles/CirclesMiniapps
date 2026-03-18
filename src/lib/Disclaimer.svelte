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
		<div class="disclaimer-shell">
			<div class="disclaimer-header">
				<div class="disclaimer-badge">Legal notice</div>
				<h2 class="disclaimer-title">DEVELOPMENT PREVIEW - USE AT YOUR OWN RISK</h2>
			</div>
			<div class="disclaimer-content">
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
			</div>
			<div class="disclaimer-actions">
				<button class="disclaimer-close" onclick={dismissDisclaimer}>
					I understand the risks
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

	.disclaimer-text {
		font-size: 0.95rem;
		color: var(--muted);
		line-height: 1.62;
		margin: 0 0 12px;
	}

	.disclaimer-actions {
		display: flex;
		justify-content: flex-end;
		padding-top: 8px;
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
