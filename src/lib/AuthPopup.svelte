<script lang="ts">
	import { onDestroy } from 'svelte';
	import { wallet } from './wallet.svelte';
	import { createPasskeySafe, inviteAccount, confirmRegistered } from './onboarding.svelte';

	let {
		mode,
		onclose,
		app
	}: {
		mode: 'login' | 'signup';
		onclose: () => void;
		/** Attribution tag (miniapp origin) forwarded to the invite backend. */
		app?: string;
	} = $props();

	type Step = 'idle' | 'working' | 'success' | 'error';

	let step = $state<Step>('idle');
	let errorMsg = $state<string>('');
	let userName = $state<string>(''); // chosen display name (not unique)

	// While 'working' the × is briefly disabled so a stray click (or a
	// password-manager dialog stealing/returning focus) can't nuke an in-flight
	// passkey prompt. After this grace period the user can always escape — a hung
	// passkey (e.g. a password manager that never returns a credential) must never
	// trap them in an un-closable spinner.
	const CLOSE_GRACE_MS = 4000;
	// Hard ceiling: if creation never resolves, surface a closeable error instead
	// of spinning forever. Slightly above WebAuthn's own 60s timeout.
	const WORK_TIMEOUT_MS = 75000;

	let canCancel = $state(false); // grace period elapsed → escape allowed
	let cancelled = false; // user bailed mid-flight; ignore any late resolution
	let graceTimer: ReturnType<typeof setTimeout> | null = null;
	let workTimer: ReturnType<typeof setTimeout> | null = null;

	// Sub-status shown during longer phases (e.g. confirming Circles registration).
	let workNote = $state<string>('');

	// One friendly, jargon-free line for the whole creation flow.
	const workingLabel = $derived(
		workNote
			? workNote
			: mode === 'login'
				? 'Waiting for your passkey…'
				: 'Creating your Circles account…'
	);

	function beginWork() {
		step = 'working';
		errorMsg = '';
		workNote = '';
		cancelled = false;
		canCancel = false;
		if (graceTimer) clearTimeout(graceTimer);
		if (workTimer) clearTimeout(workTimer);
		graceTimer = setTimeout(() => (canCancel = true), CLOSE_GRACE_MS);
		workTimer = setTimeout(() => {
			if (step === 'working' && !cancelled) {
				errorMsg =
					'This is taking longer than expected. Your passkey prompt may not have completed — please try again.';
				step = 'error';
			}
		}, WORK_TIMEOUT_MS);
	}

	function endWork() {
		if (graceTimer) clearTimeout(graceTimer);
		if (workTimer) clearTimeout(workTimer);
		graceTimer = null;
		workTimer = null;
	}

	async function onLogin() {
		beginWork();
		try {
			await wallet.connectWithPasskey();
			if (cancelled) return;
			if (wallet.connected) {
				step = 'success';
			} else {
				errorMsg = wallet.connectionError || 'Login was cancelled.';
				step = 'error';
			}
		} catch (e: any) {
			if (!cancelled) {
				errorMsg = e?.message ?? String(e);
				step = 'error';
			}
		} finally {
			endWork();
		}
	}

	async function onSignup() {
		const name = userName.trim();
		if (!name) {
			errorMsg = 'Please enter a name.';
			step = 'error';
			return;
		}
		beginWork();
		try {
			const { safeAddress, smartAccountClient } = await createPasskeySafe(name);
			if (cancelled) return;

			// Invite the new account into Circles. This is REQUIRED — we only show
			// success once the account is actually registered in Circles, not just
			// because the Safe was created.
			const invite = await inviteAccount(safeAddress, app);
			if (cancelled) return;
			if (invite.status !== 'invited' && invite.status !== 'already') {
				throw new Error(
					invite.error
						? `Couldn't register your account in Circles: ${invite.error}`
						: "Couldn't register your account in Circles. Please try again."
				);
			}

			// Confirm on-chain that the account is now a registered Circles human
			// before declaring success (the invite tx may need a moment to settle).
			workNote = 'Registering you in Circles…';
			const registered = await confirmRegistered(safeAddress);
			if (cancelled) return;
			if (!registered) {
				throw new Error(
					'Your account was set up but is not yet registered in Circles. Please try again in a moment.'
				);
			}

			// Log in by ADOPTING the client we already built — no second passkey
			// prompt (vs. wallet.connect(), which re-derives from the passkey).
			wallet.adoptSmartAccount(smartAccountClient, safeAddress);
			if (cancelled) return;
			step = 'success';
		} catch (e: any) {
			if (!cancelled) {
				errorMsg = e?.message ?? String(e);
				step = 'error';
			}
		} finally {
			endWork();
		}
	}

	function start() {
		if (mode === 'login') onLogin();
		else onSignup();
	}

	function retry() {
		endWork();
		step = 'idle';
		errorMsg = '';
		canCancel = false;
	}

	// Bail out of an in-progress flow: stop waiting on the (possibly hung) passkey
	// promise and close. A late resolution is ignored via the `cancelled` flag.
	function cancelWork() {
		cancelled = true;
		endWork();
		onclose();
	}

	// Closing is allowed when not working, OR while working once the grace period
	// has elapsed (so a stuck passkey prompt can never trap the user).
	const closeable = $derived(step !== 'working' || canCancel);

	function requestClose() {
		if (step === 'working') {
			if (canCancel) cancelWork();
			return;
		}
		onclose();
	}

	const title = $derived(mode === 'login' ? 'Log in' : 'Create your account');

	// If the popup is torn down mid-flight, stop the timers and ignore any late
	// promise resolution.
	onDestroy(() => {
		cancelled = true;
		endWork();
	});
