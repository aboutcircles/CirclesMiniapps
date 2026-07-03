<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import AppNavigation from '$lib/AppNavigation.svelte';
	import Disclaimer from '$lib/Disclaimer.svelte';
	import { wallet } from '$lib/wallet.svelte.ts';
	import ApprovalPopup from '$lib/ApprovalPopup.svelte';
	import RestrictedActionPopup from '$lib/RestrictedActionPopup.svelte';
	import AuthPopup from '$lib/AuthPopup.svelte';
	import {
		truncateAddr,
		getAvatarInitial as _getAvatarInitial,
		createMessageHandler,
		createApprovalHandlers,
		type PendingRequest
	} from '$lib/iframeHost.ts';
	import {
		trackMiniappIframeLoaded,
		trackMiniappIframeLoadFailed,
		trackMiniappRequestedAddress,
		trackMiniappRequestedTransaction,
		trackMiniappRequestedSignature,
		trackMiniappTxApproved,
		trackMiniappTxRejected,
		trackMiniappTxPolicyBlocked,
		trackMiniappSignApproved,
		trackMiniappSignRejected
	} from '$lib/analytics';

	type AnalyticsContext = { slug: string; name?: string };

	type Props = {
		src: string;
		iframeTitle: string;
		sandbox?: string;
		allow?: string;
		backLabel?: string;
		onBack: () => void;
		title?: string;
		getAppData?: () => string | null;
		isOffline?: boolean;
		enforceTxPolicy?: boolean;
		offlineState?: Snippet;
		emptyState?: Snippet;
		beforeIframe?: Snippet;
		analytics?: AnalyticsContext;
		iframeLoadTimeoutMs?: number;
		strongDisclaimer?: boolean;
	};

	let {
		src,
		iframeTitle,
		sandbox = 'allow-scripts allow-forms allow-same-origin',
		allow = 'clipboard-write; web-share; microphone; autoplay',
		backLabel = 'back',
		onBack,
		title,
		getAppData,
		isOffline = false,
		enforceTxPolicy = false,
		offlineState,
		emptyState,
		beforeIframe,
		analytics,
		iframeLoadTimeoutMs = 15000,
		strongDisclaimer
	}: Props = $props();

	let showLogout = $state(false);
	let chipEl = $state<HTMLElement>();
	let pendingRequest: PendingRequest | null = $state(null);
	let blockedAction: { reason: string; transactions: any[] } | null = $state(null);

	// Sign-in errors are shown as a brief, non-blocking toast in the bottom-right
	// corner (not a persistent banner). Watch the wallet's connectionError and
	// surface it transiently, then auto-dismiss.
	let errorToast = $state<string | null>(null);
	$effect(() => {
		const err = wallet.connectionError;
		if (err && !wallet.connected) {
			errorToast = err;
			const t = setTimeout(() => (errorToast = null), 5000);
			return () => clearTimeout(t);
		}
	});

	// Attribution tag for account creation triggered from this miniapp: the
	// loaded iframe's origin (trusted — derived from `src`, not miniapp-supplied).
	const appOrigin = $derived.by(() => {
		try {
			return new URL(src).origin;
		} catch {
			return src || 'direct';
		}
	});

	// pendingSource is kept outside $state to avoid Svelte proxying the cross-origin Window object,
	// which triggers "Blocked a frame from accessing a cross-origin frame".
	let pendingSource: MessageEventSource | null = null;

	let iframeEl: HTMLIFrameElement = $state() as HTMLIFrameElement;
	let cardEl: HTMLDivElement = $state() as HTMLDivElement;
	let isFullscreen = $state(false);
	let pseudoFullscreen = $state(false);

	// Analytics state — kept outside $state, only read inside handlers.
	const mountedAt = Date.now();
	let iframeLoaded = false;
	let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let pendingShownAt: number | null = null;

	function secondsSinceLoad(): number {
		return Math.round((Date.now() - mountedAt) / 1000);
	}

	const getAvatarInitial = () => _getAvatarInitial(wallet.avatarName, wallet.address);

	function handleWindowClick(e: MouseEvent) {
		if (showLogout && chipEl && !chipEl.contains(e.target as Node)) {
			showLogout = false;
		}
	}

	function openUserMenu() {
		showLogout = !showLogout;
	}

	function postToIframe(data: any) {
		try {
			iframeEl?.contentWindow?.postMessage(data, '*');
		} catch {
			// cross-origin access blocked — ignore
		}
	}

	const handleMessage = createMessageHandler({
		getAppData: () => getAppData?.() ?? null,
		setPending: (req) => {
			pendingRequest = req;
			if (req) pendingShownAt = Date.now();
		},
		setPendingSource: (s) => { pendingSource = s; },
		get enforceTxPolicy() { return enforceTxPolicy; },
		onPolicyRejection: (info) => {
			blockedAction = info;
			if (analytics) {
				trackMiniappTxPolicyBlocked({
					slug: analytics.slug,
					name: analytics.name,
					reason: info.reason
				});
			}
		},
		onAddressRequested: (info) => {
			if (!analytics) return;
			trackMiniappRequestedAddress({
				slug: analytics.slug,
				name: analytics.name,
				wallet_connected: info.hadWallet,
				seconds_since_load: secondsSinceLoad()
			});
		},
		onTransactionRequested: (info) => {
			if (!analytics) return;
			trackMiniappRequestedTransaction({
				slug: analytics.slug,
				name: analytics.name,
				tx_count: info.txCount,
				had_wallet: info.hadWallet,
				seconds_since_load: secondsSinceLoad()
			});
		},
		onSignatureRequested: (info) => {
			if (!analytics) return;
			trackMiniappRequestedSignature({
				slug: analytics.slug,
				name: analytics.name,
				signature_type: info.signatureType
			});
		},
		onTxAutoRejected: (info) => {
			if (!analytics) return;
			trackMiniappTxRejected({
				slug: analytics.slug,
				name: analytics.name,
				reject_reason: info.reason
			});
		},
		onSignAutoRejected: (info) => {
			if (!analytics) return;
			trackMiniappSignRejected({
				slug: analytics.slug,
				name: analytics.name,
				reject_reason: info.reason
			});
		}
	});

	const baseApprovalHandlers = createApprovalHandlers({
		getPending: () => pendingRequest,
		getPendingSource: () => pendingSource,
		setPending: (req) => {
			pendingRequest = req;
			if (!req) pendingShownAt = null;
		},
		setPendingSource: (s) => { pendingSource = s; }
	});

	async function handleApprove(): Promise<string> {
		const req = pendingRequest;
		const startedAt = pendingShownAt;
		const result = await baseApprovalHandlers.handleApprove();
		if (analytics && req) {
			const latency = startedAt ? Date.now() - startedAt : undefined;
			if (req.kind === 'tx') {
				trackMiniappTxApproved({
					slug: analytics.slug,
					name: analytics.name,
					tx_count: req.transactions?.length ?? 0,
					approve_latency_ms: latency
				});
			} else {
				trackMiniappSignApproved({
					slug: analytics.slug,
					name: analytics.name,
					signature_type: req.signatureType ?? 'erc1271'
				});
			}
		}
		return result;
	}

	function handleReject() {
		const req = pendingRequest;
		baseApprovalHandlers.handleReject();
		if (analytics && req) {
			if (req.kind === 'tx') {
				trackMiniappTxRejected({
					slug: analytics.slug,
					name: analytics.name,
					reject_reason: 'user_rejected'
				});
			} else {
				trackMiniappSignRejected({
					slug: analytics.slug,
					name: analytics.name,
					reject_reason: 'user_rejected'
				});
			}
		}
	}

	// Resolve a miniapp-initiated 'request_create_account' when the AuthPopup
	// closes: success if the user is now connected, rejected otherwise.
	function handleAuthClose() {
		const req = pendingRequest;
		if (req?.kind === 'auth') {
			if (wallet.connected) {
				postToIframe({ type: 'auth_success', address: wallet.address, requestId: req.requestId });
			} else {
				postToIframe({ type: 'auth_rejected', reason: 'User cancelled', requestId: req.requestId });
			}
		}
		pendingRequest = null;
		pendingShownAt = null;
		pendingSource = null;
	}

	function syncFullscreenState() {
		isFullscreen = !!document.fullscreenElement || pseudoFullscreen;
	}

	async function toggleFullscreen() {
		const target = cardEl;
		if (!target) return;
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
			} else if (pseudoFullscreen) {
				pseudoFullscreen = false;
				isFullscreen = false;
			} else if (target.requestFullscreen) {
				await target.requestFullscreen();
			} else {
				// Fallback (iOS Safari etc.): CSS class fills the viewport.
				pseudoFullscreen = true;
				isFullscreen = true;
			}
		} catch {
			// Permission denied or unsupported — silently ignore.
		}
	}

	onMount(() => {
		window.addEventListener('message', handleMessage);
		document.addEventListener('fullscreenchange', syncFullscreenState);

		if (analytics && src) {
			loadTimeoutId = setTimeout(() => {
				if (iframeLoaded) return;
				trackMiniappIframeLoadFailed({
					slug: analytics.slug,
					name: analytics.name,
					time_to_timeout_ms: iframeLoadTimeoutMs,
					is_offline: !navigator.onLine
				});
			}, iframeLoadTimeoutMs);
		}

		return () => {
			window.removeEventListener('message', handleMessage);
			document.removeEventListener('fullscreenchange', syncFullscreenState);
			if (loadTimeoutId !== null) {
				clearTimeout(loadTimeoutId);
				loadTimeoutId = null;
			}
		};
	});

	$effect(() => {
		if (wallet.connected) {
			postToIframe({ type: 'wallet_connected', address: wallet.address });
		} else {
			postToIframe({ type: 'wallet_disconnected' });
		}
	});

	function handleIframeLoad() {
		if (!iframeLoaded) {
			iframeLoaded = true;
			if (loadTimeoutId !== null) {
				clearTimeout(loadTimeoutId);
				loadTimeoutId = null;
			}
			if (analytics) {
				trackMiniappIframeLoaded({
					slug: analytics.slug,
					name: analytics.name,
					load_ms: Date.now() - mountedAt
				});
			}
		}
		if (wallet.connected) {
			postToIframe({ type: 'wallet_connected', address: wallet.address });
		}
		const raw = getAppData?.() ?? null;
		if (raw) {
			try {
				postToIframe({ type: 'app_data', data: atob(raw) });
			} catch {
				postToIframe({ type: 'app_data', data: raw });
			}
		}
	}
