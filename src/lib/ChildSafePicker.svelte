<script lang="ts">
	import { wallet } from '$lib/wallet.svelte.ts';

	let {
		// When true (the /crc-signin popup iframe window), the picker fills the whole
		// window and hides the close cross — there's nothing behind it to dismiss to.
		fullPage = false,
	}: {
		fullPage?: boolean;
	} = $props();

	function truncateAddr(addr: string): string {
		return addr.slice(0, 6) + '...' + addr.slice(-4);
	}

	function getPrimaryAvatarInitial(): string {
		const name = wallet.primaryAvatarName;
		if (name) return name.trim().charAt(0).toUpperCase();
		return wallet.primaryAddress ? wallet.primaryAddress.slice(2, 4).toUpperCase() : '?';
	}

	function getChildSafeInitial(addr: string): string {
		const profile = wallet.pickerProfiles[addr.toLowerCase()];
		const name = profile?.name?.trim();
		if (name) return name.charAt(0).toUpperCase();
		return addr.slice(2, 4).toUpperCase();
	}

	function getChildName(addr: string): string {
		const profile = wallet.pickerProfiles[addr.toLowerCase()];
		return profile?.name?.trim() || 'Child account';
	}

	function getChildAvatarUrl(addr: string): string {
		return wallet.pickerProfiles[addr.toLowerCase()]?.previewImageUrl || '';
	}
</script>

{#if wallet.pickerVisible}
	<div
		class="picker-overlay"
		class:full-page={fullPage}
		role="dialog"
		aria-modal="true"
		aria-label="Select account"
		onclick={(e) => { if (!fullPage && e.target === e.currentTarget) wallet.resolveChildSafePick(null); }}
		onkeydown={(e) => { if (!fullPage && e.key === 'Escape') wallet.resolveChildSafePick(null); }}
		tabindex="-1"
	>
		<div class="picker-sheet" class:full-page={fullPage}>
			<div class="picker-header">
				<h2 class="picker-title">Select account</h2>
				<p class="picker-sub">You control multiple accounts.</p>
				{#if !fullPage}
					<button
						class="picker-close"
						aria-label="Close"
						onclick={() => wallet.resolveChildSafePick(null)}
					>&#215;</button>
				{/if}
			</div>
			<div class="picker-list">
				<!-- Primary safe -->
				<button class="picker-item picker-item-primary" onclick={() => wallet.resolveChildSafePick(null)}>
					<div class="picker-avatar">
						{#if wallet.primaryAvatarImageUrl}
							<img src={wallet.primaryAvatarImageUrl} alt="avatar" class="picker-avatar-img" />
						{:else}
							<span class="picker-avatar-placeholder">{getPrimaryAvatarInitial()}</span>
						{/if}
					</div>
					<div class="picker-info">
						<span class="picker-name">{wallet.primaryAvatarName || truncateAddr(wallet.primaryAddress)}</span>
						<span class="picker-addr">{truncateAddr(wallet.primaryAddress)}</span>
					</div>
					<span class="picker-tag">Primary</span>
				</button>

				<!-- Child accounts -->
				{#each wallet.pickerSafes as safe (safe)}
					<button class="picker-item" onclick={() => wallet.resolveChildSafePick(safe)}>
						<div class="picker-avatar">
							{#if getChildAvatarUrl(safe)}
								<img src={getChildAvatarUrl(safe)} alt="avatar" class="picker-avatar-img" />
							{:else}
								<span class="picker-avatar-placeholder">{getChildSafeInitial(safe)}</span>
							{/if}
						</div>
						<div class="picker-info">
							<span class="picker-name">{getChildName(safe)}</span>
							<span class="picker-addr">{truncateAddr(safe)}</span>
						</div>
					</button>
				{/each}
			</div>
		</div>
	</div>
{/if}

<style>
	/* Child account picker overlay */
	.picker-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.45);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 200;
		padding: 0 8px 24px;
	}

	.picker-sheet {
		width: 100%;
		max-width: 480px;
		max-height: calc(100vh - 48px);
		background: var(--card);
		border-radius: var(--radius-card, 16px);
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
		display: flex;
		flex-direction: column;
	}

	/* Full-page mode (/crc-signin popup window): the picker IS the window. */
	.picker-overlay.full-page {
		align-items: stretch;
		padding: 0;
		background: var(--bg, #fff);
	}

	.picker-sheet.full-page {
		max-width: none;
		max-height: 100vh;
		min-height: 100vh;
		border-radius: 0;
		box-shadow: none;
	}

	.picker-sheet.full-page .picker-header {
		padding: 24px 20px 14px;
	}

	.picker-header {
		position: relative;
		padding: 20px 44px 12px 20px;
		border-bottom: 1px solid var(--line);
		flex-shrink: 0;
	}

	.picker-close {
		position: absolute;
		top: 12px;
		right: 12px;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: 50%;
		background: transparent;
		color: var(--muted);
		font-size: 20px;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.12s, color 0.12s;
	}

	.picker-close:hover {
		background: var(--bg-a);
		color: var(--ink);
	}

	.picker-title {
		margin: 0 0 4px;
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	.picker-sub {
		margin: 0;
		font-size: 13px;
		color: var(--muted);
		line-height: 1.4;
	}

	.picker-list {
		display: flex;
		flex-direction: column;
		overflow-y: auto;
		min-height: 0;
		-webkit-overflow-scrolling: touch;
	}

	.picker-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 20px;
		background: none;
		border: none;
		border-bottom: 1px solid var(--line);
		cursor: pointer;
		text-align: left;
		transition: background 0.12s;
	}

	.picker-item:last-child {
		border-bottom: none;
	}

	.picker-item:hover {
		background: var(--bg-a);
	}

	.picker-item-primary {
		background: var(--accent-soft, rgba(14, 0, 168, 0.04));
	}

	.picker-item-primary:hover {
		background: var(--accent-soft, rgba(14, 0, 168, 0.08));
	}

	.picker-avatar {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		overflow: hidden;
		flex-shrink: 0;
		background: var(--line-soft);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.picker-avatar-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.picker-avatar-placeholder {
		font-size: 13px;
		font-weight: 700;
		color: var(--muted);
		line-height: 1;
	}

	.picker-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.picker-name {
		font-size: 14px;
		font-weight: 600;
		color: var(--ink);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.picker-addr {
		font-size: 12px;
		color: var(--muted);
	}

	.picker-tag {
		font-size: 11px;
		font-weight: 600;
		color: var(--accent, #0e00a8);
		background: var(--accent-soft, rgba(14, 0, 168, 0.08));
		border-radius: 99px;
		padding: 2px 8px;
		white-space: nowrap;
	}
</style>
