/**
 * Per-account order history — a local, privacy-friendly record of redemptions.
 *
 * Each order is what the customer actually cares about: when, how many dAMS, and
 * at which shop. The on-chain tx hash is kept only so a receipt can deep-link to
 * the explorer; the history UI abstracts it away and shows just time + amount.
 *
 * Stored in localStorage under `dams.orders.<addr>` (lowercased). This is also the
 * source of truth for the two-stage offer: an account with zero orders sees the
 * 48-dAMS signup offer; once it has at least one, it sees the follow-up offer.
 */

export interface Order {
	amount: number; // dAMS spent
	shop: string; // shop address
	shopName: string; // resolved display name at time of purchase (the recipient)
	offerLabel: string; // which offer this was, e.g. "Welcome offer" / "Follow-up offer"
	txHash: string; // on-chain hash (kept for the receipt link; hidden in history)
	at: number; // epoch ms
}

function ordersKey(addr: string): string {
	return `dams.orders.${addr.toLowerCase()}`;
}

// Newest first. Never throws — a corrupt/absent store reads as an empty history.
export function readOrders(addr: string): Order[] {
	try {
		const raw = localStorage.getItem(ordersKey(addr));
		if (!raw) return [];
		const arr = JSON.parse(raw);
		if (!Array.isArray(arr)) return [];
		return (arr as Order[]).slice().sort((a, b) => b.at - a.at);
	} catch {
		return [];
	}
}

// Prepend a new order; returns the updated (newest-first) list.
export function addOrder(addr: string, order: Order): Order[] {
	const next = [order, ...readOrders(addr)];
	try {
		localStorage.setItem(ordersKey(addr), JSON.stringify(next));
	} catch {
		/* ignore quota/serialization errors — history is best-effort */
	}
	return next;
}

// True until the account has redeemed at least once (drives the signup offer).
export function isFirstPurchase(addr: string): boolean {
	return readOrders(addr).length === 0;
}
