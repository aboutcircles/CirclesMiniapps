/**
 * Shared utilities for pages that host a mini-app inside an iframe and
 * proxy wallet operations between the iframe and the wallet store.
 *
 * The four host pages (miniapps/[slug], playground, admin, admin/[slug])
 * all implement the same postMessage protocol — extracted here so each
 * page only owns its layout, not the protocol logic.
 */

import { wallet } from './wallet.svelte.ts';
import { checkTransactions } from './txPolicy.ts';

export type PendingRequest = {
	kind: 'tx' | 'sign';
	transactions?: any[];
	message?: string;
	signatureType?: 'erc1271' | 'raw';
	requestId: string;
};

export function truncateAddr(addr: string): string {
	return addr.slice(0, 6) + '...' + addr.slice(-4);
}

/** First letter of the avatar name, or two hex chars from the address, or '?'. */
export function getAvatarInitial(name: string | undefined, address: string | undefined): string {
	if (name) return name.trim().charAt(0).toUpperCase();
	return address ? address.slice(2, 4).toUpperCase() : '?';
}

/** Post a message to a cross-origin source window safely. */
export function postTo(source: MessageEventSource | null, data: any) {
	try {
		(source as Window)?.postMessage(data, '*');
	} catch {
		// cross-origin access blocked — ignore
	}
}

/**
 * Build a postMessage handler for the iframe protocol.
 *
 * - `getAppData` is invoked on every `request_address` to look up the optional
 *   base64-encoded `?data=` URL parameter. Each page reads this differently
 *   (via $page on the route), so it's injected.
 * - `setPending` and `setPendingSource` mutate the page's reactive state for
 *   transaction/signature approvals.
 * - `enforceTxPolicy` gates the host-side transaction filter. Pages that host
 *   untrusted iframes (e.g. Circles Garage) pass `true`; pages hosting
 *   first-party tools leave it at the default `false`.
 */
export function createMessageHandler(opts: {
	getAppData: () => string | null;
	setPending: (req: PendingRequest | null) => void;
	setPendingSource: (s: MessageEventSource | null) => void;
	enforceTxPolicy?: boolean;
	onPolicyRejection?: (info: { reason: string; transactions: any[] }) => void;
	onAddressRequested?: (info: { hadWallet: boolean }) => void;
	onTransactionRequested?: (info: { txCount: number; hadWallet: boolean }) => void;
	onSignatureRequested?: (info: { signatureType: 'erc1271' | 'raw' }) => void;
	onTxAutoRejected?: (info: { reason: 'no_wallet' | 'invalid_data' }) => void;
	onSignAutoRejected?: (info: { reason: 'no_wallet' | 'invalid_data' }) => void;
}) {
	return function handleMessage(event: MessageEvent) {
		const { data } = event;
		if (!data || !data.type) return;

		switch (data.type) {
			case 'request_address': {
				const hadWallet = wallet.connected;
				opts.onAddressRequested?.({ hadWallet });
				if (hadWallet) {
					postTo(event.source, { type: 'wallet_connected', address: wallet.address });
				} else {
					postTo(event.source, { type: 'wallet_disconnected' });
				}
				const raw = opts.getAppData();
				if (raw) {
					try {
						postTo(event.source, { type: 'app_data', data: atob(raw) });
					} catch {
						postTo(event.source, { type: 'app_data', data: raw });
					}
				}
				return;
			}

			case 'send_transactions': {
				const hadWallet = wallet.connected;
				const txCount = Array.isArray(data.transactions) ? data.transactions.length : 0;
				opts.onTransactionRequested?.({ txCount, hadWallet });
				if (!hadWallet) {
					postTo(event.source, { type: 'tx_rejected', reason: 'Wallet not connected', requestId: data.requestId });
					opts.onTxAutoRejected?.({ reason: 'no_wallet' });
					return;
				}
				if (!data.transactions || !Array.isArray(data.transactions)) {
					postTo(event.source, { type: 'tx_rejected', reason: 'No transactions provided', requestId: data.requestId });
					opts.onTxAutoRejected?.({ reason: 'invalid_data' });
					return;
				}
				// Reject before showing the approval popup so the user can't accidentally
				// rubber-stamp a hostile mini-app call. `primaryAddress` matters even in
				// child-safe mode because the primary is the actual user-op sender.
				if (opts.enforceTxPolicy) {
					const policy = checkTransactions(data.transactions, [wallet.address, wallet.primaryAddress]);
					if (!policy.allowed) {
						postTo(event.source, { type: 'tx_rejected', reason: policy.reason, requestId: data.requestId });
						opts.onPolicyRejection?.({ reason: policy.reason, transactions: data.transactions });
						return;
					}
				}
				opts.setPendingSource(event.source);
				opts.setPending({ kind: 'tx', transactions: data.transactions, requestId: data.requestId });
				return;
			}

			case 'sign_message': {
				const hadWallet = wallet.connected;
				const signatureType: 'erc1271' | 'raw' = data.signatureType === 'raw' ? 'raw' : 'erc1271';
				opts.onSignatureRequested?.({ signatureType });
				if (!hadWallet) {
					postTo(event.source, { type: 'sign_rejected', reason: 'Wallet not connected', requestId: data.requestId });
					opts.onSignAutoRejected?.({ reason: 'no_wallet' });
					return;
				}
				if (!data.message) {
					postTo(event.source, { type: 'sign_rejected', reason: 'No message provided', requestId: data.requestId });
					opts.onSignAutoRejected?.({ reason: 'invalid_data' });
					return;
				}
				opts.setPendingSource(event.source);
				opts.setPending({
					kind: 'sign',
					message: data.message,
					signatureType,
					requestId: data.requestId
				});
				return;
			}
		}
	};
}

/**
 * Build the approve/reject handlers for an active pending request.
 *
 * Pages call `getPending`/`getPendingSource` so this captures the live values
 * each time a button is clicked, not just whichever closure was set up first.
 */
export function createApprovalHandlers(opts: {
	getPending: () => PendingRequest | null;
	getPendingSource: () => MessageEventSource | null;
	setPending: (req: PendingRequest | null) => void;
	setPendingSource: (s: MessageEventSource | null) => void;
}) {
	async function handleApprove(): Promise<string> {
		const pending = opts.getPending();
		if (!pending) return '';
		const source = opts.getPendingSource();

		if (pending.kind === 'tx') {
			const hash = await wallet.sendTransactions(pending.transactions!);
			postTo(source, { type: 'tx_success', hashes: [hash], requestId: pending.requestId });
			opts.setPending(null);
			opts.setPendingSource(null);
			return hash;
		}

		if (pending.kind === 'sign') {
			const { signature, verified } = pending.signatureType === 'raw'
				? await wallet.signMessage(pending.message!)
				: { signature: await wallet.signErc1271Message(pending.message!), verified: true };
			postTo(source, { type: 'sign_success', signature, verified, requestId: pending.requestId });
			opts.setPending(null);
			opts.setPendingSource(null);
			return signature;
		}

		return '';
	}

	function handleReject() {
		const pending = opts.getPending();
		if (!pending) return;
		const source = opts.getPendingSource();
		const rejectType = pending.kind === 'tx' ? 'tx_rejected' : 'sign_rejected';
		postTo(source, { type: rejectType, reason: 'User rejected', requestId: pending.requestId });
		opts.setPending(null);
		opts.setPendingSource(null);
	}

	return { handleApprove, handleReject };
}
