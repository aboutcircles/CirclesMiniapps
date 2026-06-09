<script lang="ts">
	import { SAFE_MGMT_LABELS } from './txPolicy.ts';

	type Transaction = { to: string; value?: string; data?: string };

	let {
		reason,
		transactions,
		onclose
	}: {
		reason: string;
		transactions: Transaction[];
		onclose: () => void;
	} = $props();

	// Parse "Transaction N: ..." from the policy reason. Falls back to 0.
	const offendingIndex = $derived.by(() => {
		const m = reason.match(/^Transaction (\d+):/);
		return m ? Math.min(parseInt(m[1], 10), transactions.length - 1) : 0;
	});

	const offendingTx = $derived(transactions[offendingIndex] ?? null);

	const selector = $derived(
		offendingTx?.data
			? offendingTx.data.slice(0, 10).toLowerCase()
			: ''
	);

	const humanLabel = $derived(
		selector && SAFE_MGMT_LABELS[selector] ? SAFE_MGMT_LABELS[selector] : null
	);

	function truncate(str: string, len = 66): string {
		return str.length <= len ? str : str.slice(0, len) + '…';
	}

	function handleBackdropClick() {
		onclose();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={handleBackdropClick}>
	<div class="popup" onclick={(e) => e.stopPropagation()}>
		<div class="header">
			<div class="badge">Blocked</div>
			<h3>Restricted action</h3>
		</div>

		<p class="lead">
			This mini app tried to send a transaction that the host blocks for safety.
			No transaction was sent and your wallet is unchanged.
		</p>

		{#if humanLabel}
			<div class="action-card">
				<div class="action-label">Attempted action</div>
				<div class="action-name">{humanLabel}</div>
				<div class="action-selector mono">selector {selector}</div>
			</div>
		{:else}
			<div class="action-card">
				<div class="action-label">Reason</div>
				<div class="action-name">{reason}</div>
			</div>
		{/if}

		{#if offendingTx}
			<details class="raw-details">
				<summary>Transaction details</summary>
				<div class="raw-content">
					<div class="raw-field">
						<span class="raw-key">To</span>
						<span class="mono">{offendingTx.to}</span>
					</div>
					{#if offendingTx.value && offendingTx.value !== '0' && offendingTx.value !== '0x0'}
						<div class="raw-field">
							<span class="raw-key">Value</span>
							<span class="mono">{offendingTx.value}</span>
						</div>
					{/if}
					{#if offendingTx.data && offendingTx.data !== '0x'}
						<div class="raw-field">
							<span class="raw-key">Data</span>
							<span class="mono">{truncate(offendingTx.data)}</span>
						</div>
					{/if}
					<div class="raw-field">
						<span class="raw-key">Reason</span>
						<span class="mono">{reason}</span>
					</div>
				</div>
			</details>
		{/if}

		<div class="button-row">
			<button class="btn" onclick={onclose}>Dismiss</button>
		</div>
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
	}

	.popup {
		background: rgba(255, 255, 255, 0.96);
		backdrop-filter: blur(6px);
		border-radius: var(--radius-card) var(--radius-card) 0 0;
		border-top: 1px solid var(--line);
		width: 100%;
		max-width: 480px;
		max-height: 70vh;
		overflow-y: auto;
		padding: 22px;
		animation: slideUp 0.25s cubic-bezier(0.35, 0.15, 0, 1);
		box-shadow: var(--shadow-card);
	}

	.header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
	}

	.badge {
		padding: 4px 10px;
		border-radius: var(--radius-pill);
		background: rgba(220, 38, 38, 0.12);
		color: #b91c1c;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	h3 {
		margin: 0;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	.lead {
		margin: 0 0 16px;
		font-size: 14px;
		line-height: 1.5;
		color: var(--muted);
	}

	.action-card {
		background: var(--bg-a);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 12px 14px;
		margin-bottom: 12px;
	}

	.action-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 6px;
	}

	.action-name {
		font-size: 15px;
		font-weight: 600;
		color: var(--ink);
		line-height: 1.3;
	}

	.action-selector {
		margin-top: 4px;
		font-size: 11px;
		color: var(--muted);
	}

	.raw-details {
		margin: 0 0 16px;
	}

	.raw-details summary {
		font-size: 12px;
		color: var(--muted);
		cursor: pointer;
		padding: 6px 0;
		user-select: none;
	}

	.raw-content {
		background: var(--bg-a);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 10px 12px;
		margin-top: 6px;
	}

	.raw-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
	}

	.raw-field:last-child {
		border-bottom: none;
	}

	.raw-key {
		font-size: 11px;
		color: var(--muted);
		font-weight: 500;
	}

	.mono {
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 12px;
		word-break: break-all;
		color: var(--ink);
	}

	.button-row {
		display: flex;
		gap: 10px;
	}

	.btn {
		flex: 1;
		padding: 13px 16px;
		border: 1px solid var(--line);
		background: var(--card);
		color: var(--ink);
		border-radius: var(--radius-pill);
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
	}

	.btn:hover {
		opacity: 0.85;
	}

	@keyframes slideUp {
		from {
			transform: translateY(100%);
		}
		to {
			transform: translateY(0);
		}
	}
</style>
