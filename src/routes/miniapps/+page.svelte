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
	let selectedApp: MiniApp | null = $state(null);
	let selectedTags: Set<string> = $state(new Set());
	let showAllTags = $state(false);

	const TOP_TAG_COUNT = 3;

	function allTags(): { tag: string; count: number }[] {
		const counts = new Map<string, number>();
		for (const app of apps) {
			for (const tag of app.tags ?? []) {
				counts.set(tag, (counts.get(tag) ?? 0) + 1);
			}
		}
		return [...counts.entries()]
			.map(([tag, count]) => ({ tag, count }))
			.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
	}

	function visibleTags(): { tag: string; count: number }[] {
		const all = allTags();
		return showAllTags ? all : all.slice(0, TOP_TAG_COUNT);
	}

	function toggleTag(tag: string) {
		const next = new Set(selectedTags);
		if (next.has(tag)) next.delete(tag);
		else next.add(tag);
		selectedTags = next;
	}

	function filteredApps(): MiniApp[] {
		if (selectedTags.size === 0) return apps;
		return apps.filter((app) => [...selectedTags].every((t) => app.tags?.includes(t)));
	}

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

		{#if allTags().length > 0}
			<div class="tag-cloud">
				<span class="tag-cloud-label">Filter by tag</span>
				<div class="tag-cloud-pills">
					{#each visibleTags() as { tag } (tag)}
						<button
							class="tag-filter"
							class:active={selectedTags.has(tag)}
							onclick={() => toggleTag(tag)}
						>{tag}</button>
					{/each}
					{#if allTags().length > TOP_TAG_COUNT}
						<button class="tag-view-all" onclick={() => (showAllTags = !showAllTags)}>
							{showAllTags ? 'less' : 'view all'}
						</button>
					{/if}
				</div>
			</div>
		{/if}

		<div class="app-grid">
			{#each filteredApps() as app (app.url)}
				<button class="app-tile" onclick={() => (selectedApp = app)}>
					<div class="tile-icon-wrap">
						{#if app.logo}
							<img class="tile-icon" src={app.logo} alt={app.name}
								onerror={(e) => {
									const el = e.currentTarget as HTMLImageElement;
									el.style.display = 'none';
									const fb = el.nextElementSibling as HTMLElement | null;
									if (fb) fb.style.display = 'flex';
								}}
							/>
							<span class="tile-icon-fallback" style="display:none">{getInitial(app.name)}</span>
						{:else}
							<span class="tile-icon-fallback">{getInitial(app.name)}</span>
						{/if}
					</div>
					<span class="tile-name">{app.name}</span>
				</button>
			{:else}
				<p class="no-results">No apps match the selected tags.</p>
			{/each}
		</div>

		{#if selectedApp}
			<div class="popup-overlay" onclick={() => (selectedApp = null)} role="presentation">
				<div class="popup-card" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" tabindex="-1">
					<button class="popup-close" onclick={() => (selectedApp = null)} aria-label="Close">&#10005;</button>
					<div class="popup-icon-wrap">
						{#if selectedApp.logo}
							<img class="popup-icon" src={selectedApp.logo} alt={selectedApp.name}
								onerror={(e) => {
									const el = e.currentTarget as HTMLImageElement;
									el.style.display = 'none';
									const fb = el.nextElementSibling as HTMLElement | null;
									if (fb) fb.style.display = 'flex';
								}}
							/>
							<span class="popup-icon-fallback" style="display:none">{getInitial(selectedApp.name)}</span>
						{:else}
							<span class="popup-icon-fallback">{getInitial(selectedApp.name)}</span>
						{/if}
					</div>
					<h2 class="popup-name">{selectedApp.name}</h2>
					{#if selectedApp.description}
						<p class="popup-description">{selectedApp.description}</p>
					{/if}
					{#if selectedApp.tags && selectedApp.tags.length > 0}
						<div class="popup-tags">
							{#each selectedApp.tags as tag (tag)}
								<span class="tag">{tag}</span>
							{/each}
						</div>
					{/if}
					<button class="popup-launch-btn" onclick={() => { launchApp(selectedApp!); selectedApp = null; }}>
						Start
					</button>
				</div>
			</div>
		{/if}

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

	:global(html, body) {
		margin: 0;
		max-width: 100%;
		overflow-x: hidden;
	}

	:global(body) {
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
		padding: 12px 8px;
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
		padding: 0 0 12px 0;
		border-bottom: 1px solid var(--border);
		margin-bottom: 16px;
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

	/* Tag cloud */
	.tag-cloud {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		margin-bottom: 14px;
	}

	.tag-cloud-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--fg-subtle);
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.tag-cloud-pills {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.tag-filter {
		background: var(--bg-muted);
		color: var(--fg-muted);
		border: 1px solid transparent;
		border-radius: var(--radius-full);
		padding: 4px 12px;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}

	.tag-filter:hover {
		background: var(--bg-emphasis);
		color: var(--fg);
	}

	.tag-filter.active {
		background: var(--brand);
		color: var(--fg-on-dark);
		border-color: var(--brand);
	}

	.tag-view-all {
		background: none;
		border: none;
		color: var(--fg-subtle);
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		padding: 4px;
		transition: color 0.15s;
	}

	.tag-view-all:hover {
		color: var(--fg-muted);
	}

	.no-results {
		grid-column: 1 / -1;
		text-align: center;
		color: var(--fg-muted);
		font-size: 14px;
		padding: 32px 0;
		margin: 0;
	}

	/* App grid */
	.app-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
		min-width: 0;
		width: 100%;
	}

	.app-tile {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		text-align: center;
	}

	.tile-icon-wrap {
		width: 100%;
		aspect-ratio: 1;
		border-radius: 20px;
		overflow: hidden;
		background: var(--bg-emphasis);
		position: relative;
		outline: 2px solid transparent;
		transition: outline-color 0.15s, background 0.15s;
		padding: 6px;
		box-sizing: border-box;
	}

	.app-tile:hover .tile-icon-wrap {
		outline-color: var(--border-strong);
		background: var(--bg-muted);
	}

	.tile-icon {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.tile-icon-fallback {
		position: absolute;
		inset: 0;
		font-size: 28px;
		font-weight: 700;
		color: var(--fg-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.tile-name {
		font-size: 12px;
		font-weight: 500;
		color: var(--fg);
		line-height: 1.3;
		word-break: break-word;
		max-width: 100%;
	}

	.tag {
		background: var(--bg-muted);
		color: var(--fg-muted);
		font-size: 11px;
		font-weight: 500;
		padding: 2px 7px;
		border-radius: var(--radius-full);
	}

	/* Popup */
	.popup-overlay {
		position: fixed;
		inset: 0;
		background: rgba(6, 10, 64, 0.45);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		padding: 16px;
	}

	.popup-card {
		background: var(--bg);
		border-radius: 20px;
		padding: 28px 24px 24px;
		width: 100%;
		max-width: 400px;
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
	}

	.popup-close {
		position: absolute;
		top: 14px;
		right: 14px;
		background: var(--bg-emphasis);
		border: none;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		font-size: 12px;
		color: var(--fg-muted);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.15s;
	}

	.popup-close:hover {
		background: var(--border-strong);
	}

	.popup-icon-wrap {
		width: 80px;
		height: 80px;
		border-radius: 18px;
		overflow: hidden;
		background: var(--bg-emphasis);
		position: relative;
		flex-shrink: 0;
	}

	.popup-icon {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.popup-icon-fallback {
		position: absolute;
		inset: 0;
		font-size: 32px;
		font-weight: 700;
		color: var(--fg-muted);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.popup-name {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		color: var(--fg);
		letter-spacing: -0.02em;
		text-align: center;
	}

	.popup-description {
		margin: 0;
		font-size: 14px;
		color: var(--fg-muted);
		line-height: 1.5;
		text-align: center;
	}

	.popup-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		justify-content: center;
	}

	.popup-launch-btn {
		width: 100%;
		background: var(--brand);
		color: var(--fg-on-dark);
		border: none;
		border-radius: var(--radius-full);
		padding: 14px;
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		margin-top: 4px;
		transition: opacity 0.15s;
	}

	.popup-launch-btn:hover {
		opacity: 0.85;
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
		padding: 0 4px;
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
