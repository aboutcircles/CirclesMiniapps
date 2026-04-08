<script lang="ts">
    import { onMount } from "svelte";

    let isOffline = $state(false);

    onMount(() => {
        const sync = () => {
            isOffline = !navigator.onLine;
        };

        sync();
        window.addEventListener("online", sync);
        window.addEventListener("offline", sync);

        return () => {
            window.removeEventListener("online", sync);
            window.removeEventListener("offline", sync);
        };
    });
</script>

{#if isOffline}
    <div class="offline-notice" role="status" aria-live="polite">
        You&apos;re offline. Most features won't work offline. Please connect
        back to internet to continue using this as a PWA.
    </div>
{/if}

<style>
    .offline-notice {
        margin: 0 auto 16px;
        width: min(100%, 720px);
        padding: 12px 14px;
        border: 1px solid rgba(138, 72, 44, 0.18);
        border-radius: 16px;
        background: var(--warn-bg);
        color: var(--warn-ink);
        font-size: 14px;
        line-height: 1.45;
        box-shadow: 0 6px 18px rgba(138, 72, 44, 0.08);
    }
</style>