</script>

<svelte:window onclick={handleWindowClick} />

<div class="iframe-topbar">
	<div class="topbar-left">
		<button class="back-btn" onclick={onBack}>&#8592; {backLabel}</button>
		<AppNavigation />
		{#if title}<h1>{title}</h1>{/if}
	</div>
	<div class="header-right">
		{#if wallet.connected}
			<div
				class="user-chip"
				bind:this={chipEl}
				class:open={showLogout}
				onclick={openUserMenu}
				role="button"
				tabindex="0"
				onkeydown={(e) => e.key === 'Enter' && openUserMenu()}
			>
				<div class="avatar-img-wrap">
					{#if wallet.avatarImageUrl}
						<img class="avatar-img" src={wallet.avatarImageUrl} alt="avatar" />
					{:else}
						<span class="avatar-placeholder">{getAvatarInitial()}</span>
					{/if}
				</div>
				<span class="user-name">{wallet.avatarName || truncateAddr(wallet.address)}</span>
				{#if showLogout}
					<button
						class="logout-btn"
						onclick={(e) => { e.stopPropagation(); wallet.disconnect(); showLogout = false; }}
					>
						Log out
					</button>
				{/if}
			</div>
		{:else}
			<button
				class="connect-btn"
				onclick={() => wallet.connectAndPick()}
				disabled={wallet.connecting}
			>
				{#if wallet.connecting}
					<span class="btn-spinner"></span>
					Connecting...
				{:else}
					Sign in
				{/if}
			</button>
		{/if}
	</div>
</div>

{#if errorToast}
	<div class="error-toast" role="status">
		<span class="error-toast-dot"></span>
		<span>{errorToast}</span>
	</div>
{/if}

{@render beforeIframe?.()}

<div class="iframe-card" bind:this={cardEl} class:pseudo-fullscreen={pseudoFullscreen}>
	<Disclaimer {strongDisclaimer} />
	{#if isOffline && offlineState}
		{@render offlineState()}
	{:else if !src && emptyState}
		{@render emptyState()}
	{:else if src}
		<iframe bind:this={iframeEl} {src} {sandbox} {allow} title={iframeTitle} onload={handleIframeLoad}></iframe>
		<button
			type="button"
			class="fullscreen-btn"
			onclick={toggleFullscreen}
			aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
			title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
		>
			{#if isFullscreen}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M9 3v6H3" />
					<path d="M15 3v6h6" />
					<path d="M9 21v-6H3" />
					<path d="M15 21v-6h6" />
				</svg>
			{:else}
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M3 9V3h6" />
					<path d="M21 9V3h-6" />
					<path d="M3 15v6h6" />
					<path d="M21 15v6h-6" />
				</svg>
			{/if}
		</button>
	{/if}
</div>

{#if pendingRequest && pendingRequest.kind !== 'auth'}
	<ApprovalPopup
		request={pendingRequest}
		onapprove={handleApprove}
		onreject={handleReject}
	/>
{/if}

{#if pendingRequest?.kind === 'auth'}
	<AuthPopup mode="signup" app={appOrigin} onclose={handleAuthClose} />
{/if}

{#if blockedAction}
	<RestrictedActionPopup
		reason={blockedAction.reason}
		transactions={blockedAction.transactions}
		onclose={() => { blockedAction = null; }}
	/>
{/if}

<style>
	.topbar-left h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	/* Transient sign-in error toast, bottom-right. */
	.error-toast {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 10000;
		display: flex;
		align-items: center;
		gap: 9px;
		max-width: 340px;
		padding: 11px 14px;
		font-size: 13px;
		line-height: 1.35;
		color: #fff;
		background: rgba(20, 22, 40, 0.94);
		border-radius: 12px;
		box-shadow: 0 8px 28px rgba(6, 10, 64, 0.28);
		animation: toast-in 0.2s ease-out;
	}

	.error-toast-dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ff6b6b;
	}

	@keyframes toast-in {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.iframe-card {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		overflow: hidden;
		background: var(--card);
		min-height: 0;
		box-shadow: var(--shadow-card);
	}

	.iframe-card:fullscreen,
	.iframe-card.pseudo-fullscreen {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		max-width: none;
		max-height: none;
		margin: 0;
		padding: 0;
		border-radius: 0;
		border: none;
		box-shadow: none;
		background: var(--card);
		z-index: 9999;
	}

	.iframe-card:fullscreen iframe,
	.iframe-card.pseudo-fullscreen iframe {
		width: 100vw;
		height: 100vh;
		margin: 0;
		padding: 0;
	}

	iframe {
		flex: 1;
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}

	.fullscreen-btn {
		position: absolute;
		right: 12px;
		bottom: 12px;
		width: 36px;
		height: 36px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(6px);
		-webkit-backdrop-filter: blur(6px);
		color: var(--ink);
		cursor: pointer;
		box-shadow: var(--shadow-card, 0 2px 8px rgba(0, 0, 0, 0.08));
		opacity: 0.75;
		transition: opacity 0.15s, transform 0.15s, background 0.15s;
		z-index: 5;
	}

	.fullscreen-btn:hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.95);
	}

	.fullscreen-btn:active {
		transform: scale(0.95);
	}

	.fullscreen-btn:focus-visible {
		outline: 2px solid var(--accent, #0e00a8);
		outline-offset: 2px;
	}
</style>
