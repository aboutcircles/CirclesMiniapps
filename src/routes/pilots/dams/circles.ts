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
	}
] as const;

// ERC1155 token id for an avatar = uint256(uint160(avatarAddress)).
function toTokenId(avatar: Address): bigint {
	return BigInt(avatar);
}

export function publicClient() {
	return createPublicClient({ chain: gnosis, transport: http(CIRCLES_RPC) });
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

// The balance the user sees: everything that can become spendable dAMS, all read
// on-chain. That's dAMS they already hold (demurraged ERC20 + unwrapped ERC1155)
// PLUS personal Circles that the claim batch converts 1:1 into dAMS via group-mint
// (their held personal CRC + what they can mint right now from Hub issuance).
//
// The signup welcome bonus lands as personal CRC (ERC1155), so it must be counted
// here — otherwise a freshly-registered user with 48 CRC sees "0 dAMS" even though
// those 48 are immediately redeemable. This mirrors buildClaimTxs()'s collateral.
export function totalAvailableWei(s: UserState): bigint {
	return s.damsDemurraged + s.damsErc1155 + s.personalCrc + s.mintable;
}

// Whole dAMS the claim batch could actually deliver right now — computed exactly
// like buildClaimTxs() floors things, so the headline number and the "Redeem"
// eligibility never disagree (never show N available then fail to deliver N).
export function deliverableWholeDams(s: UserState): number {
	const collateralWei = floorToWhole(s.personalCrc + s.mintable);
	const wrapWei = floorToWhole(s.damsErc1155 + collateralWei);
	const deliverableWei = s.damsDemurraged + wrapWei;
	return Number(deliverableWei / ONE);
}

function floorToWhole(wei: bigint): bigint {
	return (wei / ONE) * ONE;
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

	const collateralWei = floorToWhole(s.personalCrc + s.mintable);
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

	const wrapWei = floorToWhole(s.damsErc1155 + collateralWei);
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

	const deliverableErc20 = s.damsDemurraged + wrapWei;
	txs.push({
		to: DAMS_ERC20,
		data: encodeFunctionData({
			abi: erc20Abi,
			functionName: 'transfer',
			args: [shop, discountWei]
		})
	});

	return { txs, deliverableErc20 };
}

export function isEnough(s: UserState, shop: Address, amountDams: number): boolean {
	const amountWei = BigInt(amountDams) * ONE;
	return buildClaimTxs(shop, s, shop, amountWei).deliverableErc20 >= amountWei;
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
