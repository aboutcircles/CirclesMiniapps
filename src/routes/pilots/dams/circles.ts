/**
 * Circles Amsterdam (dAMS) — on-chain reads + the claim transaction batch.
 *
 * Pure helpers: read an account's spendable-dAMS picture, and build the atomic
 * batch that mints + converts + wraps + pays a shop in one sponsored UserOp.
 * The page sends the batch via the shared wallet store (passkey-signed, no
 * preview). All amounts are floored to whole dAMS so demurrage drift between
 * read and execution can never make a step overflow the balance.
 */
import {
	createPublicClient,
	http,
	encodeFunctionData,
	getAddress,
	parseAbiItem,
	type Address,
	type Hex
} from 'viem';
import { gnosis } from 'viem/chains';

export const CIRCLES_RPC = 'https://rpc.aboutcircles.com/';

// Canonical Circles V2 deployment on Gnosis Chain (verified on-chain).
// Normalized through getAddress() so the checksum casing can never be wrong.
export const HUB_V2: Address = getAddress('0xc12c1e50abb450d6205ea2c3fa861b3b834d13e8');

// Circles Amsterdam group ("dAMS") and its demurraged ERC20 wrapper — the token
// users hold and the discount is paid in. (Optimistic route: demurraged only.)
export const GROUP: Address = getAddress('0xef63594eea262e3d6cf3b93143773ac65fafc2e6');
export const DAMS_ERC20: Address = getAddress('0xc8e489adf9602c2af39cc141cb7a54e7f88c5c07');

export const ONE = 10n ** 18n;
const CIRCLES_TYPE_DEMURRAGE = 0; // CirclesType enum: 0 = Demurrage, 1 = Inflation

const hubAbi = [
	{ type: 'function', name: 'personalMint', inputs: [], outputs: [], stateMutability: 'nonpayable' },
	{
		type: 'function',
		name: 'calculateIssuance',
		inputs: [{ name: '_human', type: 'address' }],
		outputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'groupMint',
		inputs: [
			{ name: '_group', type: 'address' },
			{ name: '_collateralAvatars', type: 'address[]' },
			{ name: '_amounts', type: 'uint256[]' },
			{ name: '_data', type: 'bytes' }
		],
		outputs: [],
		stateMutability: 'nonpayable'
	},
	{
		type: 'function',
		name: 'safeTransferFrom',
		inputs: [
			{ name: '_from', type: 'address' },
			{ name: '_to', type: 'address' },
			{ name: '_id', type: 'uint256' },
			{ name: '_value', type: 'uint256' },
			{ name: '_data', type: 'bytes' }
		],
		outputs: [],
		stateMutability: 'nonpayable'
	},
	{
		type: 'function',
		name: 'wrap',
		inputs: [
			{ name: '_avatar', type: 'address' },
			{ name: '_amount', type: 'uint256' },
			{ name: '_type', type: 'uint8' }
		],
		outputs: [{ type: 'address' }],
		stateMutability: 'nonpayable'
	},
	{
		type: 'function',
		name: 'balanceOf',
		inputs: [
			{ name: '_account', type: 'address' },
			{ name: '_id', type: 'uint256' }
		],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'isHuman',
		inputs: [{ name: '_human', type: 'address' }],
		outputs: [{ type: 'bool' }],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'isTrusted',
		inputs: [
			{ name: '_truster', type: 'address' },
			{ name: '_trustee', type: 'address' }
		],
		outputs: [{ type: 'bool' }],
		stateMutability: 'view'
	}
] as const;

const erc20Abi = [
	{
		type: 'function',
		name: 'balanceOf',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ type: 'uint256' }],
		stateMutability: 'view'
	},
	{
		type: 'function',
		name: 'transfer',
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'amount', type: 'uint256' }
		],
		outputs: [{ type: 'bool' }],
		stateMutability: 'nonpayable'
	},
	{
		type: 'function',
		name: 'unwrap',
		inputs: [{ name: '_amount', type: 'uint256' }],
		outputs: [],
		stateMutability: 'nonpayable'
	}
] as const;

// ERC1155 token id for an avatar = uint256(uint160(avatarAddress)).
function toTokenId(avatar: Address): bigint {
	return BigInt(avatar);
}

