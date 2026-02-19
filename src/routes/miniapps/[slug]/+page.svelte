<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { wallet } from '$lib/wallet.svelte.ts';
	import ApprovalPopup from '$lib/ApprovalPopup.svelte';

	type MiniApp = { slug?: string; name: string; logo: string; url: string; description?: string; tags: string[] };

	let app: MiniApp | null = $state(null);
	let notFound = $state(false);
	let iframeSrc = $state('');

	// pendingSource is kept outside $state to avoid Svelte proxying the cross-origin Window object,
	// which triggers "Blocked a frame from accessing a cross-origin frame".
	let pendingSource: MessageEventSource | null = null;
	let pendingRequest: {
		kind: 'tx' | 'sign';
		transactions?: any[];
		message?: string;
		requestId: string;
	} | null = $state(null);

	let iframeEl: HTMLIFrameElement = $state() as HTMLIFrameElement;
	let showConnectModal = $state(false);
	let safeAddressInput = $state('');

	function truncateAddr(addr: string): string {
		return addr.slice(0, 6) + '...' + addr.slice(-4);
	}

	/** Post a message to a cross-origin source window safely. */
	function postTo(source: MessageEventSource | null, data: any) {
		try {
			(source as Window)?.postMessage(data, '*');
		} catch {
			// cross-origin access blocked — ignore
		}
	}

	function postToIframe(data: any) {
		try {
			iframeEl?.contentWindow?.postMessage(data, '*');
		} catch {
			// cross-origin access blocked — ignore
		}
	}

	function handleMessage(event: MessageEvent) {
		const { data } = event;
		if (!data || !data.type) return;

		switch (data.type) {
			case 'request_address':
				if (wallet.connected) {
					postTo(event.source, { type: 'wallet_connected', address: wallet.address });
				} else {
					postTo(event.source, { type: 'wallet_disconnected' });
				}
				break;

			case 'send_transactions':
				if (!wallet.connected) {
					postTo(event.source, { type: 'tx_rejected', reason: 'Wallet not connected', requestId: data.requestId });
					return;
				}
				if (!data.transactions || !Array.isArray(data.transactions)) {
					postTo(event.source, { type: 'tx_rejected', reason: 'No transactions provided', requestId: data.requestId });
					return;
				}
				pendingSource = event.source;
				pendingRequest = {
					kind: 'tx',
					transactions: data.transactions,
					requestId: data.requestId
				};
				break;

			case 'sign_message':
				if (!wallet.connected) {
					postTo(event.source, { type: 'sign_rejected', reason: 'Wallet not connected', requestId: data.requestId });
					return;
				}
				if (!data.message) {
					postTo(event.source, { type: 'sign_rejected', reason: 'No message provided', requestId: data.requestId });
					return;
				}
				pendingSource = event.source;
				pendingRequest = {
					kind: 'sign',
					message: data.message,
					requestId: data.requestId
				};
				break;
		}
	}

	onMount(() => {
		window.addEventListener('message', handleMessage);

		wallet.autoConnect($page.url.searchParams.get('address'));

		fetch('/miniapps.json')
			.then((r) => r.json())
			.then((data: MiniApp[]) => {
				const currentSlug = $page.params.slug;
				const found = data.find((a) => a.slug === currentSlug);
				if (found) {
					app = found;
					iframeSrc = found.url;
				} else {
					notFound = true;
				}
			})
			.catch(() => {
				notFound = true;
			});

		return () => {
			window.removeEventListener('message', handleMessage);
		};
	});

	// Push wallet status to iframe whenever connection changes
	$effect(() => {
		if (wallet.connected) {
			postToIframe({ type: 'wallet_connected', address: wallet.address });
		} else {
			postToIframe({ type: 'wallet_disconnected' });
		}
	});

	function handleIframeLoad() {
		if (wallet.connected) {
			postToIframe({ type: 'wallet_connected', address: wallet.address });
		}
		const raw = $page.url.searchParams.get('data');
		if (raw) {
			try {
				postToIframe({ type: 'app_data', data: atob(raw) });
			} catch {
				postToIframe({ type: 'app_data', data: raw });
			}
		}
	}

	function goBack() {
		goto('/miniapps');
	}

	function openConnectModal() {
		safeAddressInput = wallet.getSavedSafeAddress();
		showConnectModal = true;
	}

	function handleConnect() {
		const addr = safeAddressInput.trim();
		if (!addr) return;
		showConnectModal = false;
		wallet.connect(addr);
	}

	async function handleApprove(): Promise<string> {
		if (!pendingRequest) return '';

		if (pendingRequest.kind === 'tx') {
			const hash = await wallet.sendTransactions(pendingRequest.transactions!);
			postTo(pendingSource, { type: 'tx_success', hashes: [hash], requestId: pendingRequest.requestId });
			pendingRequest = null;
			pendingSource = null;
			return hash;
		}

		if (pendingRequest.kind === 'sign') {
			const { signature, verified } = await wallet.signMessage(pendingRequest.message!);
			postTo(pendingSource, { type: 'sign_success', signature, verified, requestId: pendingRequest.requestId });
			pendingRequest = null;
			pendingSource = null;
			return signature;
		}

		return '';
	}

	function handleReject() {
		if (!pendingRequest) return;
		const rejectType = pendingRequest.kind === 'tx' ? 'tx_rejected' : 'sign_rejected';
		postTo(pendingSource, { type: rejectType, reason: 'User rejected', requestId: pendingRequest.requestId });
		pendingRequest = null;
		pendingSource = null;
	}
