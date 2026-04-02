<script lang="ts">
	type Transaction = {
		to: string;
		value?: string;
		data?: string;
	};

	type ApprovalRequest = {
		kind: 'tx' | 'sign';
		transactions?: Transaction[];
		message?: string;
		requestId: string;
		signatureType?: 'erc1271' | 'raw';
	};

	type Phase = 'review' | 'loading' | 'success' | 'error';

	let {
		request,
		onapprove,
		onreject,
	}: {
		request: ApprovalRequest;
		onapprove: () => Promise<string>;
		onreject: () => void;
	} = $props();

	let phase: Phase = $state('review');
	let result: string = $state('');
	let error: string = $state('');

	function truncateData(str: string, len = 66): string {
		if (str.length <= len) return str;
		return str.slice(0, len) + '...';
	}

	function formatValue(wei: string): string {
		try {
			const eth = Number(BigInt(wei)) / 1e18;
			return eth.toFixed(6) + ' xDAI';
		} catch {
			return wei + ' wei';
		}
	}

	async function handleApprove() {
		phase = 'loading';
		try {
			result = await onapprove();
			phase = 'success';
		} catch (e: any) {
			error = e?.message ?? String(e);
			phase = 'error';
		}
	}

	function handleBackdropClick() {
		if (phase === 'loading') return;
		onreject();
	}

	function handleClose() {
		onreject();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" onclick={handleBackdropClick}>
	<div class="popup" onclick={(e) => e.stopPropagation()}>
		{#if phase === 'review'}
			<h3>{request.kind === 'tx' ? 'Approve Transaction' : request.signatureType === 'raw' ? 'Sign Message (Raw)' : 'Sign Message'}</h3>

			{#if request.kind === 'tx' && request.transactions}
				<div class="details-section">
					{#each request.transactions as tx, i (i)}
						<div class="tx-card">
							<div class="tx-label">Transaction {i + 1}</div>
							<div class="tx-field">
								<span class="field-label">To:</span>
								<span class="mono">{tx.to}</span>
							</div>
							{#if tx.value && tx.value !== '0' && tx.value !== '0x0'}
								<div class="tx-field">
									<span class="field-label">Value:</span>
									<span class="mono">{formatValue(tx.value)}</span>
								</div>
							{/if}
							{#if tx.data && tx.data !== '0x'}
								<div class="tx-field">
									<span class="field-label">Data:</span>
									<span class="mono">{truncateData(tx.data)}</span>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else if request.kind === 'sign' && request.message}
				<div class="details-section">
					<div class="tx-card">
						<div class="tx-label">Message</div>
						<div class="message-content mono">{request.message}</div>
					</div>
					<div class="sig-type-badge">
						{request.signatureType === 'raw' ? 'Raw bytes · auth service' : 'EIP-191 · ERC-1271 standard'}
					</div>
				</div>
			{/if}

			<div class="button-row">
				<button class="btn btn-reject" onclick={onreject}>Reject</button>
				<button class="btn btn-approve" onclick={handleApprove}>Approve</button>
			</div>

		{:else if phase === 'loading'}
			<h3>{request.kind === 'tx' ? 'Sending Transaction...' : request.signatureType === 'raw' ? 'Signing (raw)...' : 'Signing...'}</h3>
			<div class="loading-container">
				<div class="spinner"></div>
				<p>Waiting for confirmation</p>
			</div>
			<div class="button-row">
				<button class="btn btn-reject" disabled>Reject</button>
				<button class="btn btn-approve" disabled>
					<span class="btn-spinner"></span>
					Processing...
				</button>
			</div>

		{:else if phase === 'success'}
			<h3>Success</h3>
			<div class="result-section success">
				{#if request.kind === 'tx'}
					<p>Transaction confirmed!</p>
					<div class="mono result-value">{truncateData(result)}</div>
					<a
						href="https://gnosisscan.io/tx/{result}"
						target="_blank"
						rel="noopener noreferrer"
						class="scan-link"
					>
						View on GnosisScan
					</a>
				{:else}
					<p>Message signed!</p>
					<div class="mono result-value">{truncateData(result, 80)}</div>
				{/if}
			</div>
			<div class="button-row">
				<button class="btn btn-close" onclick={handleClose}>Close</button>
			</div>

		{:else if phase === 'error'}
			<h3>Error</h3>
			<div class="result-section error-result">
				<p>{error}</p>
			</div>
			<div class="button-row">
				<button class="btn btn-close" onclick={handleClose}>Close</button>
			</div>
		{/if}
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
		background: rgba(255, 255, 255, 0.92);
		backdrop-filter: blur(6px);
		border-radius: var(--radius-card) var(--radius-card) 0 0;
		border-top: 1px solid var(--line);
		width: 100%;
		max-width: 480px;
		max-height: 60vh;
		overflow-y: auto;
		padding: 22px;
		animation: slideUp 0.25s cubic-bezier(0.35, 0.15, 0, 1);
		box-shadow: var(--shadow-card);
	}

	h3 {
		margin: 0 0 16px 0;
		font-size: 17px;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--ink);
	}

	.details-section {
		margin-bottom: 20px;
	}

	.tx-card {
		background: var(--bg-a);
		border: 1px solid var(--line);
		border-radius: var(--radius-sm);
		padding: 12px 14px;
		margin-bottom: 8px;
	}

	.tx-card:last-child {
		margin-bottom: 0;
	}

	.tx-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 8px;
	}

	.tx-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 8px;
	}

	.tx-field:last-child {
		margin-bottom: 0;
	}

	.field-label {
		font-size: 12px;
		color: var(--muted);
		font-weight: 500;
	}

	.mono {
		font-family: 'SF Mono', ui-monospace, monospace;
		font-size: 12px;
		word-break: break-all;
		color: var(--ink);
	}

	.message-content {
		white-space: pre-wrap;
		line-height: 1.5;
	}

	.button-row {
		display: flex;
		gap: 10px;
		margin-top: 20px;
	}

	.btn {
		flex: 1;
		padding: 13px 16px;
		border: none;
		border-radius: var(--radius-pill);
		font-size: 15px;
		font-weight: 600;
		cursor: pointer;
		transition: opacity 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}

	.btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.btn:hover:not(:disabled) {
		opacity: 0.85;
	}

	.btn-approve {
		background: linear-gradient(130deg, var(--accent), var(--accent-mid));
		color: #fff;
	}

	.btn-reject {
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--line);
	}

	.btn-close {
		background: var(--card);
		color: var(--ink);
		border: 1px solid var(--line);
	}

	.loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 20px 0;
		color: var(--muted);
		font-size: 14px;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--line);
		border-top-color: var(--accent-mid);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		margin-bottom: 12px;
	}

	.btn-spinner {
		width: 15px;
		height: 15px;
		border: 2px solid rgba(255, 255, 255, 0.35);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
		display: inline-block;
	}

	.result-section {
		border-radius: var(--radius-sm);
		padding: 14px;
		margin-bottom: 4px;
		border: 1px solid var(--line);
	}

	.result-section.success {
		background: var(--success-bg);
		border-color: var(--success-bg);
	}

	.result-section.error-result {
		background: var(--error-bg);
		border-color: var(--error-bg);
	}

	.result-section p {
		margin: 0 0 8px 0;
		font-weight: 500;
		font-size: 14px;
	}

	.success p {
		color: var(--success-ink);
	}

	.error-result p {
		color: var(--error-ink);
	}

	.result-value {
		background: rgba(0, 0, 0, 0.04);
		padding: 8px 10px;
		border-radius: 8px;
		margin-bottom: 10px;
	}

	.scan-link {
		display: inline-block;
		color: var(--accent-mid);
		font-weight: 500;
		font-size: 13px;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.scan-link:hover {
		color: var(--accent);
	}

	.sig-type-badge {
		font-size: 11px;
		color: var(--muted);
		margin-top: 6px;
		padding: 4px 8px;
		background: var(--accent-soft);
		border-radius: 6px;
		display: inline-block;
	}
</style>