export function publicClient() {
	return createPublicClient({ chain: gnosis, transport: http(CIRCLES_RPC) });
}

// ---- On-chain redemption history --------------------------------------------
// Every redemption (in every version of this pilot) pays the shop with a plain
// dAMS-ERC20 `transfer`, so the token's Transfer logs are the durable record of
// who redeemed what — it survives new devices and cleared storage, unlike the
// localStorage order cache. Transfers to the zero address are unwrap burns and
// never match a shop filter.

// The dAMS ERC20 deployment block (2026-03-09); no transfers exist before it.
const DAMS_ERC20_DEPLOY_BLOCK = 45066513n;
// rpc.aboutcircles.com cancels wide eth_getLogs queries with a timeout; the
// public Gnosis RPC answers them fine, so history reads go there.
const LOGS_RPC = 'https://rpc.gnosischain.com';

const transferEvent = parseAbiItem(
	'event Transfer(address indexed from, address indexed to, uint256 value)'
);

export interface ShopPayment {
	shop: Address;
	amountWei: bigint;
	txHash: string;
	at: number; // block timestamp, epoch ms
}

// All dAMS the user ever paid to one of `shops`, newest first.
export async function fetchShopPayments(
	user: Address,
	shops: Address[]
): Promise<ShopPayment[]> {
	const client = createPublicClient({ chain: gnosis, transport: http(LOGS_RPC) });
	const logs = await client.getLogs({
		address: DAMS_ERC20,
		event: transferEvent,
		args: { from: user },
		fromBlock: DAMS_ERC20_DEPLOY_BLOCK,
		toBlock: 'latest'
	});
	const wanted = new Set(shops.map((s) => s.toLowerCase()));
	const hits = logs.filter((l) => l.args.to && wanted.has(l.args.to.toLowerCase()));
	// One timestamp lookup per unique block (redemptions are few).
	const blockNums = [...new Set(hits.map((l) => l.blockNumber))];
	const times = new Map(
		await Promise.all(
			blockNums.map(async (bn) => {
				const b = await client.getBlock({ blockNumber: bn });
				return [bn, Number(b.timestamp) * 1000] as const;
			})
		)
	);
	return hits
		.map((l) => ({
			shop: getAddress(l.args.to!),
			amountWei: l.args.value!,
			txHash: l.transactionHash,
			at: times.get(l.blockNumber) ?? 0
		}))
		.sort((a, b) => b.at - a.at);
}

export interface UserState {
	registered: boolean; // is a Circles human
	isMember: boolean; // group trusts this avatar (can group-mint)
	mintable: bigint; // personal CRC mintable right now, from Hub.calculateIssuance (wei)
	damsDemurraged: bigint; // dAMS held as demurraged ERC20 (wei)
	personalCrc: bigint; // personal CRC already held as ERC1155 (wei) — used by the claim
	damsErc1155: bigint; // group dAMS held unwrapped as ERC1155 (wei) — used by the claim
}