</script>

<!-- Backdrop is intentionally inert: no click-to-dismiss and no Escape-to-close,
     so a password-manager / passkey native dialog losing focus can't kill the
     popup mid-flow. The × closes when idle; while working it's briefly disabled
     (grace period) then becomes a cancel so a hung passkey can't trap the user. -->
<div class="backdrop">
	<div class="popup" role="dialog" aria-modal="true" aria-label={title}>
		<div class="head">
			<h3>{title}</h3>
			<button
				class="x"
				aria-label="Close"
				onclick={requestClose}
				disabled={!closeable}
				title={closeable ? 'Close' : 'Please wait — creating your account…'}
			>×</button>
		</div>

		{#if step === 'idle'}
			{#if mode === 'login'}
				<p class="sub">Log in securely with your passkey — no password needed.</p>
				<button class="btn-primary" onclick={start}>Log in</button>
			{:else}
				<p class="sub">
					Choose a name and create your Circles account in seconds. It's secured by a
					<strong>passkey</strong> on this device — no seed phrase, no password, and free to set up.
				</p>
				<input
					class="name-input"
					type="text"
					placeholder="Your name"
					maxlength="64"
					autocomplete="off"
					bind:value={userName}
					oninput={() => {
						if (step === 'error') {
							step = 'idle';
							errorMsg = '';
						}
					}}
					onkeydown={(e) => {
						if (e.key === 'Enter' && userName.trim()) start();
					}}
				/>
				<button class="btn-primary" onclick={start} disabled={!userName.trim()}>
					Create my account
				</button>
			{/if}
		{/if}

		{#if step === 'working'}
			<div class="loader-block">
				<div class="orbit">
					<span class="orbit-ring"></span>
					<span class="orbit-dot"></span>
					<span class="orbit-core">○</span>
				</div>
				<span class="loader-label">{workingLabel}</span>
				<span class="loader-sub">This only takes a moment — please don't close this window.</span>
				{#if canCancel}
					<button class="link-btn" onclick={cancelWork}>Taking too long? Cancel</button>
				{/if}
			</div>
		{/if}

		{#if step === 'success'}
			<div class="success-block">
				<div class="success-icon">✓</div>
				{#if mode === 'login'}
					<h4 class="success-title">Welcome back</h4>
					<p class="success-sub">You're logged in to your Circles account.</p>
				{:else}
					<h4 class="success-title">You're all set!</h4>
					<p class="success-sub">Your Circles account is ready.</p>
				{/if}
				<button class="btn-primary" onclick={onclose}>Continue</button>
			</div>
		{/if}

		{#if step === 'error'}
			<div class="error-block">
				<div class="error-icon">!</div>
				<p class="error-msg">{errorMsg}</p>
				<button class="btn-secondary" onclick={retry}>Try again</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(5, 6, 26, 0.4);
		z-index: 9999;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		/* The dim overlay must NOT swallow clicks outside the popup card — e.g. a
		   password-manager (1Password) native prompt that renders over the page.
		   Clicks pass through everywhere except the popup itself (below). */
		pointer-events: none;
	}

	.popup {
		/* Re-enable interaction for the card only. */
		pointer-events: auto;
		background: #faf5f1;
		border-radius: 24px 24px 0 0;
		width: 100%;
		max-width: 480px;
		max-height: 80vh;
		overflow-y: auto;
		padding: 24px 22px 28px;
		animation: slideUp 0.25s cubic-bezier(0.35, 0.15, 0, 1);
		box-shadow: 0 -8px 40px rgba(6, 10, 64, 0.18);
		box-sizing: border-box;
	}

	@keyframes slideUp {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 14px;
	}

	h3 {
		margin: 0;
		font-size: 18px;
		font-weight: 800;
		color: #060a40;
	}

	.x {
		border: none;
		background: transparent;
		font-size: 26px;
		line-height: 1;
		color: #9b9db3;
		cursor: pointer;
		padding: 0 4px;
	}

	.x:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.sub {
		margin: 0 0 18px;
		font-size: 0.92rem;
		line-height: 1.5;
		color: #4a4c6a;
	}

	.name-input {
		width: 100%;
		box-sizing: border-box;
		padding: 13px 14px;
		margin-bottom: 12px;
		border: 1.5px solid #e2dccf;
		border-radius: 12px;
		background: #fff;
		font-size: 1rem;
		color: #060a40;
		outline: none;
	}

	.name-input:focus {
		border-color: #7c5cff;
	}

	.btn-primary {
		width: 100%;
		padding: 15px 20px;
		border: none;
		border-radius: 14px;
		background: #7c5cff;
		color: #fff;
		font-size: 1rem;
		font-weight: 700;
		cursor: pointer;
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		width: 100%;
		padding: 13px 20px;
		border: 1.5px solid #7c5cff;
		border-radius: 14px;
		background: transparent;
		color: #060a40;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
	}

	/* ----- Loader ----- */
	.loader-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 18px 0 8px;
		text-align: center;
	}

	.orbit {
		position: relative;
		width: 64px;
		height: 64px;
	}

	/* soft rotating gradient ring */
	.orbit-ring {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background: conic-gradient(from 0deg, #7c5cff, #b9a6ff, #7c5cff00 65%, #7c5cff00);
		-webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
		mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 4px));
		animation: spin 1.1s linear infinite;
	}

	/* little dot riding the ring */
	.orbit-dot {
		position: absolute;
		top: -1px;
		left: 50%;
		width: 8px;
		height: 8px;
		margin-left: -4px;
		background: #7c5cff;
		border-radius: 50%;
		transform-origin: 4px 33px;
		animation: spin 1.1s linear infinite;
		box-shadow: 0 0 8px rgba(124, 92, 255, 0.7);
	}

	/* gently pulsing core */
	.orbit-core {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		color: #7c5cff;
		animation: pulse 1.6s ease-in-out infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.45;
			transform: scale(0.9);
		}
		50% {
			opacity: 1;
			transform: scale(1.05);
		}
	}

	.loader-label {
		font-size: 1rem;
		font-weight: 700;
		color: #060a40;
	}

	.loader-sub {
		font-size: 0.82rem;
		color: #9b9db3;
		max-width: 260px;
		line-height: 1.4;
	}

	.link-btn {
		margin-top: 4px;
		background: none;
		border: none;
		color: #9b9db3;
		font-size: 0.82rem;
		text-decoration: underline;
		cursor: pointer;
		padding: 4px;
	}

	.success-block,
	.error-block {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		text-align: center;
	}

	.success-icon {
		width: 52px;
		height: 52px;
		border-radius: 50%;
		background: #1a8f5a;
		color: #fff;
		font-size: 1.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.success-title {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 800;
		color: #060a40;
	}

	.success-sub {
		margin: 0;
		font-size: 0.92rem;
		color: #4a4c6a;
	}

	.error-icon {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: #d64545;
		color: #fff;
		font-size: 1.5rem;
		font-weight: 800;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.error-msg {
		margin: 0;
		font-size: 0.88rem;
		color: #d64545;
		word-break: break-word;
	}
</style>
