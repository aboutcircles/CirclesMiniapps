<script lang="ts">
	import { decodeOperation, detectCirclesTransferBatch, type DecodedOp } from './decodeOperation.ts';
	import {
		circlesTokenIdToAvatar,
		formatAmount,
		formatToken,
		formatTokenAmount,
		isCirclesHub,
		shortenAddress
	} from './tokenMetadata.ts';

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
		fullPage = false,
	}: {
		request: ApprovalRequest;
		onapprove: () => Promise<string>;
		onreject: () => void;
		// When embedded as the sole content of a popup iframe window (e.g. /crc-signin),
		// render the approval UI filling the whole page instead of as a bottom sheet
		// overlaying a host app.
		fullPage?: boolean;
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

	function decode(tx: Transaction): DecodedOp {
		return decodeOperation(tx);
	}

	function describeAmount(raw: bigint, tokenAddress: string): string {
		const { display, symbol } = formatTokenAmount(raw, tokenAddress);
		return symbol ? `${display} ${symbol}` : display;
	}

	function formatCrcAmount(raw: bigint): string {
		// Circles atto-CRC uses 18 decimals.
		return `${formatAmount(raw, 18)} CRC`;
	}

	const decodedOps = $derived(
		request.kind === 'tx' && request.transactions
			? request.transactions.map((t) => decodeOperation(t))
			: []
	);

	const circlesBatch = $derived(
		decodedOps.length > 1 ? detectCirclesTransferBatch(decodedOps) : null
	);

	function formatExpiry(expiry: bigint): string {
		try {
			const date = new Date(Number(expiry) * 1000);
			if (Number.isNaN(date.getTime())) return expiry.toString();
			return date.toISOString().slice(0, 10);
		} catch {
			return expiry.toString();
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
<div class="backdrop" class:full-page={fullPage} onclick={handleBackdropClick}>
	<div class="popup" class:full-page={fullPage} onclick={(e) => e.stopPropagation()}>
		{#if phase === 'review'}
			<h3>{request.kind === 'tx' ? 'Approve Transaction' : request.signatureType === 'raw' ? 'Sign Message (Raw)' : 'Sign Message'}</h3>

			{#if request.kind === 'tx' && request.transactions}
				<div class="details-section">
					{#if circlesBatch}
						<div class="tx-card">
							<div class="op-headline">Send Circles</div>
							{#if circlesBatch.recipient}
								<div class="op-field">
									<span class="op-key">To</span>
									<span class="mono">{shortenAddress(circlesBatch.recipient)}</span>
								</div>
							{/if}
							<div class="op-field">
								<span class="op-key">Amount</span>
								<span>{formatCrcAmount(circlesBatch.amount)}</span>
							</div>
							<details class="raw-details">
								<summary>Show {circlesBatch.steps} underlying step{circlesBatch.steps === 1 ? '' : 's'}</summary>
								<div class="raw-content">
									{#each request.transactions as tx, i (i)}
										<div class="raw-field">
											<span class="raw-key">Step {i + 1}</span>
											<span class="mono">{tx.to}</span>
											{#if tx.data && tx.data !== '0x'}
												<span class="mono">{truncateData(tx.data)}</span>
											{/if}
										</div>
									{/each}
								</div>
							</details>
						</div>
					{:else}
					{#each request.transactions as tx, i (i)}
						{@const op = decode(tx)}
						<div class="tx-card" class:risky={op.kind === 'safe-management' || (op.kind === 'erc20-approve' && op.isUnlimited)}>
							<div class="tx-label">Transaction {i + 1}</div>

							{#if op.kind === 'native-transfer'}
								<div class="op-headline">Send xDAI</div>
								<div class="op-field">
									<span class="op-key">To</span>
									<span class="mono">{shortenAddress(op.to)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Amount</span>
									<span>{formatValue(op.value.toString())}</span>
								</div>

							{:else if op.kind === 'erc20-transfer'}
								<div class="op-headline">Transfer {formatToken(op.token)}</div>
								<div class="op-field">
									<span class="op-key">To</span>
									<span class="mono">{shortenAddress(op.to)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Amount</span>
									<span>{describeAmount(op.amount, op.token)}</span>
								</div>

							{:else if op.kind === 'erc20-transfer-from'}
								<div class="op-headline">Transfer {formatToken(op.token)} (from)</div>
								<div class="op-field">
									<span class="op-key">From</span>
									<span class="mono">{shortenAddress(op.from)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">To</span>
									<span class="mono">{shortenAddress(op.to)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Amount</span>
									<span>{describeAmount(op.amount, op.token)}</span>
								</div>

							{:else if op.kind === 'erc20-approve'}
								<div class="op-headline">
									Approve {formatToken(op.token)}
									{#if op.isUnlimited}<span class="risk-tag">Unlimited</span>{/if}
								</div>
								<div class="op-field">
									<span class="op-key">Spender</span>
									<span class="mono">{shortenAddress(op.spender)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Amount</span>
									<span>{op.isUnlimited ? 'Unlimited' : describeAmount(op.amount, op.token)}</span>
								</div>

							{:else if op.kind === 'erc1155-transfer'}
								{@const isCrc = isCirclesHub(op.contract)}
								<div class="op-headline">{isCrc ? 'Send Circles' : 'Transfer ERC-1155 token'}</div>
								<div class="op-field">
									<span class="op-key">Contract</span>
									<span class="mono">{formatToken(op.contract)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">From</span>
									<span class="mono">{shortenAddress(op.from)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">To</span>
									<span class="mono">{shortenAddress(op.to)}</span>
								</div>
								{#if isCrc}
									<div class="op-field">
										<span class="op-key">Issuer</span>
										<span class="mono">{shortenAddress(circlesTokenIdToAvatar(op.tokenId))}</span>
									</div>
								{:else}
									<div class="op-field">
										<span class="op-key">Token ID</span>
										<span class="mono">{op.tokenId.toString()}</span>
									</div>
								{/if}
								<div class="op-field">
									<span class="op-key">Amount</span>
									<span>{describeAmount(op.amount, op.contract)}</span>
								</div>

							{:else if op.kind === 'erc1155-batch-transfer'}
								{@const isCrcBatch = isCirclesHub(op.contract)}
								{@const total = op.amounts.reduce((s, a) => s + a, 0n)}
								<div class="op-headline">{isCrcBatch ? 'Send Circles (batch)' : 'Batch transfer ERC-1155 tokens'}</div>
								<div class="op-field">
									<span class="op-key">Contract</span>
									<span class="mono">{formatToken(op.contract)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">From</span>
									<span class="mono">{shortenAddress(op.from)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">To</span>
									<span class="mono">{shortenAddress(op.to)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">{isCrcBatch ? 'Issuers' : 'Tokens'}</span>
									<span>{op.tokenIds.length}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Total</span>
									<span>{describeAmount(total, op.contract)}</span>
								</div>

							{:else if op.kind === 'erc1155-approve-all'}
								<div class="op-headline">
									{op.approved ? 'Approve' : 'Revoke'} operator
									{#if op.approved}<span class="risk-tag">All tokens</span>{/if}
								</div>
								<div class="op-field">
									<span class="op-key">Contract</span>
									<span class="mono">{formatToken(op.contract)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Operator</span>
									<span class="mono">{shortenAddress(op.operator)}</span>
								</div>

							{:else if op.kind === 'hub-trust'}
								<div class="op-headline">Trust avatar</div>
								<div class="op-field">
									<span class="op-key">Trustee</span>
									<span class="mono">{shortenAddress(op.trustee)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Expires</span>
									<span>{formatExpiry(op.expiry)}</span>
								</div>

							{:else if op.kind === 'hub-untrust'}
								<div class="op-headline">Revoke trust</div>
								<div class="op-field">
									<span class="op-key">Trustee</span>
									<span class="mono">{shortenAddress(op.trustee)}</span>
								</div>

							{:else if op.kind === 'hub-wrap'}
								<div class="op-headline">Wrap Circles tokens</div>
								<div class="op-field">
									<span class="op-key">Avatar</span>
									<span class="mono">{shortenAddress(op.avatar)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Amount</span>
									<span>{op.amount.toString()}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Type</span>
									<span>{op.tokenType === 0 ? 'Demurrage' : op.tokenType === 1 ? 'Inflationary' : `Type ${op.tokenType}`}</span>
								</div>

							{:else if op.kind === 'hub-personal-mint'}
								<div class="op-headline">Mint personal Circles</div>

							{:else if op.kind === 'hub-flow-matrix'}
								<div class="op-headline">Send Circles</div>
								{#if op.recipient}
									<div class="op-field">
										<span class="op-key">To</span>
										<span class="mono">{shortenAddress(op.recipient)}</span>
									</div>
								{/if}
								<div class="op-field">
									<span class="op-key">Amount</span>
									<span>{op.amount > 0n ? formatCrcAmount(op.amount) : `${op.flowCount} flow edges`}</span>
								</div>

							{:else if op.kind === 'wrapper-unwrap'}
								<div class="op-headline">Unwrap Circles tokens</div>
								<div class="op-field">
									<span class="op-key">Wrapper</span>
									<span class="mono">{shortenAddress(op.wrapper)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Amount</span>
									<span>{op.amount.toString()}</span>
								</div>

							{:else if op.kind === 'safe-management'}
								<div class="op-headline">
									{op.label}
									<span class="risk-tag risk-tag-red">Safe op</span>
								</div>
								<div class="op-field">
									<span class="op-key">On Safe</span>
									<span class="mono">{shortenAddress(op.safe)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Selector</span>
									<span class="mono">{op.selector}</span>
								</div>

							{:else}
								<div class="op-headline">Unknown call</div>
								<div class="op-field">
									<span class="op-key">To</span>
									<span class="mono">{shortenAddress(op.to)}</span>
								</div>
								<div class="op-field">
									<span class="op-key">Selector</span>
									<span class="mono">{op.selector}</span>
								</div>
							{/if}

							<details class="raw-details">
								<summary>Show raw calldata</summary>
								<div class="raw-content">
									<div class="raw-field">
										<span class="raw-key">To</span>
										<span class="mono">{tx.to}</span>
									</div>
									{#if tx.value && tx.value !== '0' && tx.value !== '0x0'}
										<div class="raw-field">
											<span class="raw-key">Value</span>
											<span class="mono">{formatValue(tx.value)}</span>
										</div>
									{/if}
									{#if tx.data && tx.data !== '0x'}
										<div class="raw-field">
											<span class="raw-key">Data</span>
											<span class="mono">{truncateData(tx.data)}</span>
										</div>
									{/if}
								</div>
							</details>
						</div>
					{/each}
					{/if}
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

	/* Full-page mode: the approval UI is the sole content of a popup iframe window,
	   so it fills the entire viewport rather than floating as a bottom sheet. */
	.backdrop.full-page {
		align-items: stretch;
		background: var(--bg, #fff);
	}

	.popup.full-page {
		max-width: none;
		max-height: none;
		min-height: 100vh;
		border-radius: 0;
		border-top: none;
		box-shadow: none;
		backdrop-filter: none;
		background: transparent;
		display: flex;
		flex-direction: column;
		padding: 24px 20px;
		animation: none;
	}

	/* Push the action buttons to the bottom of the page so they sit consistently
	   at the foot of the popup window regardless of content height. */
	.popup.full-page .button-row {
		margin-top: auto;
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

	.tx-card.risky {
		border-color: rgba(220, 38, 38, 0.35);
		background: rgba(220, 38, 38, 0.04);
	}

	.tx-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin-bottom: 8px;
	}

	.op-headline {
		font-size: 15px;
		font-weight: 600;
		color: var(--ink);
		margin-bottom: 10px;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}

	.op-field {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		padding: 4px 0;
		font-size: 13px;
	}

	.op-key {
		color: var(--muted);
		font-weight: 500;
		flex-shrink: 0;
	}

	.risk-tag {
		display: inline-block;
		padding: 2px 8px;
		border-radius: var(--radius-pill);
		background: rgba(234, 179, 8, 0.18);
		color: #92400e;
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.risk-tag-red {
		background: rgba(220, 38, 38, 0.18);
		color: #b91c1c;
	}

	.raw-details {
		margin-top: 10px;
	}

	.raw-details summary {
		font-size: 11px;
		color: var(--muted);
		cursor: pointer;
		padding: 4px 0;
		user-select: none;
	}

	.raw-content {
		margin-top: 6px;
		padding: 8px 10px;
		background: rgba(0, 0, 0, 0.03);
		border-radius: 8px;
	}

	.raw-field {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 0;
	}

	.raw-key {
		font-size: 11px;
		color: var(--muted);
		font-weight: 500;
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
