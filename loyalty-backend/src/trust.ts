/**
 * Group membership via Circles Hub V2 `trust`.
 *
 * The coffee shop is a Circles group whose avatar is a Safe. To add a customer as
 * a member, the GROUP must call `Hub.trust(customer, expiry)`. This backend holds
 * an EOA that is an owner/signer of that group Safe and executes the trust call
 * FROM the Safe via a SafeContractRunner — the exact pattern used by
 * invite-backend/src/invite.ts.
 *
 * Reads (isTrusted, isHuman) go through a plain viem public client, never the Safe.
 */
import {
	createPublicClient,
	encodeFunctionData,
	getAddress,
	http,
	type Address,
	type Hex
} from 'viem';
import { gnosis } from 'viem/chains';
import { SafeContractRunner, chains } from '@aboutcircles/sdk-runner';

/** Hub V2 on Gnosis Chain (from AGENTS.md). */
export const HUB_V2: Address = getAddress('0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8');

// Trust never expires for loyalty members: max uint96.
const INDEFINITE_EXPIRY = (1n << 96n) - 1n;

const hubAbi = [
	{
		type: 'function',
		name: 'trust',
		inputs: [
			{ name: '_trustReceiver', type: 'address' },
			{ name: '_expiry', type: 'uint96' }
		],
		outputs: [],
		stateMutability: 'nonpayable'
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
	},
	{
		type: 'function',
		name: 'isHuman',
		inputs: [{ name: '_avatar', type: 'address' }],
		outputs: [{ type: 'bool' }],
		stateMutability: 'view'
	}
] as const;

export interface TrustEnv {
	rpcUrl: string;
	groupSafe: Address;
	operatorPrivateKey: Hex;
}

function publicClient(rpcUrl: string) {
	return createPublicClient({ chain: gnosis, transport: http(rpcUrl) });
}

/** Does the group already trust this customer (i.e. are they a member)? */
export async function isMember(env: TrustEnv, customer: Address): Promise<boolean> {
	return (await publicClient(env.rpcUrl).readContract({
		address: HUB_V2,
		abi: hubAbi,
		functionName: 'isTrusted',
		args: [env.groupSafe, getAddress(customer)]
	})) as boolean;
}

/** Is this address a registered Circles human (best-effort gate)? */
export async function isHuman(rpcUrl: string, avatar: Address): Promise<boolean> {
	try {
		return (await publicClient(rpcUrl).readContract({
			address: HUB_V2,
			abi: hubAbi,
			functionName: 'isHuman',
			args: [getAddress(avatar)]
		})) as boolean;
	} catch {
		return false;
	}
}

/**
 * Add `customer` to the group by having the group Safe call Hub.trust.
 * Returns the transaction hash. Idempotent at the protocol level (re-trusting an
 * existing member just refreshes the expiry).
 */
export async function trustMember(env: TrustEnv, customer: Address): Promise<string> {
	const data = encodeFunctionData({
		abi: hubAbi,
		functionName: 'trust',
		args: [getAddress(customer), INDEFINITE_EXPIRY]
	});

	const runner = await SafeContractRunner.create(
		env.rpcUrl,
		env.operatorPrivateKey,
		env.groupSafe,
		chains.gnosis
	);

	const receipt = await runner.sendTransaction([{ to: HUB_V2, data, value: 0n }]);
	return receipt.transactionHash;
}
