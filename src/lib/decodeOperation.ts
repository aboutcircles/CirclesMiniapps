/**
 * Decode iframe-supplied transactions into structured operations so the
 * approval popup can show what's actually happening instead of a raw hex blob.
 *
 * Best-effort: covers the selectors that Circles miniapps actually emit
 * (ERC-20, ERC-1155, Hub V2, common wrappers, Safe management). Anything we
 * don't recognise falls back to `kind: 'unknown'` and the popup renders the
 * raw fields as before.
 */

import { decodeFunctionData, parseAbi, type Address, type Hex } from 'viem';
import { SAFE_MGMT_LABELS, SAFE_MGMT_SELECTORS } from './txPolicy.ts';

export type DecodedOp =
	| { kind: 'native-transfer'; to: Address; value: bigint }
	| { kind: 'erc20-transfer'; token: Address; to: Address; amount: bigint }
	| { kind: 'erc20-transfer-from'; token: Address; from: Address; to: Address; amount: bigint }
	| { kind: 'erc20-approve'; token: Address; spender: Address; amount: bigint; isUnlimited: boolean }
	| { kind: 'erc1155-transfer'; contract: Address; from: Address; to: Address; tokenId: bigint; amount: bigint }
	| {
			kind: 'erc1155-batch-transfer';
			contract: Address;
			from: Address;
			to: Address;
			tokenIds: readonly bigint[];
			amounts: readonly bigint[];
	  }
	| { kind: 'erc1155-approve-all'; contract: Address; operator: Address; approved: boolean }
	| { kind: 'hub-trust'; hub: Address; trustee: Address; expiry: bigint }
	| { kind: 'hub-untrust'; hub: Address; trustee: Address }
	| { kind: 'hub-wrap'; hub: Address; avatar: Address; amount: bigint; tokenType: number }
	| { kind: 'hub-personal-mint'; hub: Address }
	| {
			kind: 'hub-flow-matrix';
			hub: Address;
			sender: Address | null;
			recipient: Address | null;
			amount: bigint;
			verticesCount: number;
			flowCount: number;
	  }
	| { kind: 'wrapper-unwrap'; wrapper: Address; amount: bigint }
	| { kind: 'safe-management'; safe: Address; selector: string; label: string }
	| { kind: 'unknown'; to: Address; selector: string };

// One combined ABI keeps the viem call cheap — selector dispatch happens
// internally. Add new entries here as new patterns appear.
const KNOWN_ABI = parseAbi([
	// ERC-20
	'function transfer(address to, uint256 amount)',
	'function transferFrom(address from, address to, uint256 amount)',
	'function approve(address spender, uint256 amount)',
	// ERC-1155
	'function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes data)',
	'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] values, bytes data)',
	'function setApprovalForAll(address operator, bool approved)',
	// Circles Hub V2
	'function trust(address trustReceiver, uint96 expiry)',
	'function wrap(address avatar, uint256 amount, uint8 typeEnum)',
	'function personalMint()',
	'function operateFlowMatrix(address[] flowVertices, (uint16 streamSinkId, uint192 amount)[] flow, (uint16 sourceCoordinate, uint16[] flowEdgeIds, bytes data)[] streams, bytes packedCoordinates)',
	// Circles wrappers (per-token contracts)
	'function unwrap(uint256 amount)'
]);

// uint256 max — heuristic for "unlimited approval"
const UINT256_MAX = (1n << 256n) - 1n;

type RawTx = { to: string; data?: string; value?: string };

function asAddress(addr: string): Address {
	return addr.toLowerCase() as Address;
}

function parseValue(value: string | undefined): bigint {
	if (!value) return 0n;
	try {
		return BigInt(value);
	} catch {
		return 0n;
	}
}

/**
 * Recognises the standard Circles transfer batch: optional ERC-1155 operator
 * approval on the Hub, zero or more wrapper unwraps to free up balance,
 * exactly one `operateFlowMatrix` actually moving the tokens, and zero or
 * more re-wraps at the destination. The user only cares about "send X CRC
 * to Y" — the rest is plumbing the SDK adds automatically.
 *
 * Returns null if the batch doesn't fit the pattern (mixed selectors, no
 * flow matrix, or multiple flow matrices), so the popup falls back to
 * per-transaction rendering.
 */
export function detectCirclesTransferBatch(
	ops: DecodedOp[]
): { sender: Address | null; recipient: Address | null; amount: bigint; steps: number } | null {
	if (ops.length === 0) return null;
	let flow: Extract<DecodedOp, { kind: 'hub-flow-matrix' }> | null = null;
	for (const op of ops) {
		switch (op.kind) {
			case 'hub-flow-matrix':
				if (flow) return null; // more than one transfer in the batch
				flow = op;
				break;
			case 'wrapper-unwrap':
			case 'hub-wrap':
			case 'erc1155-approve-all':
				// Plumbing — allowed alongside the flow matrix.
				break;
			default:
				return null;
		}
	}
	if (!flow || flow.recipient === null || flow.amount === 0n) return null;
	return { sender: flow.sender, recipient: flow.recipient, amount: flow.amount, steps: ops.length };
}

