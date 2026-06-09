/**
 * Circles invite logic — uses the InvitationFarm via @aboutcircles/sdk-invitations.
 *
 * The inviter is a Safe that holds farm quota. `InviteFarm.generateInvites`
 * builds the safeTransferFrom transaction(s) that send the invitation fee (96
 * CRC) from the inviter Safe to a specific invitee and establish trust. Those
 * txs are then signed & executed FROM the inviter Safe via a SafeContractRunner
 * (owner key held by this backend).
 */
import { getAddress, isAddress, type Address } from 'viem';
import { circlesConfig } from '@aboutcircles/sdk-core';
import { InviteFarm } from '@aboutcircles/sdk-invitations';
import { SafeContractRunner, chains } from '@aboutcircles/sdk-runner';

const GNOSIS_CHAIN_ID = 100;

// The InvitationFarm deployed on Gnosis Chain. The SDK's bundled circlesConfig
// currently ships invitationFarmAddress = 0x0, so we override it. Source:
// circles-invitation-at-scale (InvitationFarm). Overridable via env in case it
// is redeployed.
const DEFAULT_INVITATION_FARM = '0xd28b7C4f148B1F1E190840A1f7A796C5525D8902' as Address;

export interface InviteEnv {
	rpcUrl: string;
	inviterSafe: Address;
	inviterPrivateKey: `0x${string}`;
	invitationFarm: Address;
}

export interface InviteResult {
	status: 'invited' | 'already';
	invitee: Address;
	txHash?: string;
	quotaRemaining?: string;
}

export function loadEnv(): InviteEnv {
	const rpcUrl = process.env.RPC_URL;
	const inviterSafe = process.env.INVITER_SAFE_ADDRESS;
	const inviterPrivateKey = process.env.INVITER_PRIVATE_KEY;
	if (!rpcUrl) throw new Error('RPC_URL is not set');
	if (!inviterSafe || !isAddress(inviterSafe, { strict: false })) {
		throw new Error('INVITER_SAFE_ADDRESS is not a valid address');
	}
	if (!inviterPrivateKey || !/^0x[0-9a-fA-F]{64}$/.test(inviterPrivateKey)) {
		throw new Error('INVITER_PRIVATE_KEY is not a valid 32-byte hex key');
	}
	const farmEnv = process.env.INVITATION_FARM;
	const invitationFarm =
		farmEnv && isAddress(farmEnv, { strict: false }) ? getAddress(farmEnv) : DEFAULT_INVITATION_FARM;
	return {
		rpcUrl,
		inviterSafe: getAddress(inviterSafe),
		inviterPrivateKey: inviterPrivateKey as `0x${string}`,
		invitationFarm
	};
}

/**
 * Invite a single existing account (a freshly-created Safe) into Circles using
 * the InvitationFarm. The invitee must already have a Safe and have the
 * invitation module enabled (the frontend signup flow does this).
 */
export async function inviteAccount(invitee: Address, env: InviteEnv): Promise<InviteResult> {
	const target = getAddress(invitee);
	const baseConfig = circlesConfig[GNOSIS_CHAIN_ID];
	if (!baseConfig) throw new Error('No Circles config for chain 100');

	// The bundled config ships invitationFarmAddress = 0x0; inject the real one.
	const config = { ...baseConfig, invitationFarmAddress: env.invitationFarm };

	const farm = new InviteFarm(config);

	// Quota guard — fail fast with a clear message rather than a revert.
	const quota = await farm.getQuota(env.inviterSafe);
	if (quota <= 0n) {
		throw new Error(
			`Inviter ${env.inviterSafe} has no invite quota on the InvitationFarm. ` +
				`An admin must call setInviterQuota for it.`
		);
	}

	// Build the farm invite tx(s) targeting this specific invitee. `generateInvites`
	// throws InvitationError.inviteeAlreadyRegistered if the invitee is already a
	// Circles human — treat that as idempotent success.
	let transactions;
	try {
		const result = await farm.generateInvites(env.inviterSafe, [target]);
		transactions = result.transactions;
	} catch (err) {
		if (/already.*regist/i.test(err instanceof Error ? err.message : String(err))) {
			return { status: 'already', invitee: target, quotaRemaining: quota.toString() };
		}
		throw err;
	}

	if (!transactions?.length) {
		return { status: 'already', invitee: target, quotaRemaining: quota.toString() };
	}

	// Sign & send the farm transaction(s) FROM the inviter Safe ATOMICALLY in ONE
	// Safe tx (MultiSend). generateInvites returns
	// [claimInvite(), safeTransferFrom(bot CRC -> invitationModule, invitee)].
	//
	// These MUST be in the same transaction. claimInvite() makes the farm bot
	// trust the inviter with expiry = uint96(block.timestamp) — i.e. trust that is
	// only valid WITHIN the claim's block. The InvitationModule's proxied-invite
	// path then checks validateTrust(bot, inviter) during the transfer. If the two
	// calls are split into separate transactions, the bot->inviter trust has
	// already expired by the time the transfer runs, and it reverts with
	// TrustRequired (surfaced as Safe `GS013`). Running them as one Safe tx keeps
	// both in the same block so the just-set trust is still live.
	const runner = await SafeContractRunner.create(
		env.rpcUrl,
		env.inviterPrivateKey,
		env.inviterSafe,
		chains.gnosis
	);

	const receipt = await runner.sendTransaction(transactions);

	return {
		status: 'invited',
		invitee: target,
		txHash: receipt.transactionHash,
		quotaRemaining: (quota - 1n).toString()
	};
}
