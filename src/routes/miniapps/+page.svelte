<script lang="ts">
	import { onMount } from 'svelte';
	import { wallet } from '$lib/wallet.svelte.ts';
	import ApprovalPopup from '$lib/ApprovalPopup.svelte';

	import { page } from '$app/stores';
	import { goto } from '$app/navigation';

	const baseUrl = import.meta.env.VITE_BASE_URL;

	type MiniApp = { slug?: string; name: string; logo: string; url: string; description?: string; tags: string[] };

	let apps: MiniApp[] = $state([]);
	let view: 'list' | 'iframe' = $state('list');
	let showAdvanced = $state(false);

	let iframeSrc = $state('');
	let urlInput = $state('');
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
	let showLogout = $state(false);
	let chipEl = $state<HTMLElement>();

	function handleWindowClick(e: MouseEvent) {
		if (showLogout && chipEl && !chipEl.contains(e.target as Node)) {
			showLogout = false;
		}
	}

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
		fetch('/miniapps.json')
			.then((r) => r.json())
			.then((data: MiniApp[]) => {
				apps = data;
			})
			.catch(() => {
				// silently ignore fetch errors
			});

		wallet.autoConnect();

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

	function handleLoad() {
		iframeSrc = urlInput;
		view = 'iframe';
	}

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

	function launchApp(app: MiniApp) {
		if (app.slug) {
			goto(`/miniapps/${app.slug}`);
			return;
		}
		iframeSrc = app.url;
		urlInput = app.url;
		view = 'iframe';
	}

	function goBack() {
		view = 'list';
		iframeSrc = '';
	}

	function getInitial(name: string): string {
		return name.trim().charAt(0).toUpperCase();
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
	<title>Mini Apps - {baseUrl}</title>
</svelte:head>

<div class="page">
	{#if view === 'list'}
		<!-- App List View -->
		<div class="list-scroll">
		<div class="card header">
			<div class="header-left">
				<h1>Mini Apps</h1>
			</div>
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

		<div class="app-list">
			{#each apps as app (app.url)}
				<div class="app-row">
					<div class="app-logo-wrap">
						{#if app.logo}
							<img
								class="app-logo"
								src={app.logo}
								alt={app.name}
								onerror={(e) => {
									const el = e.currentTarget as HTMLImageElement;
									el.style.display = 'none';
									const fallback = el.nextElementSibling as HTMLElement | null;
									if (fallback) fallback.style.display = 'flex';
								}}
							/>
							<span class="app-logo-fallback" style="display:none">{getInitial(app.name)}</span>
						{:else}
							<span class="app-logo-fallback">{getInitial(app.name)}</span>
						{/if}
					</div>
					<div class="app-info">
						<span class="app-name">{app.name}</span>
						{#if app.description}
							<span class="app-description">{app.description}</span>
						{/if}
						{#if app.tags && app.tags.length > 0}
							<div class="app-tags">
								{#each app.tags as tag (tag)}
									<span class="tag">{tag}</span>
								{/each}
							</div>
						{/if}
					</div>
					<button class="launch-btn" onclick={() => launchApp(app)}>Launch</button>
				</div>
			{/each}
		</div>

		<div class="advanced-section">
			<button class="advanced-toggle" onclick={() => (showAdvanced = !showAdvanced)}>
				{showAdvanced ? 'Hide Advanced' : 'Advanced'}
			</button>
			{#if showAdvanced}
				<div class="url-bar advanced-bar">
					<input
						type="text"
						bind:value={urlInput}
						onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleLoad(); }}
						placeholder="Enter app URL..."
					/>
					<button class="load-btn" onclick={handleLoad}>Load</button>
				</div>
			{/if}
		</div>
		</div> <!-- /list-scroll -->
	{:else}
		<!-- Iframe View -->
		<div class="iframe-view">
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

		{#if showAdvanced}
			<div class="url-bar advanced-bar card">
				<input
					type="text"
					bind:value={urlInput}
					onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') handleLoad(); }}
					placeholder="Enter app URL..."
				/>
				<button class="load-btn" onclick={handleLoad}>Load</button>
			</div>
		{/if}

		<div class="card iframe-card">
			<iframe
				bind:this={iframeEl}
				src={iframeSrc}
				sandbox="allow-scripts allow-forms allow-same-origin"
				title="Mini App"
				onload={handleIframeLoad}
			></iframe>
		</div>
		</div> <!-- /iframe-view -->
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
		overflow-x: hidden;
	}

	.page {
		height: 100vh;
		display: flex;
		flex-direction: column;
		max-width: 720px;
		margin: 0 auto;
		padding: 24px 16px;
		gap: 0;
		box-sizing: border-box;
		overflow: hidden;
		overflow-x: hidden;
	}

	/* Header */
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 0 20px 0;
		border-bottom: 1px solid var(--border);
		margin-bottom: 24px;
	}

	.header-left h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.02em;
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
		position: relative;
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

	/* App list */
	.app-list {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		background: var(--bg);
		overflow: hidden;
	}

	.app-row {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border);
	}

	.app-row:last-child {
		border-bottom: none;
	}

	.app-logo-wrap {
		width: 44px;
		height: 44px;
		flex-shrink: 0;
	}

	.app-logo {
		width: 44px;
		height: 44px;
		border-radius: 10px;
		object-fit: contain;
		background: var(--bg-muted);
	}

	.app-logo-fallback {
		width: 44px;
		height: 44px;
		border-radius: 10px;
		background: var(--bg-emphasis);
		color: var(--fg-muted);
		font-size: 18px;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.app-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.app-name {
		font-size: 15px;
		font-weight: 500;
		color: var(--fg);
		letter-spacing: -0.01em;
	}

	.app-description {
		font-size: 13px;
		color: var(--fg-muted);
		line-height: 1.4;
	}

	.app-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.tag {
		background: var(--bg-muted);
		color: var(--fg-muted);
		font-size: 11px;
		font-weight: 500;
		padding: 2px 7px;
		border-radius: var(--radius-full);
	}

	.launch-btn {
		background: var(--bg-subtle);
		color: var(--fg);
		border: 1px solid var(--border-strong);
		border-radius: var(--radius-full);
		padding: 7px 16px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.15s;
		flex-shrink: 0;
	}

	.launch-btn:hover {
		background: var(--bg-emphasis);
	}

	/* Advanced section */
	.advanced-section {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 20px;
	}

	.advanced-toggle {
		background: none;
		border: none;
		color: var(--fg-subtle);
		font-size: 13px;
		cursor: pointer;
		padding: 0;
		text-align: left;
		transition: color 0.15s;
	}

	.advanced-toggle:hover {
		color: var(--fg-muted);
	}

	/* URL bar */
	.url-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.url-bar input {
		flex: 1;
		padding: 6px 10px;
		border: 1px solid var(--border);
		border-radius: 8px;
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 12px;
		color: var(--fg);
		background: var(--bg-subtle);
		outline: none;
		transition: border-color 0.15s;
	}

	.url-bar input:focus {
		border-color: var(--fg-muted);
	}

	.load-btn {
		background: var(--brand);
		color: var(--fg-on-dark);
		border: none;
		border-radius: var(--radius-full);
		padding: 7px 16px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity 0.15s;
	}

	.load-btn:hover {
		opacity: 0.85;
	}

	/* List view scrolls, iframe view does not */
	.list-scroll {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}

	/* Iframe view */
	.iframe-view {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

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

	.iframe-card {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--bg);
	}

	iframe {
		flex: 1;
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}

</style>
