/**
 * Host-side transaction policy applied to iframe-supplied transactions before
 * they reach the wallet. A mini-app speaks to the host via postMessage and the
 * host signs whatever it forwards — without filtering, a hostile iframe could
 * change Safe owners, add modules, swap the guard, or relay a forged
 * `execTransaction` into a sibling Safe. This module blocks those vectors.
 */

export type IframeTx = { to: string; data?: string; value?: string };

/**
 * 4-byte selectors for Safe management functions. A mini-app has no
 * legitimate reason to invoke these against any Safe. `execTransaction` is
 * included because in child-safe mode the wallet wraps user txs in
 * `childSafe.execTransaction(...)`; allowing a raw `execTransaction` selector
 * through would let the iframe construct a call from the child safe back into
 * the primary (or any other Safe that trusts the child as an owner) via the
 * prevalidated-signature path.
 */
export const SAFE_MGMT_SELECTORS: ReadonlySet<string> = new Set([
	'0x0d582f13', // addOwnerWithThreshold(address,uint256)
	'0xf8dc5dd9', // removeOwner(address,address,uint256)
	'0xe318b52b', // swapOwner(address,address,address)
	'0x694e80c3', // changeThreshold(uint256)
	'0xe19a9dd9', // setGuard(address)
	'0xf08a0323', // setFallbackHandler(address)
	'0x610b5925', // enableModule(address)
	'0xe009cfde', // disableModule(address,address)
	'0x6a761202'  // execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)
]);

/** Human-readable label for each blocked selector, used in user-facing reject popups. */
export const SAFE_MGMT_LABELS: Readonly<Record<string, string>> = {
	'0x0d582f13': 'Add Safe owner',
	'0xf8dc5dd9': 'Remove Safe owner',
	'0xe318b52b': 'Swap Safe owner',
	'0x694e80c3': 'Change signature threshold',
	'0xe19a9dd9': 'Set Safe guard',
	'0xf08a0323': 'Set Safe fallback handler',
	'0x610b5925': 'Enable Safe module',
	'0xe009cfde': 'Disable Safe module',
	'0x6a761202': 'Execute arbitrary Safe transaction'
};

export type PolicyResult =
	| { allowed: true }
	| { allowed: false; reason: string };

/**
 * Decide whether a batch of iframe-supplied transactions is safe to forward.
 *
 * `protectedSafes` should include every Safe whose state could be mutated by
 * the wallet — at minimum the currently-acting Safe, plus the primary Safe
 * when operating in child-safe mode (the primary is the actual user-op
 * sender wrapping calls in `execTransaction`, so it's an equally valid
 * target for a smuggled self-call).
 *
 * The batch is rejected as a whole on the first offending tx — partial
 * approval would let an attacker hide a malicious call inside a plausible
 * batch.
 */
export function checkTransactions(
	txs: IframeTx[],
	protectedSafes: string[]
): PolicyResult {
	const blocked = new Set(
		protectedSafes.filter((a) => !!a).map((a) => a.toLowerCase())
	);

	for (let i = 0; i < txs.length; i++) {
		const tx = txs[i];
		const to = (tx.to ?? '').toLowerCase();
		if (!to) {
			return { allowed: false, reason: `Transaction ${i}: missing "to"` };
		}

		if (blocked.has(to)) {
			return {
				allowed: false,
				reason: `Transaction ${i}: direct calls to the Safe are not allowed`
			};
		}

		const selector = (tx.data ?? '').slice(0, 10).toLowerCase();
		if (selector.length === 10 && SAFE_MGMT_SELECTORS.has(selector)) {
			return {
				allowed: false,
				reason: `Transaction ${i}: Safe management call (${selector}) is not allowed`
			};
		}
	}

	return { allowed: true };
}
