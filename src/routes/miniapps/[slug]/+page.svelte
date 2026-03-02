<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	const baseUrl = import.meta.env.VITE_BASE_URL;
	import { wallet } from '$lib/wallet.svelte.ts';
	import ApprovalPopup from '$lib/ApprovalPopup.svelte';

	type MiniApp = { slug?: string; name: string; logo: string; url: string; description?: string; tags: string[] };

	let app: MiniApp | null = $state(null);
	let notFound = $state(false);
	let iframeSrc = $state('');
	let showLogout = $state(false);
	let chipEl = $state<HTMLElement>();

	function handleWindowClick(e: MouseEvent) {
		if (showLogout && chipEl && !chipEl.contains(e.target as Node)) {
			showLogout = false;
		}
	}

	// pendingSource is kept outside $state to avoid Svelte proxying the cross-origin Window object,
	// which triggers "Blocked a frame from accessing a cross-origin frame".
	let pendingSource: MessageEventSource | null = null;
	let pendingRequest: {
		kind: 'tx' | 'sign';
		transactions?: any[];
		message?: string;
		signatureType?: 'erc1271' | 'raw';
		requestId: string;
	} | null = $state(null);

	let iframeEl: HTMLIFrameElement = $state() as HTMLIFrameElement;

	function truncateAddr(addr: string): string {
		return addr.slice(0, 6) + '...' + addr.slice(-4);
	}

	function getAvatarInitial(): string {
		const name = wallet.avatarName;
		if (name) return name.trim().charAt(0).toUpperCase();
		return wallet.address ? wallet.address.slice(2, 4).toUpperCase() : '?';
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
				const raw = $page.url.searchParams.get('data');
				if (raw) {
					try {
						postTo(event.source, { type: 'app_data', data: atob(raw) });
					} catch {
						postTo(event.source, { type: 'app_data', data: raw });
					}
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
					signatureType: data.signatureType === 'raw' ? 'raw' : 'erc1271',
					requestId: data.requestId
				};
				break;
		}
	}

	onMount(() => {
		window.addEventListener('message', handleMessage);

		wallet.autoConnect();

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
			const { signature, verified } = pendingRequest.signatureType === 'raw'
				? await wallet.signMessage(pendingRequest.message!)
				: { signature: await wallet.signErc1271Message(pendingRequest.message!), verified: true };
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

<svelte:window onclick={handleWindowClick} />

<svelte:head>
	<title>{app ? app.name : 'Mini App'} - {baseUrl}</title>
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
					<div class="user-chip" bind:this={chipEl} class:open={showLogout} onclick={() => (showLogout = !showLogout)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (showLogout = !showLogout)}>
						<div class="avatar-img-wrap">
							{#if wallet.avatarImageUrl}
								<img class="avatar-img" src={wallet.avatarImageUrl} alt="avatar" />
							{:else}
								<span class="avatar-placeholder">{getAvatarInitial()}</span>
							{/if}
						</div>
						<span class="user-name">{wallet.avatarName || truncateAddr(wallet.address)}</span>
						{#if showLogout}
							<button class="logout-btn" onclick={(e) => { e.stopPropagation(); wallet.disconnect(); showLogout = false; }}>Log out</button>
						{/if}
					</div>
				{:else}
					<button
						class="connect-btn"
						onclick={() => wallet.connectWithPasskey()}
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
		--radius-sm: 12px;
		--radius-full: 999px;
	}

	:global(body) {
		margin: 0;
		background: var(--bg-subtle);
		color: var(--fg);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		-webkit-font-smoothing: antialiased;
		overflow-x: hidden;
	}

	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		max-width: 720px;
		margin: 0 auto;
		padding: 24px 16px;
		box-sizing: border-box;
		overflow-x: hidden;
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

	/* User chip */
	.user-chip {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 10px 4px 4px;
		border: 1px solid var(--border);
		border-radius: var(--radius-full);
		background: var(--bg);
		cursor: pointer;
		user-select: none;
		transition: border-color 0.15s, background 0.15s;
	}

	.user-chip:hover,
	.user-chip.open {
		border-color: var(--border-strong);
		background: var(--bg-subtle);
	}

	.avatar-img-wrap {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		overflow: hidden;
		flex-shrink: 0;
		background: var(--bg-emphasis);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.avatar-placeholder {
		font-size: 12px;
		font-weight: 600;
		color: var(--fg-muted);
		line-height: 1;
	}

	.user-name {
		font-size: 13px;
		font-weight: 500;
		color: var(--fg);
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.logout-btn {
		background: none;
		border: none;
		border-left: 1px solid var(--border);
		padding: 2px 0 2px 10px;
		margin-left: 2px;
		font-size: 13px;
		font-weight: 500;
		color: var(--fg-muted);
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.15s;
	}

	.logout-btn:hover {
		color: var(--fg);
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

</style>