export async function readUserState(address: Address): Promise<UserState> {
	const client = publicClient();
	const id = toTokenId(address);
	const groupId = toTokenId(GROUP);

	const [registered, isMember, personalCrc, damsErc1155, damsDemurraged] = await Promise.all([
		client.readContract({ address: HUB_V2, abi: hubAbi, functionName: 'isHuman', args: [address] }),
		client.readContract({ address: HUB_V2, abi: hubAbi, functionName: 'isTrusted', args: [GROUP, address] }),
		client.readContract({ address: HUB_V2, abi: hubAbi, functionName: 'balanceOf', args: [address, id] }),
		client.readContract({ address: HUB_V2, abi: hubAbi, functionName: 'balanceOf', args: [address, groupId] }),
		client
			.readContract({ address: DAMS_ERC20, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
			.catch(() => 0n)
	]);

	// Mintable comes straight from the Hub — never synthesized client-side.
	// calculateIssuance reverts when there's nothing to mint yet; treat as 0.
	let mintable = 0n;
	if (registered) {
		try {
			const res = (await client.readContract({
				address: HUB_V2,
				abi: hubAbi,
				functionName: 'calculateIssuance',
				args: [address]
			})) as readonly [bigint, bigint, bigint];
			mintable = res[0];
		} catch {
			mintable = 0n;
		}
	}

	return { registered, isMember, mintable, damsDemurraged, personalCrc, damsErc1155 };
}

// The base balance: dAMS the user already holds (demurraged ERC20 + unwrapped
// group ERC1155) plus what they can mint right now from Hub issuance. Held
// personal CRC is NOT counted here — it enters the balance only via the
// pathfinder (boost.ts, fromTokens = the user's personal token), which honestly
// reflects the trust limits on converting it into dAMS. The page clamps that
// pathfinder amount by the personal CRC actually still held so a stale
// pathfinder graph can't resurrect spent tokens.
export function totalAvailableWei(s: UserState): bigint {
	return s.damsDemurraged + s.damsErc1155 + s.mintable;
}

// Whole dAMS the claim batch could actually deliver right now — computed exactly
// like buildClaimTxs() floors things, so the headline number and the "Redeem"
// eligibility never disagree (never show N available then fail to deliver N).
export function deliverableWholeDams(s: UserState): number {
	const collateralWei = floorToWhole(s.mintable);
	const wrapWei = floorToWhole(s.damsErc1155 + collateralWei);
	const deliverableWei = s.damsDemurraged + wrapWei;
	return Number(deliverableWei / ONE);
}

function floorToWhole(wei: bigint): bigint {
	return (wei / ONE) * ONE;
}

function ceilToWhole(wei: bigint): bigint {
	return ((wei + ONE - 1n) / ONE) * ONE;
}

export interface Transaction {
	to: string;
	data?: string;
	value?: string;
}

// Wrap `amountWei` of the group's ERC1155 dAMS into demurraged ERC20.
export function wrapTx(amountWei: bigint): Transaction {
	return {
		to: HUB_V2,
		data: encodeFunctionData({
			abi: hubAbi,
			functionName: 'wrap',
			args: [GROUP, amountWei, CIRCLES_TYPE_DEMURRAGE]
		})
	};
}

export interface ClaimPlan {
	txs: Transaction[];
	deliverableErc20: bigint; // dAMS that will be deliverable as ERC20 after the batch (wei)
}

// personalMint → groupMint → wrap → dAMS-ERC20.transfer, as one atomic batch.
//
// The batch is sized to the offer, not to the whole balance: it converts only
// what the payment needs, drawing on held ERC20 first, then held group tokens,
// then fresh issuance as group-mint collateral. Held personal CRC is never
// converted directly here — when the offer needs more than this batch can
// cover, the caller prepends pathfinder transactions (boost.ts, fromTokens =
// the user's personal token) that deliver the shortfall as dAMS ERC20 first.
export function buildClaimTxs(
	user: Address,
	s: UserState,
	shop: Address,
	discountWei: bigint
): ClaimPlan {
	const txs: Transaction[] = [];

	if (s.mintable > 0n) {
		txs.push({
			to: HUB_V2,
			data: encodeFunctionData({ abi: hubAbi, functionName: 'personalMint', args: [] })
		});
	}

	// ERC20 needed beyond what's already wrapped. The existing ERC20 balance
	// demurrages slightly between read and execution, so only ~99.998% of it is
	// counted as usable (covers hours of drift), and the shortfall is ceiled to
	// a whole token — together they keep the final transfer from overdrawing.
	const usable20 = s.damsDemurraged - s.damsDemurraged / 50_000n;
	const wrapNeed = ceilToWhole(discountWei > usable20 ? discountWei - usable20 : 0n);
	// Group ERC1155 already held (floored against the same drift).
	const held1155 = floorToWhole(s.damsErc1155);
	// Collateral to group-mint: only the part the held group tokens can't cover.
	const collNeed = wrapNeed > held1155 ? wrapNeed - held1155 : 0n;
	const collAvailable = floorToWhole(s.mintable);
	const collateralWei = collNeed < collAvailable ? collNeed : collAvailable;
	if (collateralWei > 0n) {
		txs.push({
			to: HUB_V2,
			data: encodeFunctionData({
				abi: hubAbi,
				functionName: 'groupMint',
				args: [GROUP, [user], [collateralWei], '0x' as Hex]
			})
		});
	}

	const wrapWei = wrapNeed < held1155 + collateralWei ? wrapNeed : held1155 + collateralWei;
	if (wrapWei > 0n) {
		txs.push({
			to: HUB_V2,
			data: encodeFunctionData({
				abi: hubAbi,
				functionName: 'wrap',
				args: [GROUP, wrapWei, CIRCLES_TYPE_DEMURRAGE]
			})
		});
	}

	txs.push({
		to: DAMS_ERC20,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: 'transfer',
			args: [shop, discountWei]
		})
	});

	// Capacity, not the batch's output: what the account COULD deliver as ERC20
	// if everything this batch may convert were converted — the eligibility
	// check adds any pathfinder-only surplus on top of this.
	const deliverableErc20 = s.damsDemurraged + floorToWhole(s.damsErc1155 + collAvailable);

	return { txs, deliverableErc20 };
}


