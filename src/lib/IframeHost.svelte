<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import AppNavigation from '$lib/AppNavigation.svelte';
	import { wallet } from '$lib/wallet.svelte.ts';
	import ApprovalPopup from '$lib/ApprovalPopup.svelte';
	import {
		truncateAddr,
		getAvatarInitial as _getAvatarInitial,
		createMessageHandler,
		createApprovalHandlers,
		type PendingRequest
	} from '$lib/iframeHost.ts';

	type Props = {
		src: string;
		iframeTitle: string;
		sandbox?: string;
		backLabel?: string;
		onBack: () => void;
		title?: string;
		getAppData?: () => string | null;
		isOffline?: boolean;
		offlineState?: Snippet;
		emptyState?: Snippet;
		beforeIframe?: Snippet;
	};

	let {
		src,
		iframeTitle,
		sandbox = 'allow-scripts allow-forms allow-same-origin',
		backLabel = 'back',
		onBack,
		title,
		getAppData,
		isOffline = false,
		offlineState,
		emptyState,
		beforeIframe
	}: Props = $props();

	let showLogout = $state(false);
	let chipEl = $state<HTMLElement>();
	let pendingRequest: PendingRequest | null = $state(null);

	// pendingSource is kept outside $state to avoid Svelte proxying the cross-origin Window object,
	// which triggers "Blocked a frame from accessing a cross-origin frame".
	let pendingSource: MessageEventSource | null = null;

	let iframeEl: HTMLIFrameElement = $state() as HTMLIFrameElement;

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
		setPending: (req) => { pendingRequest = req; },
		setPendingSource: (s) => { pendingSource = s; }
	});

	const { handleApprove, handleReject } = createApprovalHandlers({
		getPending: () => pendingRequest,
		getPendingSource: () => pendingSource,
		setPending: (req) => { pendingRequest = req; },
		setPendingSource: (s) => { pendingSource = s; }
	});

	onMount(() => {
		window.addEventListener('message', handleMessage);
		return () => {
			window.removeEventListener('message', handleMessage);
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

{@render beforeIframe?.()}

<div class="iframe-card">
	{#if isOffline && offlineState}
		{@render offlineState()}
	{:else if !src && emptyState}
		{@render emptyState()}
	{:else if src}
		<iframe bind:this={iframeEl} {src} {sandbox} title={iframeTitle} onload={handleIframeLoad}></iframe>
	{/if}
</div>

{#if pendingRequest}
	<ApprovalPopup
		request={pendingRequest}
		onapprove={handleApprove}
		onreject={handleReject}
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

	.iframe-card {
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

	iframe {
		flex: 1;
		width: 100%;
		height: 100%;
		border: none;
		display: block;
	}
</style>
