/**
 * Free-coffee reward NFT minting.
 *
 * The operator EOA (the same hot key that signs group-trust from the Safe) is the
 * `minter` on the CoffeeStampNFT contract, so it mints directly as a plain EOA
 * transaction — no Safe involved here.
 */
import {
	createPublicClient,
	createWalletClient,
	decodeEventLog,
	getAddress,
	http,
	type Address,
	type Hex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';

const nftAbi = [
	{
		type: 'function',
		name: 'mint',
		inputs: [{ name: 'to', type: 'address' }],
		outputs: [{ name: 'tokenId', type: 'uint256' }],
		stateMutability: 'nonpayable'
	},
	{
		type: 'event',
		name: 'Transfer',
		inputs: [
			{ name: 'from', type: 'address', indexed: true },
			{ name: 'to', type: 'address', indexed: true },
			{ name: 'tokenId', type: 'uint256', indexed: true }
		]
	}
] as const;

export interface NftEnv {
	rpcUrl: string;
	operatorPrivateKey: Hex;
	nftContract: Address;
}

export interface MintResult {
	tokenId: string;
	txHash: string;
}

/** Mint one free-coffee NFT to `to`, returning the new tokenId + tx hash. */
export async function mintReward(env: NftEnv, to: Address): Promise<MintResult> {
	const account = privateKeyToAccount(env.operatorPrivateKey);
	const transport = http(env.rpcUrl);
	const publicClient = createPublicClient({ chain: gnosis, transport });
	const walletClient = createWalletClient({ account, chain: gnosis, transport });

	const txHash = await walletClient.writeContract({
		address: env.nftContract,
		abi: nftAbi,
		functionName: 'mint',
		args: [getAddress(to)]
	});

	const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

	// Pull the tokenId from the mint Transfer event (from == zero address).
	let tokenId = '';
	for (const log of receipt.logs) {
		if (getAddress(log.address) !== getAddress(env.nftContract)) continue;
		try {
			const decoded = decodeEventLog({ abi: nftAbi, data: log.data, topics: log.topics });
			if (decoded.eventName === 'Transfer') {
				tokenId = (decoded.args as { tokenId: bigint }).tokenId.toString();
				break;
			}
		} catch {
			// Not the event we're after — keep scanning.
		}
	}

	return { tokenId, txHash };
}