export function isEnough(s: UserState, shop: Address, amountDams: number): boolean {
	const amountWei = BigInt(amountDams) * ONE;
	return buildClaimTxs(shop, s, shop, amountWei).deliverableErc20 >= amountWei;
}

// ---- Sending to the org ------------------------------------------------------
// Manual transfers to the org travel as GROUP ERC1155 tokens (Hub
// safeTransferFrom), deliberately NOT as the dAMS ERC20 that offer redemptions
// use: the redemption history and the first-purchase stage are derived from the
// ERC20 Transfer logs, so 1155 sends stay naturally invisible to them.

export interface SendGather {
	txs: Transaction[];
	// What these txs can't source directly — the caller covers it with
	// pathfinder txs (boost.ts, ERC1155 mode) placed before the final transfer.
	shortfallWei: bigint;
}

// Gather `amountWei` of group ERC1155 in the user's wallet: held group tokens
// first, then fresh issuance via personalMint + groupMint, then unwrapping held
// dAMS ERC20. Whatever remains is returned as the pathfinder shortfall.
export function buildSendGatherTxs(user: Address, s: UserState, amountWei: bigint): SendGather {
	const txs: Transaction[] = [];
	let need = amountWei;

	// Held group 1155 needs no tx — it just reduces what must be gathered.
	const have1155 = floorToWhole(s.damsErc1155);
	need -= need < have1155 ? need : have1155;

	if (s.mintable > 0n) {
		txs.push({
			to: HUB_V2,
			data: encodeFunctionData({ abi: hubAbi, functionName: 'personalMint', args: [] })
		});
	}
	const collWei = (() => {
		const avail = floorToWhole(s.mintable);
		return need < avail ? need : avail;
	})();
	if (collWei > 0n) {
		txs.push({
			to: HUB_V2,
			data: encodeFunctionData({
				abi: hubAbi,
				functionName: 'groupMint',
				args: [GROUP, [user], [collWei], '0x' as Hex]
			})
		});
		need -= collWei;
	}

	if (need > 0n && s.damsDemurraged > 0n) {
		// Same drift buffer as the claim batch: held ERC20 demurrages slightly
		// between read and execution.
		const usable20 = s.damsDemurraged - s.damsDemurraged / 50_000n;
		const unwrapWei = need < usable20 ? need : usable20;
		if (unwrapWei > 0n) {
			txs.push({
				to: DAMS_ERC20,
				data: encodeFunctionData({ abi: erc20Abi, functionName: 'unwrap', args: [unwrapWei] })
			});
			need -= unwrapWei;
		}
	}

	return { txs, shortfallWei: need };
}

// The final hop of a send: move `amountWei` of group ERC1155 to the org.
export function transferGroup1155Tx(user: Address, to: Address, amountWei: bigint): Transaction {
	return {
		to: HUB_V2,
		data: encodeFunctionData({
			abi: hubAbi,
			functionName: 'safeTransferFrom',
			args: [user, to, toTokenId(GROUP), amountWei, '0x' as Hex]
		})
	};
}

// ---- Profiles -------------------------------------------------------------
export async function fetchProfileName(address: string): Promise<string | null> {
	try {
		const res = await fetch(CIRCLES_RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'circles_getProfileByAddress',
				params: [getAddress(address)]
			})
		});
		const json = await res.json();
		return json?.result?.name ?? null;
	} catch {
		return null;
	}
}

export function shortAddress(addr: string): string {
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
