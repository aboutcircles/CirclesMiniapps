<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import AppNavigation from "$lib/AppNavigation.svelte";
    import { wallet } from "$lib/wallet.svelte";

    const baseUrl = import.meta.env.VITE_BASE_URL;

    type MiniApp = {
        slug?: string;
        name: string;
        logo: string;
        url: string;
        description?: string;
        tags: string[];
        isHidden?: boolean;
        category?: string;
    };

    let apps: MiniApp[] = $state([]);
    let selectedApp: MiniApp | null = $state(null);
    let showLogout = $state(false);
    let chipEl = $state<HTMLElement>();

    function visibleApps(): MiniApp[] {
        return apps.filter((app) => !app.isHidden && app.category !== "admin");
    }

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

    function getInitial(name: string): string {
        return name.trim().charAt(0).toUpperCase();
    }

    function openPlayground(url?: string) {
        const params = url ? `?url=${encodeURIComponent(url)}` : "";
        goto(`/playground${params}`);
    }

    function launchApp(app: MiniApp) {
        if (app.slug) {
            goto(`/miniapps/${app.slug}`);
            return;
        }
        openPlayground(app.url);
    }

    onMount(() => {
        fetch("/miniapps.json")
            .then((r) => r.json())
            .then((data: MiniApp[]) => {
                apps = data;
            })
            .catch(() => {
                // silently ignore fetch errors
            });

        wallet.autoConnect();
    });
</script>

<svelte:window onclick={handleWindowClick} />

<svelte:head>
    <title>Circles Mini Apps - {baseUrl}</title>
</svelte:head>

<div class="page">
    <div class="card header">
        <div class="header-left">
            <AppNavigation />
            <h1>Circles Mini Apps</h1>
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

    <div class="list-scroll">
        <div class="app-grid">
            {#each visibleApps() as app (app.url)}
                <button class="app-tile" onclick={() => (selectedApp = app)}>
                    <div class="tile-icon-wrap">
                        {#if app.logo}
                            <img
                                class="tile-icon"
                                src={app.logo}
                                alt={app.name}
                                onerror={(e) => {
                                    const el =
                                        e.currentTarget as HTMLImageElement;
                                    el.style.display = "none";
                                    const fb =
                                        el.nextElementSibling as HTMLElement | null;
                                    if (fb) fb.style.display = "flex";
                                }}
                            />
                            <span
                                class="tile-icon-fallback"
                                style="display:none">{getInitial(app.name)}</span
                            >
                        {:else}
                            <span class="tile-icon-fallback"
                                >{getInitial(app.name)}</span
                            >
                        {/if}
                    </div>
                    <span class="tile-name">{app.name}</span>
                </button>
            {/each}
        </div>

        {#if selectedApp}
            <div
                class="popup-overlay"
                onclick={() => (selectedApp = null)}
                role="presentation"
            >
                <div
                    class="popup-card"
                    onclick={(e) => e.stopPropagation()}
                    onkeydown={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    tabindex="-1"
                >
                    <button
                        class="popup-close"
                        onclick={() => (selectedApp = null)}
                        aria-label="Close">&#10005;</button
                    >
                    <div class="popup-icon-wrap">
                        {#if selectedApp.logo}
                            <img
                                class="popup-icon"
                                src={selectedApp.logo}
                                alt={selectedApp.name}
                                onerror={(e) => {
                                    const el =
                                        e.currentTarget as HTMLImageElement;
                                    el.style.display = "none";
                                    const fb =
                                        el.nextElementSibling as HTMLElement | null;
                                    if (fb) fb.style.display = "flex";
                                }}
                            />
                            <span
                                class="popup-icon-fallback"
                                style="display:none"
                                >{getInitial(selectedApp.name)}</span
                            >
                        {:else}
                            <span class="popup-icon-fallback"
                                >{getInitial(selectedApp.name)}</span
                            >
                        {/if}
                    </div>
                    <h2 class="popup-name">{selectedApp.name}</h2>
                    {#if selectedApp.description}
                        <p class="popup-description">
                            {selectedApp.description}
                        </p>
                    {/if}
                    {#if selectedApp.tags && selectedApp.tags.length > 0}
                        <div class="popup-tags">
                            {#each selectedApp.tags as tag (tag)}
                                <span class="tag">{tag}</span>
                            {/each}
                        </div>
                    {/if}
                    <button
                        class="popup-launch-btn"
                        onclick={() => {
                            launchApp(selectedApp!);
                            selectedApp = null;
                        }}
                    >
                        Start
                    </button>
                </div>
            </div>
        {/if}
    </div>
</div>

<style>
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

    .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        padding: 0 0 12px 0;
        border-bottom: 1px solid var(--line);
        margin-bottom: 16px;
        flex-shrink: 0;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .header-left h1 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
        letter-spacing: -0.02em;
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
        border: 1px solid #000;
        border-radius: var(--radius-card);
        overflow: hidden;
        background: #ffffff;
        position: relative;
        outline: 2px solid transparent;
        transition: outline-color 0.15s;
        box-sizing: border-box;
    }

    .app-tile:hover .tile-icon-wrap {
        outline-color: var(--line);
    }

    .tile-icon {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .tile-icon-fallback {
        position: absolute;
        inset: 0;
        font-size: 28px;
        font-weight: 700;
        color: var(--muted);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
    }

    .tile-name {
        font-size: 12px;
        font-weight: 700;
        color: var(--ink);
        line-height: 1.3;
        word-break: break-word;
        max-width: 100%;
    }

    .tag {
        background: var(--accent-soft);
        color: var(--accent);
        font-size: 11px;
        font-weight: 500;
        padding: 2px 7px;
        border-radius: var(--radius-pill);
    }

    .popup-overlay {
        position: fixed;
        inset: 0;
        background: rgba(5, 6, 26, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 100;
        padding: 16px;
    }

    .popup-card {
        background: rgba(255, 255, 255, 0.92);
        backdrop-filter: blur(6px);
        border: 1px solid var(--line);
        border-radius: var(--radius-card);
        padding: 28px 24px 24px;
        width: 100%;
        max-width: 400px;
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        box-shadow: var(--shadow-card);
    }

    .popup-close {
        position: absolute;
        top: 14px;
        right: 14px;
        background: var(--line-soft);
        border: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        font-size: 12px;
        color: var(--muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.15s;
    }

    .popup-close:hover {
        background: var(--line);
    }

    .popup-icon-wrap {
        width: 80px;
        height: 80px;
        border: 1px solid #000;
        border-radius: 18px;
        overflow: hidden;
        background: #ffffff;
        position: relative;
        flex-shrink: 0;
    }

    .popup-icon {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
    }

    .popup-icon-fallback {
        position: absolute;
        inset: 0;
        font-size: 32px;
        font-weight: 700;
        color: var(--muted);
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .popup-name {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: var(--ink);
        letter-spacing: -0.02em;
        text-align: center;
    }

    .popup-description {
        margin: 0;
        font-size: 14px;
        color: var(--muted);
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
        background: linear-gradient(130deg, var(--accent), var(--accent-mid));
        color: #fff;
        border: none;
        border-radius: var(--radius-pill);
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

    .list-scroll {
        flex: 1;
        overflow-y: auto;
        min-height: 0;
        padding: 0 4px;
    }
</style>
