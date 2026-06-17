/**
 * Challenge strings + signature verification.
 *
 * Customer wallets are Safe smart accounts, so signatures are EIP-1271, not plain
 * ECDSA. We verify with viem's `verifyMessage`, which validates both EOA and
 * smart-contract (ERC-1271) signatures against the claimed address — proving the
 * holder of that address signed, without trusting the client's address claim.
 *
 * The miniapp signs with the host's default `'erc1271'` signature type, which
 * EIP-191-prefix-hashes the message before the Safe signs it — exactly what
 * `verifyMessage` checks.
 *
 * IMPORTANT: the customer challenge string here MUST stay byte-for-byte identical
 * to `stampChallenge` in the frontend's loyalty.ts, or signatures won't verify.
 */
import { createPublicClient, getAddress, http, type Address, type Hex } from 'viem';
import { gnosis } from 'viem/chains';

/** Message a customer signs to collect a stamp. Binds shop + daily secret. */
export function stampChallenge(group: Address, secret: string): string {
	return [
		'Coffee Loyalty — collect a stamp',
		`Shop: ${getAddress(group)}`,
		`Secret: ${secret}`
	].join('\n');
}

/** Message the owner signs to unlock the dashboard (secret + customer list). */
export function ownerChallenge(group: Address, date: string): string {
	return ['Coffee Loyalty — owner dashboard', `Shop: ${getAddress(group)}`, `Date: ${date}`].join(
		'\n'
	);
}

/** Message the owner signs to redeem a specific customer's free-coffee NFT. */
export function redeemChallenge(customer: Address, tokenId: string): string {
	return [
		'Coffee Loyalty — redeem free coffee',
		`Customer: ${getAddress(customer)}`,
		`Token: ${tokenId}`
	].join('\n');
}

/**
 * Verify `signature` over `message` was produced by `address` (EOA or Safe).
 * Returns false on any verification failure rather than throwing.
 */
export async function verifySignedBy(
	rpcUrl: string,
	address: Address,
	message: string,
	signature: Hex
): Promise<boolean> {
	try {
		const client = createPublicClient({ chain: gnosis, transport: http(rpcUrl) });
		return await client.verifyMessage({ address: getAddress(address), message, signature });
	} catch {
		return false;
	}
}
