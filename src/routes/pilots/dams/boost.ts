/**
 * "Boost" — convert an existing user's broader Circles balance into as many dAMS
 * as possible via the pathfinder.
 *
 * Max-flow from the user into the group's BASE_MINT_HANDLER (which mints group
 * tokens back to the sender) gives the ceiling; constructAdvancedTransfer builds
 * the flow-matrix path that realizes a chosen amount; we then wrap the minted
 * dAMS into demurraged ERC20 so it lands in the headline "Your dAMS" balance.
 *
 * Mirrors the approach used by the `kudos` pilot's group-currency send.
 */
import { createPublicClient, http, hexToBytes, type Address } from 'viem';
import { gnosis } from 'viem/chains';
import { TransferBuilder } from '@aboutcircles/sdk-transfers';
import { circlesConfig } from '@aboutcircles/sdk-utils';
import { CirclesConverter } from '@aboutcircles/sdk-utils/circlesConverter';
import { CIRCLES_RPC, GROUP, type Transaction } from './circles';

// Attaching this data to the transfer into the mint handler makes it return the
// minted dAMS as demurraged ERC20 directly — no separate wrap step needed.
const DEMURRAGE_MINT_DATA =
	'0xf3f5858942140fd2894eeb8b74cd0ed72d24fc6675d352a2884b1be2f32256fe' as const;

const baseGroupAbi = [
	{
		type: 'function',
		name: 'BASE_MINT_HANDLER',
		inputs: [],
		outputs: [{ type: 'address' }],
		stateMutability: 'view'
	}
] as const;

const client = createPublicClient({ chain: gnosis, transport: http(CIRCLES_RPC) });

const transferBuilder = new TransferBuilder({
	...circlesConfig[100],
	circlesRpcUrl: CIRCLES_RPC,
	pathfinderUrl: CIRCLES_RPC
});

async function jsonRpc(method: string, params: unknown[]): Promise<any> {
	const res = await fetch(CIRCLES_RPC, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
	});
	const json = await res.json();
	if (json.error) throw new Error(json.error.message ?? 'RPC error');
	return json.result;
}

let cachedMintHandler: Address | null = null;
async function mintHandler(): Promise<Address> {
	if (cachedMintHandler) return cachedMintHandler;
	cachedMintHandler = (await client.readContract({
		address: GROUP,
		abi: baseGroupAbi,
		functionName: 'BASE_MINT_HANDLER'
	})) as Address;
	return cachedMintHandler;
}

// The most dAMS (wei) the user can mint by routing all trust-reachable Circles
// (including their wrapped balances) into the group.
export async function maxConvertibleToDams(user: Address): Promise<bigint> {
	const sink = await mintHandler();
	const MAX_UINT256 = (1n << 256n) - 1n;
	const targetFlow = CirclesConverter.truncateToSixDecimals(MAX_UINT256).toString();
	const res = (await jsonRpc('circlesV2_findPath', [
		{ source: user, sink, targetFlow, withWrap: true, quantizedMode: false }
	])) as { maxFlow?: string };
	return BigInt(res.maxFlow ?? '0');
}

// Build the path that mints `amountWei` dAMS to the user. The DEMURRAGE_MINT_DATA
// payload makes the mint handler return it as demurraged ERC20 directly.
export async function buildBoostTxs(user: Address, amountWei: bigint): Promise<Transaction[]> {
	const sink = await mintHandler();
	const pathTxs = (await transferBuilder.constructAdvancedTransfer(user, sink, amountWei, {
		useWrappedBalances: true,
		txData: hexToBytes(DEMURRAGE_MINT_DATA)
	})) as Array<{ to: string; data?: string; value?: bigint }>;

	return pathTxs.map((tx) => ({ to: tx.to, data: tx.data, value: tx.value?.toString() }));
}
