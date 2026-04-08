<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";
    import AppNavigation from "$lib/AppNavigation.svelte";
    import { wallet } from "$lib/wallet.svelte";
    import ApprovalPopup from "$lib/ApprovalPopup.svelte";

    const baseUrl = import.meta.env.VITE_BASE_URL;

    let iframeSrc = $state("");
    let urlInput = $state("");
    let isOffline = $state(false);
    let showLogout = $state(false);
    let chipEl = $state<HTMLElement>();
    let iframeEl: HTMLIFrameElement = $state() as HTMLIFrameElement;

    // pendingSource is kept outside $state to avoid Svelte proxying the cross-origin Window object,
    // which triggers "Blocked a frame from accessing a cross-origin frame".
    let pendingSource: MessageEventSource | null = null;
    let pendingRequest: {
        kind: "tx" | "sign";
        transactions?: any[];
        message?: string;
        signatureType?: "erc1271" | "raw";
        requestId: string;
    } | null = $state(null);

    function handleWindowClick(e: MouseEvent) {
        if (showLogout && chipEl && !chipEl.contains(e.target as Node)) {
            showLogout = false;
        }
    }

    function truncateAddr(addr: string): string {
        return addr.slice(0, 6) + "..." + addr.slice(-4);
    }

    function getAvatarInitial(): string {
        const name = wallet.avatarName;
        if (name) return name.trim().charAt(0).toUpperCase();
        return wallet.address ? wallet.address.slice(2, 4).toUpperCase() : "?";
    }

    function postTo(source: MessageEventSource | null, data: any) {
        try {
            (source as Window)?.postMessage(data, "*");
        } catch {
            // cross-origin access blocked — ignore
        }
    }

    function postToIframe(data: any) {
        try {
            iframeEl?.contentWindow?.postMessage(data, "*");
        } catch {
            // cross-origin access blocked — ignore
        }
    }

    function postAppData(
        source: MessageEventSource | null = iframeEl?.contentWindow ?? null,
    ) {
        const raw = $page.url.searchParams.get("data");
        if (!raw) return;

        try {
            postTo(source, { type: "app_data", data: atob(raw) });
        } catch {
            postTo(source, { type: "app_data", data: raw });
        }
    }

    function handleMessage(event: MessageEvent) {
        const { data } = event;
        if (!data || !data.type) return;

        switch (data.type) {
            case "request_address":
                if (wallet.connected) {
                    postTo(event.source, {
                        type: "wallet_connected",
                        address: wallet.address,
                    });
                } else {
                    postTo(event.source, { type: "wallet_disconnected" });
                }
                postAppData(event.source);
                break;

            case "send_transactions":
                if (!wallet.connected) {
                    postTo(event.source, {
                        type: "tx_rejected",
                        reason: "Wallet not connected",
                        requestId: data.requestId,
                    });
                    return;
                }
                if (!data.transactions || !Array.isArray(data.transactions)) {
                    postTo(event.source, {
                        type: "tx_rejected",
                        reason: "No transactions provided",
                        requestId: data.requestId,
                    });
                    return;
                }
                pendingSource = event.source;
                pendingRequest = {
                    kind: "tx",
                    transactions: data.transactions,
                    requestId: data.requestId,
                };
                break;

            case "sign_message":
                if (!wallet.connected) {
                    postTo(event.source, {
                        type: "sign_rejected",
                        reason: "Wallet not connected",
                        requestId: data.requestId,
                    });
                    return;
                }
                if (!data.message) {
                    postTo(event.source, {
                        type: "sign_rejected",
                        reason: "No message provided",
                        requestId: data.requestId,
                    });
                    return;
                }
                pendingSource = event.source;
                pendingRequest = {
                    kind: "sign",
                    message: data.message,
                    signatureType:
                        data.signatureType === "raw" ? "raw" : "erc1271",
                    requestId: data.requestId,
                };
                break;
        }
    }

    onMount(() => {
        const syncOnlineState = () => {
            isOffline = !navigator.onLine;
        };

        syncOnlineState();
        window.addEventListener("message", handleMessage);
        window.addEventListener("online", syncOnlineState);
        window.addEventListener("offline", syncOnlineState);
        wallet.autoConnect();

        const initialUrl = $page.url.searchParams.get("url") ?? "";
        urlInput = initialUrl;
        iframeSrc = initialUrl;

        return () => {
            window.removeEventListener("message", handleMessage);
            window.removeEventListener("online", syncOnlineState);
            window.removeEventListener("offline", syncOnlineState);
        };
    });

    $effect(() => {
        if (wallet.connected) {
            postToIframe({ type: "wallet_connected", address: wallet.address });
        } else {
            postToIframe({ type: "wallet_disconnected" });
        }
    });

    async function handleLoad() {
        const nextUrl = urlInput.trim();
        iframeSrc = nextUrl;

        const search = nextUrl ? `?url=${encodeURIComponent(nextUrl)}` : "";
        await goto(`/playground${search}`, {
            replaceState: true,
            noScroll: true,
            keepFocus: true,
        });
    }

    function handleIframeLoad() {
        if (wallet.connected) {
            postToIframe({ type: "wallet_connected", address: wallet.address });
        }
        postAppData();
    }

    function goBack() {
        goto("/miniapps");
    }

    async function handleApprove(): Promise<string> {
        if (!pendingRequest) return "";

        if (pendingRequest.kind === "tx") {
            const hash = await wallet.sendTransactions(
                pendingRequest.transactions!,
            );
            postTo(pendingSource, {
                type: "tx_success",
                hashes: [hash],
                requestId: pendingRequest.requestId,
            });
            pendingRequest = null;
            pendingSource = null;
            return hash;
        }

        if (pendingRequest.kind === "sign") {
            const { signature, verified } =
                pendingRequest.signatureType === "raw"
                    ? await wallet.signMessage(pendingRequest.message!)
                    : {
                          signature: await wallet.signErc1271Message(
                              pendingRequest.message!,
                          ),
                          verified: true,
                      };
            postTo(pendingSource, {
                type: "sign_success",
                signature,
                verified,
                requestId: pendingRequest.requestId,
            });
            pendingRequest = null;
            pendingSource = null;
            return signature;
        }

        return "";
    }

    function handleReject() {
        if (!pendingRequest) return;
        const rejectType =
            pendingRequest.kind === "tx" ? "tx_rejected" : "sign_rejected";
        postTo(pendingSource, {
            type: rejectType,
            reason: "User rejected",
            requestId: pendingRequest.requestId,
        });
        pendingRequest = null;
        pendingSource = null;
    }
