<script lang="ts">
	/**
	 * /crc-signin — Circles wallet bridge, designed to be embedded as an iframe
	 * into any third-party website.
	 *
	 * This is the mirror image of the /miniapps host: there, the Circles shell is
	 * the parent and the mini-app is the iframe child. Here, the THIRD-PARTY site
	 * is the parent and Circles is the iframe child. The third-party page requests
	 * an address / signature / transaction (via @aboutcircles/miniapp-sdk or raw
	 * postMessage) and this page connects the user's Circles wallet (passkey) and
	 * proxies the request, showing an approval UI for anything that signs or spends.
	 *
	 * The wire protocol is identical to the miniapp host protocol, so the existing
	 * miniapp-sdk works against this page unchanged — but any site can speak it with
	 * plain postMessage.
	 *
	 * SECURITY / ACTIVATION: this route only activates inside an iframe. Opened
	 * directly (window.parent === window) it renders an inert "must be embedded"
	 * notice and registers no message listeners and no wallet connection.
	 */
	import { onMount } from 'svelte';
	import { wallet } from '$lib/wallet.svelte.ts';
	import ApprovalPopup from '$lib/ApprovalPopup.svelte';
	import AuthPopup from '$lib/AuthPopup.svelte';
	import {
		truncateAddr,
		getAvatarInitial as _getAvatarInitial,
		createMessageHandler,
		createApprovalHandlers,
		postTo,
		type PendingRequest
	} from '$lib/iframeHost.ts';
	import { isAllowedEmbedder } from '$lib/crcSigninAllowlist.ts';

	const baseUrl = import.meta.env.VITE_BASE_URL;

	// Determined on mount (window is unavailable during prerender / SSR is off but
	// the prerendered HTML must still be inert until the client decides).
	let embedded = $state(false);
	let ready = $state(false);

	// Whether the embedding parent is on the allowlist. When false (embedded by an
	// unauthorized site) the connector renders a "not authorized" notice, never
	// connects a wallet, and ignores every postMessage. This is the in-page layer;
	// the airtight control is the `frame-ancestors` CSP header on the server.
	let authorized = $state(false);
	// The verified embedder origin, learned from the first allowlisted postMessage
	// (event.origin is browser-set and unforgeable, unlike document.referrer).
	let verifiedOrigin = $state<string | null>(null);
	// After mount we wait briefly for an allowlisted message before declaring the
	// embedder unauthorized — referrer may be stripped, so a legit parent can still
	// prove itself via request_address within the grace window.
	let authGraceElapsed = $state(false);

	let pendingRequest: PendingRequest | null = $state(null);
	// Kept outside $state so Svelte never proxies the cross-origin Window object.
	let pendingSource: MessageEventSource | null = null;

	// User-initiated signup popup (the "Create account" button), distinct from the
	// parent-initiated `request_create_account` flow tracked by pendingRequest. Signup
	// mints a new passkey + Safe and needs a name input, so it keeps a dedicated popup.
	// "Sign in with Circles" does NOT use this — it logs in directly via the native
	// passkey prompt (handleSignIn), with no intermediate popup.
	let authMode = $state<'signup' | null>(null);

	let errorToast = $state<string | null>(null);
	$effect(() => {
		const err = wallet.connectionError;
		if (err && !wallet.connected) {
			errorToast = err;
			const t = setTimeout(() => (errorToast = null), 5000);
			return () => clearTimeout(t);
		}
	});

	const getAvatarInitial = () => _getAvatarInitial(wallet.avatarName, wallet.address);

	// The embedding site's origin — used as the account-creation attribution tag
	// and shown to the user so they know who is asking to connect. document.referrer
	// is the only cross-origin hint we have about the parent.
	const parentOrigin = $derived.by(() => {
		// Prefer the origin verified from a trusted postMessage; fall back to the
		// referrer only for display before the first message arrives.
		if (verifiedOrigin) return verifiedOrigin;
		if (typeof document === 'undefined') return 'this site';
		try {
			return document.referrer ? new URL(document.referrer).origin : 'this site';
		} catch {
			return 'this site';
		}
	});

	// Best-effort referrer origin for the pre-message authorization gate. Note this
	// is advisory only (referrer can be stripped); the per-message event.origin check
	// in handleMessage is the real gate, and `frame-ancestors` is the hard one.
	function referrerOrigin(): string | null {
		if (typeof document === 'undefined' || !document.referrer) return null;
		try {
			return new URL(document.referrer).origin;
		} catch {
			return null;
		}
	}

	const baseHandleMessage = createMessageHandler({
		// crc-signin has no host-provided ?data= payload to forward.
		getAppData: () => null,
		setPending: (req) => { pendingRequest = req; },
		setPendingSource: (s) => { pendingSource = s; }
	});

	// Origin-gated message handler. event.origin is set by the browser and cannot be
	// forged by the parent, so this is the authoritative per-message allowlist check —
	// we never act on a request from a non-allowlisted embedder.
	function handleMessage(event: MessageEvent) {
		const data = event.data;
		if (!isAllowedEmbedder(event.origin)) {
			// The embedder isn't allowlisted. Never connect a wallet or sign anything.
			// But if the message is a request the parent is awaiting (it carries a
			// requestId), reply with an explicit rejection instead of leaving it to
			// hang forever — the requestId is the parent's own, so we leak nothing.
			// Plain discovery pings (request_address with no requestId) are dropped
			// silently so a hostile site can't even tell the connector is alive.
			if (data && data.requestId && typeof data.type === 'string') {
				const rejectType =
					data.type === 'send_transactions' ? 'tx_rejected'
					: data.type === 'sign_message' ? 'sign_rejected'
					: data.type === 'request_create_account' ? 'auth_rejected'
					: null;
				if (rejectType) {
					postTo(event.source, {
						type: rejectType,
						reason: 'This site is not authorized to use Circles sign-in',
						requestId: data.requestId
					});
				}
			}
			console.warn(
				`[crc-signin] Blocked message from non-allowlisted origin: ${event.origin}. ` +
					`Add it to ALLOWED_EMBEDDER_ORIGINS in src/lib/crcSigninAllowlist.ts to permit it.`
			);
			return;
		}
		// First trusted message confirms the real embedder origin and flips the UI on.
		if (!authorized) {
			authorized = true;
			verifiedOrigin = event.origin;
			// A parent that connected before we authorized may have missed our state;
			// re-announce so its SDK/listener resyncs.
			postTo(window.parent, { type: 'crc_bridge_ready' });
		}

		// Parent-initiated logout. The host can't reach the wallet directly, so it
		// asks us to drop the session. We must clear the SAVED session (not just the
		// in-memory connection) — otherwise the one-shot restore effect below, or a
		// host that reloads the iframe, would immediately auto-connect again. After
		// wallet.disconnect() the connected-state effect posts `wallet_disconnected`
		// to the parent, and manuallyDisconnected blocks any further auto-restore in
		// this page instance.
		if (data.type === 'disconnect') {
			didAttemptRestore = true; // belt-and-suspenders: never auto-restore after an explicit logout
			wallet.disconnect();
			return;
		}

		baseHandleMessage(event);
	}

	const approvalHandlers = createApprovalHandlers({
		getPending: () => pendingRequest,
		getPendingSource: () => pendingSource,
		setPending: (req) => { pendingRequest = req; },
		setPendingSource: (s) => { pendingSource = s; }
	});

	// Resolve a parent-initiated 'request_create_account' when the AuthPopup closes.
	function handleAuthClose() {
		const req = pendingRequest;
		if (req?.kind === 'auth') {
			if (wallet.connected) {
				postTo(pendingSource, { type: 'auth_success', address: wallet.address, requestId: req.requestId });
			} else {
				postTo(pendingSource, { type: 'auth_rejected', reason: 'User cancelled', requestId: req.requestId });
			}
		}
		pendingRequest = null;
		pendingSource = null;
	}

	// "Sign in with Circles": trigger the passkey login directly — no intermediate
	// login popup. connectAndPick() fires the native passkey prompt and then shows
	// the child-safe picker. Errors surface via the existing errorToast effect; on
	// failure we run the iframe passkey diagnostic to explain WHY in the console.
	async function handleSignIn() {
		await wallet.connectAndPick();
		if (!wallet.connected) {
			// Login failed (commonly RetrieveWalletFromPasskeyError). Cometh masks the
			// real DOMException, so probe navigator.credentials.get() directly to reveal
			// WHY: a Permissions-Policy block in the iframe vs. no passkey for this origin.
			diagnosePasskeyFailure();
		}
	}

	// Close the user-initiated signup popup. On success, run the child-safe picker
	// (AuthPopup's flow doesn't, unlike connectAndPick).
	function handleUserAuthClose() {
		const justConnected = wallet.connected;
		authMode = null;
		if (justConnected) {
			wallet.autoConnectAndPick();
		}
	}

	/**
	 * DIAGNOSTIC (safe to remove): figure out why passkey login failed in this iframe.
	 *
	 * Cometh's retrieveAccountAddressFromPasskeys() catches every error and re-throws a
	 * generic RetrieveWalletFromPasskeyError, hiding whether the cause was:
	 *   - the embedding page not delegating `publickey-credentials-get` (Permissions-Policy),
	 *   - no credential registered for this origin's RP ID (e.g. running on localhost), or
	 *   - the user dismissing/aborting the native prompt.
	 *
	 * We re-run navigator.credentials.get() once with a throwaway challenge purely to read
	 * the underlying DOMException.name and log a clear explanation. This never connects a
	 * wallet — it only surfaces the real reason in the iframe console.
	 */
	async function diagnosePasskeyFailure() {
		// Feature-detect the Permissions-Policy allowlist when the browser exposes it.
		try {
			const fp = (document as any).featurePolicy;
			if (fp?.allowsFeature) {
				const allowed = fp.allowsFeature('publickey-credentials-get');
				console.info(
					`[crc-signin] Permissions-Policy: publickey-credentials-get ${allowed ? 'ALLOWED' : 'BLOCKED'} in this frame.` +
						(allowed ? '' : ' The embedding page must set allow="publickey-credentials-get *" on the iframe.')
				);
			}
		} catch {
			/* featurePolicy not available — fall through to the live probe */
		}

		if (!navigator.credentials || !window.PublicKeyCredential) {
			console.warn('[crc-signin] WebAuthn API unavailable (insecure context? credentials require HTTPS or localhost).');
			return;
		}

		try {
			await navigator.credentials.get({
				publicKey: {
					challenge: new Uint8Array(32),
					// rpId defaults to this document's effective domain; that's exactly the
					// origin binding we want to test (the connector's own origin).
					userVerification: 'preferred',
					timeout: 8000
				}
			});
			// Resolving here is unexpected for a "failed login" path, but harmless.
			console.info('[crc-signin] Probe: navigator.credentials.get resolved — credential exists for this origin.');
		} catch (e: any) {
			const name = e?.name ?? 'Error';
			let why: string;
			if (name === 'NotAllowedError') {
				why =
					'NotAllowedError — either the iframe lacks the `publickey-credentials-get` Permissions-Policy ' +
					'(embedding page must add allow="publickey-credentials-get *"), OR no passkey exists for this ' +
					`origin's RP ID (${location.hostname}). A passkey created on another domain (e.g. circles-dev.gnosis.io) ` +
					'is NOT offered here.';
			} else if (name === 'SecurityError') {
				why = `SecurityError — RP ID / origin mismatch, or insecure context. Origin: ${location.origin}.`;
			} else if (name === 'AbortError') {
				why = 'AbortError — the native passkey prompt was dismissed or timed out.';
			} else {
				why = `${name}: ${e?.message ?? e}`;
			}
			console.warn(`[crc-signin] Passkey login diagnostic → ${why}`);
		}
	}

	onMount(() => {
		// Activation gate: only behave as a wallet bridge when actually embedded.
		embedded = window.parent !== window.self;
		ready = true;
		if (!embedded) return;

		// Preliminary authorization from the referrer so the "not authorized" notice
		// can render immediately for an obviously-disallowed embedder. This is only
		// advisory — handleMessage re-checks every message against the unforgeable
		// event.origin, and that is what actually gates wallet operations.
		const ref = referrerOrigin();
		if (ref && isAllowedEmbedder(ref)) {
			authorized = true;
			verifiedOrigin = ref;
		}

		window.addEventListener('message', handleMessage);

		// Announce our presence so the parent (re)issues request_address — that message
		// carries the trusted event.origin we authorize against. We do NOT restore a
		// saved session or auto-connect until an allowlisted message confirms the
		// embedder, so an unauthorized parent can never silently read a connected address.
		postTo(window.parent, { type: 'crc_bridge_ready' });

		// Grace window: a legit embedder whose referrer was stripped still proves
		// itself when its request_address arrives. If nothing allowlisted arrives in
		// time, show the "not authorized" notice.
		const graceTimer = setTimeout(() => { authGraceElapsed = true; }, 2500);

		return () => {
			window.removeEventListener('message', handleMessage);
			clearTimeout(graceTimer);
		};
	});

	// Restore an existing session only once we trust the embedder. We never force a
	// passkey prompt on mount — the user must click "Log in" — so a hostile parent
	// can't trigger an unsolicited wallet dialog even after authorization.
	//
	// This must fire AT MOST ONCE. Without the guard the effect re-runs every time
	// wallet.connected toggles; if a transaction's passkey signing momentarily drops
	// the connection, the effect would re-trigger autoConnect mid-flow and the user
	// would be bounced back to the sign-in screen after approving. One-shot restore
	// avoids that race — explicit user actions (Sign in / Logout) handle the rest.
	let didAttemptRestore = false;
	$effect(() => {
		if (didAttemptRestore) return;
		if (authorized && !wallet.connected && !wallet.connecting && wallet.getSavedSafeAddress()) {
			didAttemptRestore = true;
			wallet.autoConnect();
		}
	});

	// Push connection state to the parent whenever it changes — mirrors how the
	// miniapp host keeps the embedded SDK's _address in sync. Gated on `authorized`
	// so an unallowlisted embedder is never told the connected address.
	$effect(() => {
		if (!embedded || !authorized) return;
		if (wallet.connected) {
			postTo(window.parent, { type: 'wallet_connected', address: wallet.address });
		} else {
			postTo(window.parent, { type: 'wallet_disconnected' });
		}
	});