export function decodeOperation(tx: RawTx): DecodedOp {
	const to = asAddress(tx.to);
	const data = (tx.data ?? '0x') as Hex;
	const value = parseValue(tx.value);

	// Plain value transfer — no calldata at all.
	if (!data || data === '0x' || data.length < 10) {
		return { kind: 'native-transfer', to, value };
	}

	const selector = data.slice(0, 10).toLowerCase();

	// Safe management selectors are recognised first so the label
	// from txPolicy.ts is the authoritative one (matches the policy reason).
	if (SAFE_MGMT_SELECTORS.has(selector)) {
		return {
			kind: 'safe-management',
			safe: to,
			selector,
			label: SAFE_MGMT_LABELS[selector] ?? 'Safe management call'
		};
	}

	let decoded;
	try {
		decoded = decodeFunctionData({ abi: KNOWN_ABI, data });
	} catch {
		return { kind: 'unknown', to, selector };
	}

	switch (decoded.functionName) {
		case 'transfer': {
			const [recipient, amount] = decoded.args as [Address, bigint];
			return { kind: 'erc20-transfer', token: to, to: asAddress(recipient), amount };
		}
		case 'transferFrom': {
			const [from, recipient, amount] = decoded.args as [Address, Address, bigint];
			return {
				kind: 'erc20-transfer-from',
				token: to,
				from: asAddress(from),
				to: asAddress(recipient),
				amount
			};
		}
		case 'approve': {
			const [spender, amount] = decoded.args as [Address, bigint];
			return {
				kind: 'erc20-approve',
				token: to,
				spender: asAddress(spender),
				amount,
				isUnlimited: amount === UINT256_MAX
			};
		}
		case 'safeTransferFrom': {
			const [from, recipient, tokenId, amt] = decoded.args as [Address, Address, bigint, bigint, Hex];
			return {
				kind: 'erc1155-transfer',
				contract: to,
				from: asAddress(from),
				to: asAddress(recipient),
				tokenId,
				amount: amt
			};
		}
		case 'safeBatchTransferFrom': {
			const [from, recipient, ids, amts] = decoded.args as [
				Address,
				Address,
				readonly bigint[],
				readonly bigint[],
				Hex
			];
			return {
				kind: 'erc1155-batch-transfer',
				contract: to,
				from: asAddress(from),
				to: asAddress(recipient),
				tokenIds: ids,
				amounts: amts
			};
		}
		case 'setApprovalForAll': {
			const [operator, approved] = decoded.args as [Address, boolean];
			return {
				kind: 'erc1155-approve-all',
				contract: to,
				operator: asAddress(operator),
				approved
			};
		}
		case 'trust': {
			const [trustee, expiry] = decoded.args as [Address, bigint];
			if (expiry === 0n) {
				return { kind: 'hub-untrust', hub: to, trustee: asAddress(trustee) };
			}
			return { kind: 'hub-trust', hub: to, trustee: asAddress(trustee), expiry };
		}
		case 'wrap': {
			const [avatar, amount, tokenType] = decoded.args as [Address, bigint, number];
			return { kind: 'hub-wrap', hub: to, avatar: asAddress(avatar), amount, tokenType };
		}
		case 'personalMint': {
			return { kind: 'hub-personal-mint', hub: to };
		}
		case 'operateFlowMatrix': {
			const [vertices, flow, streams, packedCoordinates] = decoded.args as [
				readonly Address[],
				readonly { streamSinkId: number; amount: bigint }[],
				readonly { sourceCoordinate: number; flowEdgeIds: readonly number[]; data: Hex }[],
				Hex
			];

			// Sender = the source vertex named by the first stream.
			const sender =
				streams.length > 0 && streams[0].sourceCoordinate < vertices.length
					? asAddress(vertices[streams[0].sourceCoordinate])
					: null;

			// packedCoordinates is three uint16s per edge: (tokenOwner, from, to).
			// Terminal edges (streamSinkId === 1) deliver to the recipient; sum
			// their amounts and read the `to` coordinate to get the address.
			const coordHex = packedCoordinates.startsWith('0x')
				? packedCoordinates.slice(2)
				: packedCoordinates;

			let recipient: Address | null = null;
			let amount = 0n;
			for (let i = 0; i < flow.length; i++) {
				if (flow[i].streamSinkId !== 1) continue;
				const toCoordHexOffset = (i * 3 + 2) * 4; // 4 hex chars per uint16
				if (coordHex.length < toCoordHexOffset + 4) continue;
				const idx = parseInt(coordHex.slice(toCoordHexOffset, toCoordHexOffset + 4), 16);
				if (idx >= vertices.length) continue;
				const candidate = asAddress(vertices[idx]);
				// First terminal sets the recipient; subsequent terminals should
				// be the same address — if not, leave the rest of the sum but
				// keep the first recipient. (Multi-recipient streams aren't a
				// pattern the SDK emits today.)
				if (recipient === null) recipient = candidate;
				amount += flow[i].amount;
			}

			return {
				kind: 'hub-flow-matrix',
				hub: to,
				sender,
				recipient,
				amount,
				verticesCount: vertices.length,
				flowCount: flow.length
			};
		}
		case 'unwrap': {
			const [amount] = decoded.args as [bigint];
			return { kind: 'wrapper-unwrap', wrapper: to, amount };
		}
	}

	return { kind: 'unknown', to, selector };
}