</script>

<svelte:head>
	<title>{app ? app.name : 'Mini App'} - circles.gnosis.io</title>
</svelte:head>

<div class="page">
	{#if notFound}
		<div class="iframe-topbar">
			<button class="back-btn" onclick={goBack}>&#8592; back</button>
		</div>
		<div class="not-found">
			<p>App not found.</p>
		</div>
	{:else}
		<div class="iframe-topbar">
			<button class="back-btn" onclick={goBack}>&#8592; back</button>
			<div class="header-right">
				{#if wallet.connected}
					<span class="wallet-address">{truncateAddr(wallet.address)}</span>
					<span class="status-dot connected"></span>
					<button class="disconnect-btn" onclick={() => wallet.disconnect()}>Disconnect</button>
				{:else}
					<button
						class="connect-btn"
						onclick={openConnectModal}
						disabled={wallet.connecting}
					>
						{#if wallet.connecting}
							<span class="btn-spinner"></span>
							Connecting...
						{:else}
							Connect Wallet
						{/if}
					</button>
				{/if}
			</div>
		</div>

		<div class="iframe-card">
			{#if iframeSrc}
				<iframe
					bind:this={iframeEl}
					src={iframeSrc}
					sandbox="allow-scripts allow-forms allow-same-origin"
					title={app ? app.name : 'Mini App'}
					onload={handleIframeLoad}
				></iframe>
			{/if}
		</div>
	{/if}
</div>

{#if showConnectModal}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="modal-backdrop" onclick={() => (showConnectModal = false)}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Connect Wallet</h3>
			<p>Enter your Safe smart account address to connect with passkeys.</p>
			<input
				type="text"
				bind:value={safeAddressInput}
				placeholder="0x..."
				onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleConnect(); }}
			/>
			<div class="modal-buttons">
				<button class="btn-cancel" onclick={() => (showConnectModal = false)}>Cancel</button>
				<button
					class="btn-connect"
					onclick={handleConnect}
					disabled={!safeAddressInput.trim()}
				>Connect</button>
			</div>
		</div>
	</div>
{/if}

<!-- Approval Popup -->
{#if pendingRequest}
	<ApprovalPopup
		request={pendingRequest}
		onapprove={handleApprove}
		onreject={handleReject}
	/>
{/if}

<style>
	/* Palette from the wallet design system */
	:root {
		--bg: #ffffff;
		--bg-subtle: #faf5f1;
		--bg-muted: #f7ece4;
		--bg-emphasis: #ede1d8;
		--border: #ede1d8;
		--border-strong: #e0d1c5;
		--fg: #060a40;
		--fg-muted: #6a6c8c;
		--fg-subtle: #9b9db3;
		--fg-on-dark: #ffffff;
		--brand: #060a40;
		--green: #22c54b;
		--radius-sm: 12px;
		--radius-full: 999px;
	}

	:global(body) {
		margin: 0;
		background: var(--bg-subtle);
		color: var(--fg);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		-webkit-font-smoothing: antialiased;
	}

	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		max-width: 720px;
		margin: 0 auto;
		padding: 24px 16px;
		box-sizing: border-box;
	}

	/* Topbar */
	.iframe-topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding-bottom: 16px;
		border-bottom: 1px solid var(--border);
		margin-bottom: 16px;
		flex-shrink: 0;
	}

	.back-btn {
		background: none;
		border: none;
		color: var(--fg-muted);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		padding: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		transition: color 0.15s;
	}

	.back-btn:hover {
		color: var(--fg);
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.connect-btn {
		background: var(--brand);
		color: var(--fg-on-dark);
		border: none;
		border-radius: var(--radius-full);
		padding: 8px 18px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: opacity 0.15s;
	}

	.connect-btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.connect-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.disconnect-btn {
		background: none;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-full);
		padding: 6px 14px;
		font-size: 13px;
		font-weight: 500;
		color: var(--fg-muted);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}

	.disconnect-btn:hover {
		color: var(--fg);
		border-color: var(--fg-muted);
	}

	.btn-spinner {
		display: inline-block;
		width: 11px;
		height: 11px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.status-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--border-strong);
		flex-shrink: 0;
	}

	.status-dot.connected {
		background: var(--green);
	}

	.wallet-address {
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 12px;
		color: var(--fg-muted);
	}

	/* Iframe card fills remaining space */
	.iframe-card {
		flex: 1;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg);
		min-height: 0;
	}

	iframe {
		flex: 1;
		width: 100%;
		height: 100%;
		border: none;
	}

	/* Not found */
	.not-found {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--fg-muted);
		font-size: 15px;
	}

	/* Connect modal */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		z-index: 9998;
		display: flex;
		align-items: flex-end;
		justify-content: center;
	}

	.modal {
		background: var(--bg);
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		border-top: 1px solid var(--border);
		width: 100%;
		max-width: 480px;
		padding: 24px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		animation: slideUp 0.25s cubic-bezier(0.35, 0.15, 0, 1);
	}

	@keyframes slideUp {
		from { transform: translateY(100%); }
		to { transform: translateY(0); }
	}

	.modal h3 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--fg);
	}

	.modal p {
		margin: 0;
		font-size: 13px;
		color: var(--fg-muted);
	}

	.modal input {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 10px;
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 13px;
		color: var(--fg);
		background: var(--bg-subtle);
		outline: none;
		box-sizing: border-box;
		transition: border-color 0.15s;
	}

	.modal input:focus {
		border-color: var(--fg-muted);
	}

	.modal-buttons {
		display: flex;
		gap: 10px;
	}

	.modal-buttons .btn-cancel {
		flex: 1;
		padding: 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--bg-subtle);
		color: var(--fg);
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
	}

	.modal-buttons .btn-connect {
		flex: 1;
		padding: 12px;
		border: none;
		border-radius: var(--radius-full);
		background: var(--brand);
		color: var(--fg-on-dark);
		font-size: 15px;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.modal-buttons .btn-connect:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}

	.modal-buttons .btn-connect:hover:not(:disabled) {
		opacity: 0.85;
	}
</style>