</script>

<svelte:head>
	<title>Sign in with Circles{baseUrl ? ` - ${baseUrl}` : ''}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

{#if !ready}
	<!-- Brief pre-mount blank; avoids flashing the inactive notice before we know. -->
	<div class="shell"></div>
{:else if !embedded}
	<div class="shell inactive">
		<div class="inactive-card">
			<div class="brand">
				<span class="brand-mark">○</span>
				<span class="brand-text">Circles</span>
			</div>
			<h1>This page must be embedded</h1>
			<p>
				<code>/crc-signin</code> is a wallet connector meant to be loaded inside an
				<code>&lt;iframe&gt;</code> by a third-party site. Opened on its own it does nothing.
			</p>
			<p class="hint">
				Embed it with:
			</p>
			<pre class="snippet">&lt;iframe src="{baseUrl || 'https://circles-dev.gnosis.io'}/crc-signin"
        allow="publickey-credentials-get *; publickey-credentials-create *"&gt;
&lt;/iframe&gt;</pre>
		</div>
	</div>
{:else if !authorized && !authGraceElapsed}
	<!-- Embedded, waiting to verify the embedder via its first trusted message. -->
	<div class="shell embedded compact">
		<div class="verify-spinner"></div>
	</div>
{:else if !authorized}
	<!-- Embedded by a site that is NOT on the allowlist. Stay completely inert. -->
	<div class="shell embedded">
		<div class="connector">
			<p class="notice-title">Site not authorized</p>
			<p class="sub">This website isn&apos;t authorized to use Circles sign-in.</p>
		</div>
	</div>
{:else if wallet.connected}
	<!-- Connected: avatar + name + logout, all on one row in a single block. -->
	<div class="shell embedded compact">
		<div class="account-row">
			<span class="avatar-img-wrap">
				{#if wallet.avatarImageUrl}
					<img class="avatar-img" src={wallet.avatarImageUrl} alt="" />
				{:else}
					<span class="avatar-placeholder">{getAvatarInitial()}</span>
				{/if}
			</span>
			<span class="account-name">{wallet.avatarName || truncateAddr(wallet.address)}</span>
			<button class="logout-btn" onclick={() => wallet.disconnect()}>Logout</button>
		</div>
	</div>
{:else}
	<!-- Signed out: minimal sign-in. -->
	<div class="shell embedded">
		<div class="connector">
			<button
				class="btn btn-primary"
				onclick={handleSignIn}
				disabled={wallet.connecting}
			>
				{#if wallet.connecting}
					<span class="btn-spinner"></span>
					Connecting…
				{:else}
					Sign in with Circles
				{/if}
			</button>
			<button
				class="btn btn-secondary"
				onclick={() => (authMode = 'signup')}
				disabled={wallet.connecting}
			>
				Create account
			</button>
		</div>
	</div>
{/if}

{#if errorToast}
	<div class="error-toast" role="status">
		<span class="error-toast-dot"></span>
		<span>{errorToast}</span>
	</div>
{/if}

{#if pendingRequest && pendingRequest.kind !== 'auth'}
	<ApprovalPopup
		request={pendingRequest}
		onapprove={approvalHandlers.handleApprove}
		onreject={approvalHandlers.handleReject}
		fullPage
	/>
{/if}

{#if pendingRequest?.kind === 'auth'}
	<AuthPopup mode="signup" app={parentOrigin} onclose={handleAuthClose} fullPage />
{/if}

{#if authMode === 'signup'}
	<AuthPopup mode="signup" app={parentOrigin} onclose={handleUserAuthClose} fullPage />
{/if}

<style>
	.shell {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 12px;
		box-sizing: border-box;
		background: transparent;
	}

	/* Compact states (connected pill, verifying) sit flush — no card chrome — so they
	   drop cleanly into a short iframe of any width. */
	.shell.compact {
		min-height: 0;
		height: 100vh;
		gap: 10px;
		flex-wrap: wrap;
	}

	.connector,
	.inactive-card {
		width: 100%;
		max-width: 340px;
		display: flex;
		flex-direction: column;
		gap: 9px;
	}

	.inactive-card {
		max-width: 480px;
		gap: 12px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: var(--radius-card);
		box-shadow: var(--shadow-card);
		padding: 24px 22px;
		text-align: left;
	}

	.inactive-card .brand {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}

	.inactive-card .brand-mark {
		font-size: 18px;
		color: var(--accent, #0e00a8);
	}

	.inactive-card .brand-text {
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--ink);
	}

	.inactive-card h1 {
		margin: 0;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	.notice-title {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--ink);
		text-align: center;
	}

	.sub {
		margin: 0;
		font-size: 13px;
		line-height: 1.5;
		color: var(--muted);
		text-align: center;
	}

	.btn {
		width: 100%;
		padding: 12px 16px;
		border: none;
		border-radius: var(--radius-pill);
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		white-space: nowrap;
	}

	.btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.btn:hover:not(:disabled) {
		opacity: 0.88;
	}

	.btn-primary {
		background: linear-gradient(130deg, var(--accent), var(--accent-mid));
		color: #fff;
	}

	.btn-secondary {
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--line);
	}

	/* Connected account row — avatar + name + logout, all in one row, one block. */
	.account-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		max-width: 340px;
		padding: 6px 6px 6px 6px;
		background: var(--card);
		border: 1px solid var(--line);
		border-radius: 999px;
		box-shadow: var(--shadow-card, 0 2px 10px rgba(6, 10, 64, 0.08));
		min-width: 0;
		flex-wrap: nowrap;
	}

	.avatar-img-wrap {
		width: 38px;
		height: 38px;
		flex: none;
		border-radius: 50%;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--accent-soft, rgba(14, 0, 168, 0.08));
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-placeholder {
		font-size: 15px;
		font-weight: 600;
		color: var(--accent, #0e00a8);
	}

	.account-name {
		flex: 1 1 auto;
		font-size: 16px;
		font-weight: 600;
		color: var(--ink);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}

	.logout-btn {
		flex: none;
		padding: 8px 14px;
		border: 1px solid var(--line);
		border-radius: 999px;
		background: var(--card);
		color: var(--muted);
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.logout-btn:hover {
		color: var(--ink);
		border-color: var(--muted);
	}

	.btn-spinner {
		width: 15px;
		height: 15px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		display: inline-block;
	}

	.verify-spinner {
		width: 22px;
		height: 22px;
		margin: 10px auto 0;
		border: 2px solid var(--line);
		border-top-color: var(--accent, #0e00a8);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* Inactive notice */
	.inactive-card p {
		margin: 0 0 12px;
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted);
	}

	.inactive-card .hint {
		margin-bottom: 6px;
	}

	code {
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 12px;
		background: rgba(0, 0, 0, 0.05);
		padding: 1px 5px;
		border-radius: 5px;
		color: var(--ink);
	}

	.snippet {
		margin: 0;
		padding: 12px 14px;
		background: rgba(5, 6, 26, 0.92);
		color: #e7e9ff;
		border-radius: var(--radius-sm, 10px);
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 11.5px;
		line-height: 1.5;
		overflow-x: auto;
		white-space: pre;
	}

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
	}

	.error-toast-dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ff6b6b;
	}
</style>
