<script lang="ts">
	import { onDestroy } from 'svelte';
	import { SelfAppBuilder, getUniversalLink } from '@selfxyz/sdk-common';
	import { io, type Socket } from 'socket.io-client';
	import QRCode from 'qrcode';

	// Backend must expose:
	//   POST /api/verify        — called directly by Self Protocol with the ZK proof
	//                             Stores { invitationLink, error } keyed by userIdentifier (sessionId)
	//   GET  /api/result/:sessionId — returns { status: 'success', invitationLink } or
	//                                  { status: 'error', reason, alreadyClaimed?: true }

	const BACKEND_URL = import.meta.env.VITE_SELF_ONBOARDING_BACKEND_URL;
	const WS_RELAYER = 'wss://websocket.self.xyz';
	const SCOPE = 'circles-self-onboarding';

	type Step =
		| 'choose'
		| 'existing_placeholder'
		| 'idle'
		| 'connecting'
		| 'waiting_mobile'
		| 'mobile_connected'
		| 'generating_proof'
		| 'verified'
		| 'error';

	let step = $state<Step>('choose');
	let qrDataUrl = $state('');
	let invitationLink = $state('');
	let errorMsg = $state('');
	let alreadyClaimed = $state(false);
	let sessionId = $state('');

	// Non-reactive refs — socket and selfApp don't need to trigger re-renders
	let socket: Socket | null = null;
	let selfApp: ReturnType<InstanceType<typeof SelfAppBuilder>['build']> | null = null;
	let fetchingResult = false;
	let pollingTimer: ReturnType<typeof setInterval> | null = null;

	async function start() {
		step = 'connecting';
		errorMsg = '';
		alreadyClaimed = false;
		invitationLink = '';

		// Use the Web Crypto API (available in all modern browsers and SvelteKit SSR)
		sessionId = crypto.randomUUID();

		selfApp = new SelfAppBuilder({
			appName: 'Circles Self Onboarding',
			scope: SCOPE,
			endpoint: `${BACKEND_URL}/api/verify`,
			endpointType: 'staging_https', // staging_https → mock passports; change to 'https' for production
			devMode: true,                  // enables mock passport mode in the Self app
			userId: sessionId,
			userIdType: 'uuid',
			version: 2,
			disclosures: {
				minimumAge: 18,
				excludedCountries: [],
				ofac: false,
				expiry_date: true,
			},
		}).build();

		// With https/staging_https endpointType, the QR encodes the full selfApp config.
		// The Self app reads it and posts the proof directly to our endpoint.
		const universalLink = getUniversalLink({ ...selfApp, sessionId });

		qrDataUrl = await QRCode.toDataURL(universalLink, {
			errorCorrectionLevel: 'M',
			width: 280,
			margin: 2,
		});

		// Connect to Self's WebSocket relay
		socket = io(WS_RELAYER, {
			path: '/websocket',
			query: { sessionId, clientType: 'web' },
			transports: ['websocket'],
		});

		socket.on('connect', () => {
			step = 'waiting_mobile';
			// WS relay does not send mobile_status events in staging_https mode —
			// start polling immediately so we catch the result as soon as the backend writes it.
			startFallbackPoll();
		});

		socket.on('connect_error', (err: Error) => {
			errorMsg = `Connection failed: ${err.message}`;
			step = 'error';
		});

		socket.on('mobile_status', async (data: { status: string; reason?: string }) => {
			switch (data.status) {
				case 'mobile_connected':
					step = 'mobile_connected';
					break;
				case 'mobile_disconnected':
					// Only regress if we haven't already verified
					if (step !== 'verified') step = 'waiting_mobile';
					break;
				case 'proof_generation_started':
					step = 'generating_proof';
					break;
				case 'proof_generated':
					// With staging_https, Self posts to our backend directly after proof_generated.
					// proof_verified may or may not be sent — start polling now.
					step = 'generating_proof';
					await fetchResult();
					break;
				case 'proof_generation_failed':
					errorMsg = data.reason || 'Proof generation failed. Please try again.';
					step = 'error';
					break;
				case 'proof_verified':
					// Sent with celo/staging_celo flows; also poll here as a fallback.
					await fetchResult();
					break;
			}
		});
	}

	async function fetchResult() {
		if (fetchingResult) return; // prevent concurrent calls from proof_generated + proof_verified
		fetchingResult = true;

		// Retry for up to 10 seconds — our backend writes to SQLite synchronously
		// but there may be a small delay between Self's WS event and the HTTP call landing.
		const MAX_ATTEMPTS = 10;
		const DELAY_MS = 1000;

		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			try {
				const res = await fetch(`${BACKEND_URL}/api/result/${sessionId}`);
				const data = await res.json();

				if (data.status === 'pending') {
					// Not written yet — wait and retry
					await new Promise((r) => setTimeout(r, DELAY_MS));
					continue;
				}

				if (data.status === 'success' && data.invitationLink) {
					stopFallbackPoll();
					invitationLink = data.invitationLink;
					await generateInvitationQr(data.invitationLink);
					step = 'verified';
					return;
				}

				stopFallbackPoll();
				alreadyClaimed = data.alreadyClaimed === true;
				errorMsg = alreadyClaimed
					? 'This document was already used.'
					: (data.reason || 'Verification failed. Please try again.');
				step = 'error';
				return;
			} catch {
				if (attempt === MAX_ATTEMPTS - 1) {
					errorMsg = 'Failed to retrieve verification result. Please try again.';
					step = 'error';
				} else {
					await new Promise((r) => setTimeout(r, DELAY_MS));
				}
			}
		}

		// Exhausted retries
		errorMsg = 'Timed out waiting for verification result. Please try again.';
		step = 'error';
	}

	function startFallbackPoll() {
		if (pollingTimer) return; // already polling
		pollingTimer = setInterval(async () => {
			if (step === 'verified' || step === 'error') {
				stopFallbackPoll();
				return;
			}
			try {
				const res = await fetch(`${BACKEND_URL}/api/result/${sessionId}`);
				const data = await res.json();
				if (data.status === 'success' && data.invitationLink) {
					stopFallbackPoll();
					invitationLink = data.invitationLink;
					await generateInvitationQr(data.invitationLink);
					step = 'verified';
				} else if (data.status !== 'pending') {
					stopFallbackPoll();
					alreadyClaimed = data.alreadyClaimed === true;
					errorMsg = alreadyClaimed
						? 'This document was already used.'
						: (data.reason || 'Verification failed. Please try again.');
					step = 'error';
				}
			} catch {
				// ignore transient errors; fetchResult handles final timeout
			}
		}, 2000);
	}

	function stopFallbackPoll() {
		if (pollingTimer) {
			clearInterval(pollingTimer);
			pollingTimer = null;
		}
	}

	function reset() {
		if (socket) {
			socket.disconnect();
			socket = null;
		}
		stopFallbackPoll();
		selfApp = null;
		fetchingResult = false;
		step = 'choose';
		qrDataUrl = '';
		invitationLink = '';
		invitationQrDataUrl = '';
		errorMsg = '';
		alreadyClaimed = false;
		sessionId = '';
	}

	onDestroy(() => {
		if (socket) socket.disconnect();
		stopFallbackPoll();
	});

	let invitationQrDataUrl = $state('');

	async function generateInvitationQr(link: string) {
		invitationQrDataUrl = await QRCode.toDataURL(link, {
			errorCorrectionLevel: 'M',
			width: 240,
			margin: 2,
		});
	}

	// Derived helpers
	const showQr = $derived(step === 'waiting_mobile' || step === 'mobile_connected');
	const showSpinner = $derived(step === 'connecting' || step === 'generating_proof');
	// true when running on a mobile/tablet (touch) device
	const isMobile = $derived(
		typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
	);
