<script lang="ts">
	import { page } from '$app/stores';

	const PLAYGROUND_KEY = 'disclaimer-dismissed-playground';
	const MINIAPPS_KEY = 'disclaimer-dismissed-miniapps';
	const CURATED_KEY = 'disclaimer-dismissed-curated';

	let { strongDisclaimer }: { strongDisclaimer?: boolean } = $props();

	const isPlayground = $derived($page.url.pathname === '/playground');
	const isMiniapps = $derived($page.url.pathname.startsWith('/miniapps'));
	const isHidden = $derived(
		$page.url.pathname.startsWith('/pilots') ||
		$page.url.pathname.startsWith('/invitation') ||
		// crc-signin is an embedded wallet connector inside a small third-party
		// iframe — a full-width legal banner would cover the entire connect UI.
		$page.url.pathname.startsWith('/crc-signin')
	);

	// The playground and mini-apps flagged `strongDisclaimer` in the manifest
	// get the strong-warning copy; all other mini-apps get the curated notice.
	// Each variant has its own dismissal key so accepting one doesn't waive
	// the other.
	const isStrongMiniapp = $derived(isMiniapps && strongDisclaimer === true);
	const isStrongWarning = $derived(isPlayground || isStrongMiniapp);
	const disclaimerDismissedKey = $derived(
		isPlayground ? PLAYGROUND_KEY : isStrongMiniapp ? MINIAPPS_KEY : CURATED_KEY
	);

	// On mini-app pages the flag arrives with the manifest fetch; hold off
	// until then so the curated copy doesn't flash before a flagged app's
	// strong warning.
	const awaitingManifest = $derived(isMiniapps && strongDisclaimer === undefined);

	let disclaimerDismissed = $state(false);
	let expanded = $state(false);

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

{#if !disclaimerDismissed && !isHidden && !awaitingManifest}
	<div class="disclaimer-overlay">
		<div class="disclaimer-card">
			<div class="disclaimer-header">
				{#if isStrongWarning}
					<h2 class="disclaimer-title">DEVELOPMENT PREVIEW - USE AT YOUR OWN RISK</h2>
				{:else}
					<h2 class="disclaimer-title">Quick heads-up</h2>
				{/if}
			</div>

			<div class="disclaimer-content" class:collapsed={!expanded}>
				{#if isStrongWarning}
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
						Mini‑apps shown here are created and operated by independent developers, not by Gnosis
						Ecosystem (Cayman) Ltd (“Gnosis”). They appear in this interface for your convenience,
						but Gnosis does not control their code or ongoing operation and does not guarantee that
						they are safe, secure, or error‑free.
					</p>
					<p class="disclaimer-text">
						By using a mini‑app, you understand that you interact with it at your own risk. Any
						blockchain transactions you sign are final and cannot be reversed, and Gnosis will not
						be responsible for, or obliged to compensate you for, any resulting loss of funds,
						tokens or other assets. Only use mini‑apps and sign transactions if you understand what
						they do and can afford to lose the assets involved.
					</p>
				{/if}
			</div>

			<div class="disclaimer-actions">
				<button
					class="disclaimer-more"
					aria-expanded={expanded}
					onclick={() => (expanded = !expanded)}
				>
					{expanded ? 'Show less' : 'Read more'}
				</button>
				<button class="disclaimer-agree" onclick={dismissDisclaimer}>Ok. Show me the app!</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Fills the hosting miniapp card (.iframe-card is position: relative with
	   overflow: hidden), blocking interaction with the iframe until dismissed. */
	.disclaimer-overlay {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		background: rgba(5, 6, 26, 0.45);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
	}

	.disclaimer-card {
		width: 100%;
		max-width: 520px;
		max-height: 100%;
		overflow-y: auto;
		padding: 20px 22px 16px;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		background: var(--card);
		box-shadow: var(--shadow-popup);
		animation: disclaimer-in 0.18s ease-out;
	}

	@keyframes disclaimer-in {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.985);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}

	.disclaimer-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}

	.disclaimer-title {
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--ink);
		margin: 0;
		letter-spacing: -0.02em;
		line-height: 1.25;
	}

	.disclaimer-content.collapsed {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 5;
		line-clamp: 5;
		overflow: hidden;
	}

	.disclaimer-text {
		font-size: 0.85rem;
		color: var(--muted);
		line-height: 1.6;
		margin: 0 0 10px;
	}

	.disclaimer-text:last-child {
		margin-bottom: 0;
	}

	.disclaimer-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid var(--line-soft);
	}

	.disclaimer-more {
		background: none;
		border: none;
		padding: 0;
		color: var(--accent);
		font-size: 0.85rem;
		font-weight: 600;
		font-family: inherit;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.disclaimer-more:hover {
		color: var(--accent-mid);
	}

	.disclaimer-agree {
		display: flex;
		align-items: center;
		justify-content: center;
		background: linear-gradient(130deg, var(--accent), var(--accent-mid));
		color: #fff;
		border: none;
		border-radius: var(--radius-pill);
		padding: 9px 22px;
		font-size: 0.85rem;
		font-weight: 600;
		font-family: inherit;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.disclaimer-agree:hover {
		opacity: 0.85;
	}

	@media (max-width: 720px) {
		.disclaimer-overlay {
			padding: 10px;
		}

		.disclaimer-card {
			padding: 16px 16px 14px;
			border-radius: 18px;
		}
	}
</style>