</script>

<svelte:window onclick={handleWindowClick} />

<svelte:head>
    <title>Circles Playground - {baseUrl}</title>
</svelte:head>

<div class="page">
    <div class="iframe-topbar">
        <div class="topbar-left">
            <button class="back-btn" onclick={goBack}>&#8592; mini apps</button>
            <AppNavigation />
            <h1>Playground</h1>
        </div>
        <div class="header-right">
            {#if wallet.connected}
                <div
                    class="user-chip"
                    bind:this={chipEl}
                    class:open={showLogout}
                    onclick={() => (showLogout = !showLogout)}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) =>
                        e.key === "Enter" && (showLogout = !showLogout)}
                >
                    <div class="avatar-img-wrap">
                        {#if wallet.avatarImageUrl}
                            <img
                                class="avatar-img"
                                src={wallet.avatarImageUrl}
                                alt="avatar"
                            />
                        {:else}
                            <span class="avatar-placeholder"
                                >{getAvatarInitial()}</span
                            >
                        {/if}
                    </div>
                    <span class="user-name"
                        >{wallet.avatarName ||
                            truncateAddr(wallet.address)}</span
                    >
                    {#if showLogout}
                        <button
                            class="logout-btn"
                            onclick={(e) => {
                                e.stopPropagation();
                                wallet.disconnect();
                                showLogout = false;
                            }}>Log out</button
                        >
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

    <div class="url-bar">
        <input
            type="text"
            bind:value={urlInput}
            onkeydown={(e: KeyboardEvent) => {
                if (e.key === "Enter") handleLoad();
            }}
            placeholder="Enter app URL..."
        />
        <button class="load-btn" onclick={handleLoad}>Load</button>
    </div>

    {#if iframeSrc}
        <div class="iframe-card">
            {#if isOffline}
                <div class="offline-frame-state">
                    <h2>Playground needs a connection</h2>
                    <p>
                        The playground embeds a live mini app URL, so it cannot
                        load while offline. Reconnect to continue testing.
                    </p>
                </div>
            {:else}
                <iframe
                    bind:this={iframeEl}
                    src={iframeSrc}
                    sandbox="allow-scripts allow-forms allow-same-origin"
                    title="Playground Mini App"
                    onload={handleIframeLoad}
                ></iframe>
            {/if}
        </div>
    {:else}
        <div class="empty-state">
            <h2>Load any mini app URL</h2>
            <p>Use this playground to load and test any mini app URL.</p>
        </div>
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
    .page {
        height: 100vh;
        display: flex;
        flex-direction: column;
        max-width: 720px;
        margin: 0 auto;
        padding: 12px 8px;
        box-sizing: border-box;
        overflow-x: hidden;
        gap: 16px;
    }

    .iframe-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        padding-bottom: 12px;
        border-bottom: 1px solid var(--line);
        flex-shrink: 0;
    }

    .topbar-left {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 12px;
    }

    .topbar-left h1 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--ink);
    }

    .back-btn {
        background: none;
        border: none;
        color: var(--muted);
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
        color: var(--ink);
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .connect-btn {
        background: linear-gradient(130deg, var(--accent), var(--accent-mid));
        color: #fff;
        border: none;
        border-radius: var(--radius-pill);
        padding: 8px 18px;
        font-size: 14px;
        font-weight: 600;
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

    .user-chip {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 10px 4px 4px;
        border: 1px solid var(--line);
        border-radius: var(--radius-pill);
        background: var(--card);
        cursor: pointer;
        user-select: none;
        transition:
            border-color 0.15s,
            background 0.15s;
        position: relative;
    }

    .user-chip:hover,
    .user-chip.open {
        border-color: var(--line);
        background: var(--bg-a);
    }

    .avatar-img-wrap {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        overflow: hidden;
        flex-shrink: 0;
        background: var(--line-soft);
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
        color: var(--muted);
        line-height: 1;
    }

    .user-name {
        font-size: 13px;
        font-weight: 500;
        color: var(--ink);
        max-width: 140px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .logout-btn {
        background: none;
        border: none;
        border-left: 1px solid var(--line);
        padding: 2px 0 2px 10px;
        margin-left: 2px;
        font-size: 13px;
        font-weight: 500;
        color: var(--muted);
        cursor: pointer;
        white-space: nowrap;
        transition: color 0.15s;
    }

    .logout-btn:hover {
        color: var(--ink);
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

    .url-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(6px);
        border: 1px solid var(--line);
        border-radius: var(--radius-sm);
        box-shadow: var(--shadow-card);
        flex-shrink: 0;
    }

    .url-bar input {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid var(--line);
        border-radius: 8px;
        font-family: "SF Mono", ui-monospace, monospace;
        font-size: 12px;
        color: var(--ink);
        background: var(--bg-a);
        outline: none;
        transition: border-color 0.15s;
    }

    .url-bar input:focus {
        border-color: var(--accent-mid);
    }

    .load-btn {
        background: linear-gradient(130deg, var(--accent), var(--accent-mid));
        color: #fff;
        border: none;
        border-radius: var(--radius-pill);
        padding: 7px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        transition: opacity 0.15s;
    }

    .load-btn:hover {
        opacity: 0.85;
    }

    .iframe-card,
    .empty-state {
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

    .offline-frame-state {
        height: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px;
        text-align: center;
        background:
            radial-gradient(700px 240px at 50% 0%, rgba(14, 0, 168, 0.05) 0%, transparent 70%),
            linear-gradient(145deg, rgba(250, 245, 241, 0.85), rgba(246, 247, 249, 0.88));
    }

    .offline-frame-state h2 {
        margin: 0 0 10px;
        font-size: 22px;
        font-weight: 600;
        letter-spacing: -0.02em;
        color: var(--ink);
    }

    .offline-frame-state p {
        margin: 0;
        max-width: 420px;
        font-size: 14px;
        line-height: 1.6;
        color: var(--muted);
    }

    iframe {
        flex: 1;
        width: 100%;
        height: 100%;
        border: none;
    }

    .empty-state {
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 24px;
        text-align: center;
    }

    .empty-state h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        color: var(--ink);
    }

    .empty-state p {
        margin: 0;
        max-width: 360px;
        color: var(--muted);
        line-height: 1.5;
    }
</style>