</script>

<svelte:head>
	<title>Self Onboarding — Circles</title>
</svelte:head>

<div class="page">
	<div class="card">
		<!-- Header -->
		<div class="header">
			<h1 class="title">Get Your Circles Invitation</h1>
			<p class="subtitle">
				Verify your identity with the Self app to receive a personal invitation to Circles.
			</p>
		</div>

		<!-- Requirements list (always visible until verified) -->
		{#if step !== 'verified' && step !== 'choose' && step !== 'existing_placeholder'}
			<div class="requirements">
				<p class="req-label">Requirements</p>
				<ul class="req-list">
					<li>
						<span class="req-icon">✓</span>
						Valid passport or national ID
					</li>
					<li>
						<span class="req-icon">✓</span>
						18 years of age or older
					</li>
					<li>
						<span class="req-icon">✓</span>
						<a
							class="req-link"
							href="https://selfprotocol.xyz"
							target="_blank"
							rel="noopener noreferrer"
						>Self app</a> installed on your phone
					</li>
				</ul>
			</div>
		{/if}

		<!-- Data disclosure notice (shown before verification starts) -->
		{#if step === 'idle'}
			<div class="disclosure">
				<p class="disclosure-label">What is shared with Circles</p>
				<ul class="disclosure-list">
					<li>
						<span class="disclosure-icon check">✓</span>
						Age check <span class="disclosure-note">(18+, no date of birth stored)</span>
					</li>
					<li>
						<span class="disclosure-icon check">✓</span>
						Document expiry date
					</li>
					<li>
						<span class="disclosure-icon lock">⊘</span>
						Name, nationality, ID number <span class="disclosure-note">(not disclosed)</span>
					</li>
				</ul>
				<p class="disclosure-footer">
					Verification uses a zero-knowledge proof — your document never leaves your phone.
				</p>
			</div>
		{/if}

		<!-- ===== CHOOSE ===== -->
		{#if step === 'choose'}
			<div class="choose-grid">
				<button class="choice-btn" onclick={() => (step = 'idle')}>
					<span class="choice-icon">✦</span>
					<span class="choice-title">I'm new to Circles</span>
					<span class="choice-desc">I don't have a Circles account yet — verify my identity to get an invitation</span>
				</button>
				<button class="choice-btn choice-btn--muted" onclick={() => (step = 'existing_placeholder')}>
					<span class="choice-icon">⬡</span>
					<span class="choice-title">I'm already on Circles</span>
					<span class="choice-desc">I have a Circles account and want to join this group</span>
				</button>
			</div>
		{/if}

		<!-- ===== EXISTING USER PLACEHOLDER ===== -->
		{#if step === 'existing_placeholder'}
			<div class="placeholder-block">
				<div class="placeholder-icon">⬡</div>
				<h2 class="placeholder-title">Coming soon</h2>
				<p class="placeholder-desc">
					The flow for existing Circles members is being set up.<br />
					Please check back soon.
				</p>
				<button class="btn-secondary" onclick={() => (step = 'choose')}>
					Back
				</button>
			</div>
		{/if}

		<!-- ===== IDLE ===== -->
		{#if step === 'idle'}
			<button class="btn-primary" onclick={start}>
				Start Verification
			</button>
		{/if}

		<!-- ===== CONNECTING spinner ===== -->
		{#if showSpinner}
			<div class="spinner-block">
				<span class="spinner"></span>
				<span class="spinner-label">
					{step === 'connecting' ? 'Connecting…' : 'Generating your proof…'}
				</span>
			</div>
		{/if}

		<!-- ===== QR code (waiting / mobile connected) ===== -->
		{#if showQr && qrDataUrl}
			<div class="qr-block">
				<img class="qr-img" src={qrDataUrl} alt="Self app QR code" />

				{#if step === 'waiting_mobile'}
					<p class="qr-instruction">Scan with the <strong>Self app</strong></p>
					<p class="qr-hint">Open Self on your phone and tap the scan button</p>
				{:else}
					<div class="connected-badge">
						<span class="connected-dot"></span>
						Self app connected
					</div>
					<p class="qr-instruction">Follow the instructions in the Self app</p>
				{/if}
			</div>
		{/if}

		<!-- ===== SUCCESS ===== -->
		{#if step === 'verified'}
			<div class="success-block">
				<div class="success-icon">✓</div>
				<h2 class="success-title">Identity Verified!</h2>
				<p class="success-desc">Your personal invitation to Circles is ready.</p>

				{#if isMobile}
					<!-- On mobile: prominent button that opens the link directly -->
					<a
						class="btn-primary join-btn"
						href={invitationLink}
						rel="noopener noreferrer"
					>
						Join Circles
						<span class="link-arrow">→</span>
					</a>
				{:else}
					<!-- On desktop: show QR to scan on phone + a plain link to open on this device -->
					<p class="desktop-hint">Scan with your phone to join Circles</p>
					{#if invitationQrDataUrl}
						<img class="invitation-qr" src={invitationQrDataUrl} alt="Invitation QR code" />
					{/if}
					<p class="desktop-or">or</p>
					<a
						class="btn-secondary"
						href={invitationLink}
						target="_blank"
						rel="noopener noreferrer"
					>
						Open on this device
					</a>
				{/if}

				<p class="invitation-url">{invitationLink}</p>
			</div>
		{/if}

		<!-- ===== ERROR ===== -->
		{#if step === 'error'}
			<div class="error-block">
				{#if alreadyClaimed}
					<div class="error-icon">⚠</div>
					<p class="error-msg">{errorMsg}</p>
					<p class="error-hint">
						Each identity can only claim one invitation. If you believe this is a mistake,
						please contact support.
					</p>
				{:else}
					<div class="error-icon">✕</div>
					<p class="error-msg">{errorMsg}</p>
				{/if}
				{#if !alreadyClaimed}
					<button class="btn-primary" onclick={reset}>
						Try Again
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		background: #f0e8dc;
		color: #060a40;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	.page {
		min-height: 100vh;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 48px 16px 80px;
		box-sizing: border-box;
		background: #f0e8dc;
	}

	.card {
		background: #faf5f1;
		border-radius: 24px;
		box-shadow: 0 8px 40px rgba(6, 10, 64, 0.12);
		max-width: 420px;
		width: 100%;
		padding: 32px 28px;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	/* ----- Header ----- */
	.header {
		text-align: center;
	}

	.title {
		margin: 0 0 10px;
		font-size: 1.45rem;
		font-weight: 800;
		color: #060a40;
		line-height: 1.2;
	}

	.subtitle {
		margin: 0;
		font-size: 0.92rem;
		color: #6a6c8c;
		line-height: 1.5;
	}

	/* ----- Requirements ----- */
	.requirements {
		background: #f5f0eb;
		border: 1.5px solid #ede1d8;
		border-radius: 14px;
		padding: 16px 18px;
	}

	.req-label {
		margin: 0 0 10px;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #9b9db3;
	}

	.req-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.req-list li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.88rem;
		color: #060a40;
	}

	.req-icon {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: #3a3f7a;
		color: #ffffff;
		font-size: 0.72rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.req-link {
		color: #3a3f7a;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* ----- Disclosure notice ----- */
	.disclosure {
		background: #f5f0eb;
		border: 1.5px solid #ede1d8;
		border-radius: 14px;
		padding: 14px 18px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.disclosure-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #9b9db3;
	}

	.disclosure-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.disclosure-list li {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.88rem;
		color: #060a40;
	}

	.disclosure-icon {
		width: 20px;
		height: 20px;
		border-radius: 50%;
		font-size: 0.72rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.disclosure-icon.check {
		background: #3a3f7a;
		color: #ffffff;
	}

	.disclosure-icon.lock {
		background: #e5e7eb;
		color: #9b9db3;
		font-size: 0.8rem;
	}

	.disclosure-note {
		color: #9b9db3;
		font-size: 0.82rem;
	}

	.disclosure-footer {
		margin: 0;
		font-size: 0.78rem;
		color: #9b9db3;
		line-height: 1.5;
		border-top: 1px solid #ede1d8;
		padding-top: 10px;
	}

	/* ----- Primary button ----- */
	.btn-primary {
		width: 100%;
		padding: 14px 20px;
		background: #3a3f7a;
		color: #ffffff;
		border: none;
		border-radius: 14px;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
		transition: opacity 0.15s;
		letter-spacing: 0.01em;
	}

	.btn-primary:hover {
		opacity: 0.85;
	}

	.btn-primary:active {
		opacity: 0.7;
	}

	/* ----- Spinner ----- */
	.spinner-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 12px 0;
	}

	.spinner {
		display: inline-block;
		width: 36px;
		height: 36px;
		border: 3px solid #ede1d8;
		border-top-color: #3a3f7a;
		border-radius: 50%;
		animation: spin 0.75s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.spinner-label {
		font-size: 0.9rem;
		color: #6a6c8c;
	}

	/* ----- QR block ----- */
	.qr-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
	}

	.qr-img {
		width: 240px;
		height: 240px;
		border-radius: 14px;
		border: 2px solid #ede1d8;
		display: block;
	}

	.qr-instruction {
		margin: 0;
		font-size: 0.95rem;
		color: #060a40;
		text-align: center;
	}

	.qr-hint {
		margin: 0;
		font-size: 0.82rem;
		color: #9b9db3;
		text-align: center;
	}

	.connected-badge {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #eafaf1;
		border: 1.5px solid #6ee7a8;
		border-radius: 999px;
		padding: 6px 14px;
		font-size: 0.84rem;
		font-weight: 600;
		color: #166534;
	}

	.connected-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #22c55e;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	/* ----- Success ----- */
	.success-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
	}

	.success-icon {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: #3a3f7a;
		color: #ffffff;
		font-size: 1.6rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.success-title {
		margin: 0;
		font-size: 1.25rem;
		font-weight: 800;
		color: #060a40;
	}

	.success-desc {
		margin: 0;
		font-size: 0.9rem;
		color: #6a6c8c;
	}

	.join-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		text-decoration: none;
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.01em;
		padding: 14px 28px;
		border-radius: 14px;
		background: #3a3f7a;
		color: #ffffff;
		transition: opacity 0.15s;
		margin-top: 4px;
	}

	.join-btn:hover {
		opacity: 0.85;
	}

	.desktop-hint {
		margin: 0;
		font-size: 0.9rem;
		color: #6a6c8c;
	}

	.invitation-qr {
		width: 200px;
		height: 200px;
		border-radius: 12px;
		border: 2px solid #ede1d8;
		display: block;
	}

	.desktop-or {
		margin: 0;
		font-size: 0.82rem;
		color: #9b9db3;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.btn-secondary {
		display: inline-block;
		padding: 10px 22px;
		border: 2px solid #3a3f7a;
		border-radius: 12px;
		color: #3a3f7a;
		font-size: 0.9rem;
		font-weight: 600;
		text-decoration: none;
		transition: background 0.15s, color 0.15s;
	}

	.btn-secondary:hover {
		background: #3a3f7a;
		color: #ffffff;
	}

	.invitation-url {
		margin: 0;
		font-size: 0.75rem;
		color: #9b9db3;
		word-break: break-all;
	}

	/* ----- Error ----- */
	.error-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
	}

	.error-icon {
		width: 48px;
		height: 48px;
		border-radius: 50%;
		background: #fef2f2;
		border: 2px solid #fca5a5;
		color: #dc2626;
		font-size: 1.3rem;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.error-msg {
		margin: 0;
		font-size: 0.92rem;
		color: #991b1b;
		font-weight: 600;
	}

	.error-hint {
		margin: 0;
		font-size: 0.82rem;
		color: #6a6c8c;
		line-height: 1.5;
		max-width: 300px;
	}

	/* ----- Choose grid ----- */
	.choose-grid {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.choice-btn {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 20px 18px;
		background: #ffffff;
		border: 1.5px solid #ede1d8;
		border-radius: 16px;
		cursor: pointer;
		text-align: left;
		transition: border-color 0.15s, background 0.15s;
		width: 100%;
	}

	.choice-btn:hover {
		border-color: #3a3f7a;
		background: #f5f0eb;
	}

	.choice-btn--muted {
		opacity: 0.6;
	}

	.choice-icon {
		font-size: 20px;
		line-height: 1;
		color: #060a40;
	}

	.choice-title {
		font-size: 0.95rem;
		font-weight: 700;
		color: #060a40;
	}

	.choice-desc {
		font-size: 0.82rem;
		color: #6a6c8c;
		line-height: 1.5;
	}

	/* ----- Existing placeholder ----- */
	.placeholder-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
		padding: 8px 0;
	}

	.placeholder-icon {
		font-size: 40px;
		color: #9b9db3;
		line-height: 1;
	}

	.placeholder-title {
		margin: 0;
		font-size: 1.15rem;
		font-weight: 700;
		color: #060a40;
	}

	.placeholder-desc {
		margin: 0;
		font-size: 0.88rem;
		color: #6a6c8c;
		line-height: 1.6;
	}
</style>
