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

// Circles Amsterdam group ("dAMS") and its demurraged ERC20 wrapper.
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
	issuance: bigint; // personal CRC mintable right now (wei)
	personalCrc: bigint; // personal CRC already held (wei)
	damsErc1155: bigint; // group dAMS held unwrapped (wei)
	damsErc20: bigint; // group dAMS held as demurraged ERC20 (wei)
}

export async function readUserState(address: Address): Promise<UserState> {
	const client = publicClient();
	const id = toTokenId(address);
	const groupId = toTokenId(GROUP);

	const [registered, isMember, personalCrc, damsErc1155, damsErc20] = await Promise.all([
		client.readContract({ address: HUB_V2, abi: hubAbi, functionName: 'isHuman', args: [address] }),
		client.readContract({ address: HUB_V2, abi: hubAbi, functionName: 'isTrusted', args: [GROUP, address] }),
		client.readContract({ address: HUB_V2, abi: hubAbi, functionName: 'balanceOf', args: [address, id] }),
		client.readContract({ address: HUB_V2, abi: hubAbi, functionName: 'balanceOf', args: [address, groupId] }),
		client
			.readContract({ address: DAMS_ERC20, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
			.catch(() => 0n)
	]);

	let issuance = 0n;
	if (registered) {
		try {
			const res = (await client.readContract({
				address: HUB_V2,
				abi: hubAbi,
				functionName: 'calculateIssuance',
				args: [address]
			})) as readonly [bigint, bigint, bigint];
			issuance = res[0];
		} catch {
			issuance = 0n;
		}
	}

	return { registered, isMember, issuance, personalCrc, damsErc1155, damsErc20 };
}

// Everything the user can ultimately spend as dAMS, in wei.
export function totalAvailableWei(s: UserState): bigint {
	return s.damsErc20 + s.damsErc1155 + s.personalCrc + s.issuance;
}

function floorToWhole(wei: bigint): bigint {
	return (wei / ONE) * ONE;
}

export interface Transaction {
	to: string;
	data?: string;
	value?: string;
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

	if (s.issuance > 0n) {
		txs.push({
			to: HUB_V2,
			data: encodeFunctionData({ abi: hubAbi, functionName: 'personalMint', args: [] })
		});
	}

	const collateralWei = floorToWhole(s.personalCrc + s.issuance);
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

	const deliverableErc20 = s.damsErc20 + wrapWei;
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
