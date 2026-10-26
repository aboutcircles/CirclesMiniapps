import { isAddress, type Address } from 'viem';

/** The `account` field of a POST /invite body, or null when it is not an address. */
export function readAccount(body: unknown): Address | null {
	if (typeof body !== 'object' || body === null) return null;
	const account = (body as { account?: unknown }).account;
	// isAddress calls string methods on its argument, so check the type first.
	if (typeof account !== 'string' || !isAddress(account, { strict: false })) return null;
	return account;
}
