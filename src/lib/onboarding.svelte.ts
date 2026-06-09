/**
 * onboarding — passkey Safe sign-up logic for the Circles miniapp platform.
 *
 * Sign up:
 *  1. createPasskeySafe() — create a brand-new Safe smart account controlled by a
 *     WebAuthn passkey (Cometh) and enable the Circles invitation module, in a
 *     single Pimlico-sponsored UserOp.
 *  2. inviteAccount(safe) — ask the invite backend to invite the new Safe into
 *     Circles via the InvitationFarm (server holds the inviter Safe + quota).
 *
 * Login is handled directly by the shared wallet store (wallet.connectWithPasskey).
 *
 * Pure functions — callers own the reactive $state. The Safe↔passkey mapping is
 * persisted by Cometh server-side; we also cache the Safe address in localStorage
 * under the same key the shared wallet store uses.
 */
import { createPublicClient, http, getAddress, encodeFunctionData, type Hex } from 'viem';
import { gnosis } from 'viem/chains';
import {
	createSafeSmartAccount,
	createSmartAccountClient,
	ENTRYPOINT_ADDRESS_V07
} from '@cometh/connect-sdk-4337';
import { createPimlicoClient } from 'permissionless/clients/pimlico';
import { Profiles } from '@aboutcircles/sdk-profiles';
import { cidV0ToHex } from '@aboutcircles/sdk-utils';

const COMETH_API_KEY = import.meta.env.VITE_COMETH_API_KEY as string | undefined;
const PIMLICO_API_KEY = import.meta.env.VITE_PIMLICO_API_KEY as string | undefined;
const PIMLICO_SPONSORSHIP_POLICY_ID = import.meta.env.VITE_PIMLICO_SPONSORSHIP_POLICY_ID as
	| string
	| undefined;
const PIMLICO_URL = `https://api.pimlico.io/v2/100/rpc?apikey=${PIMLICO_API_KEY}`;

const INVITE_BACKEND_URL = (import.meta.env.VITE_INVITE_BACKEND_URL as string | undefined)?.replace(
	/\/$/,
	''
);

// Circles profile pinning + RPC (for metadata digest derivation).
const CIRCLES_RPC_URL = 'https://rpc.aboutcircles.com/';
const PROFILE_SERVICE_URL = 'https://rpc.aboutcircles.com/profiles/';

// Same key the shared wallet store (src/lib/wallet.svelte.ts) reads, so a Safe
// created here is picked up app-wide on the next autoConnect.
const SAFE_ADDRESS_KEY = 'safe_address';

// Circles invitation module + NameRegistry on Gnosis Chain (chainId 100).
export const INVITATION_MODULE = '0x00738aca013B7B2e6cfE1690F0021C3182Fa40B5' as const;
export const NAME_REGISTRY = '0xA27566fD89162cC3D40Cb59c87AAaA49B85F3474' as const;

// Minimal ABIs — enableModule (Safe self-call) + updateMetadataDigest (NameRegistry).
const SAFE_ABI = [
	{
		inputs: [{ name: 'module', type: 'address' }],
		name: 'enableModule',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function'
	}
] as const;

const NAME_REGISTRY_ABI = [
	{
		inputs: [{ name: 'metadataDigest', type: 'bytes32' }],
		name: 'updateMetadataDigest',
		outputs: [],
		stateMutability: 'nonpayable',
		type: 'function'
	}
] as const;

/** Progress callback so the UI can render sub-status during sign-up. */
export type ProgressFn = (phase: CreationPhase) => void;
export type CreationPhase = 'creating_safe' | 'deploying' | 'done';

export interface CreationResult {
	safeAddress: string;
	/** The single batched UserOp that deploys the Safe and enables the module. */
	setupTx: string;
	/**
	 * The already-built Cometh smart-account client for the new Safe. Hand this to
	 * wallet.adoptSmartAccount() to log in WITHOUT re-deriving from the passkey
	 * (avoids an extra passkey prompt).
	 */
	smartAccountClient: unknown;
}

export interface InviteResult {
	status: 'invited' | 'already' | 'skipped';
	txHash?: string;
	error?: string;
}

function assertConfig(): string {
	if (!COMETH_API_KEY) throw new Error('VITE_COMETH_API_KEY is not set.');
	if (!PIMLICO_API_KEY) throw new Error('VITE_PIMLICO_API_KEY is not set.');
	if (!PIMLICO_SPONSORSHIP_POLICY_ID) {
		// The freshly created Safe holds no xDAI, so without a sponsorship policy
		// Pimlico won't pay and the deploy UserOp would revert.
		throw new Error(
			'VITE_PIMLICO_SPONSORSHIP_POLICY_ID is not set — gas sponsorship is required ' +
				'to deploy a new Safe (it has no funds to pay for gas).'
		);
	}
	return COMETH_API_KEY;
}

/**
 * Human-friendly passkey label, e.g. "Circles Jun 03 2026 02:15 PM".
 * This is what the user sees in their device's passkey manager, so a timestamp
 * makes multiple Circles passkeys distinguishable.
 */
function passkeyName(): string {
	const d = new Date();
	const mon = d.toLocaleString('en-US', { month: 'short' }); // 3-letter month
	const dd = String(d.getDate()).padStart(2, '0');
	const yyyy = d.getFullYear();
	let h = d.getHours();
	const ampm = h >= 12 ? 'PM' : 'AM';
	h = h % 12 || 12;
	const hh = String(h).padStart(2, '0');
	const min = String(d.getMinutes()).padStart(2, '0');
	return `Circles ${mon} ${dd} ${yyyy} ${hh}:${min} ${ampm}`;
}

/**
 * Pin a Circles profile (name only for now) and return its on-chain metadata
 * digest (bytes32). Names are NOT unique — any string is accepted.
 */
async function pinProfileDigest(name: string): Promise<Hex> {
	const profiles = new Profiles(CIRCLES_RPC_URL, PROFILE_SERVICE_URL);
	const cid = await profiles.create({ name: name.trim() });
	return cidV0ToHex(cid);
}

/**
 * Create a new passkey-controlled Safe, enable the Circles invitation module, and
 * set the user's profile metadata digest (name) on the NameRegistry.
 * Triggers the WebAuthn passkey prompt. Sponsored by Pimlico.
 *
 * Both on-chain calls go in the FIRST (and only) UserOp, which also deploys the
 * Safe — one op avoids the `AA10 sender already constructed` error a second op
 * would hit by re-attaching factory data.
 *
 * @param name The user's chosen display name (not unique).
 */
export async function createPasskeySafe(name: string, onProgress?: ProgressFn): Promise<CreationResult> {
	const apiKey = assertConfig();

	onProgress?.('creating_safe');

	// Pin the profile FIRST (before the passkey prompt) so a pin failure surfaces
	// cleanly without having already created a passkey/Safe.
	const metadataDigest = await pinProfileDigest(name);

	const publicClient = createPublicClient({
		chain: gnosis,
		transport: http(),
		cacheTime: 60_000,
		batch: { multicall: { wait: 50 } }
	});

	// No smartAccountAddress => create a NEW counterfactual Safe from the passkey.
	// passKeyName is the label shown in the user's device passkey manager.
	const smartAccount = await createSafeSmartAccount({
		apiKey,
		publicClient,
		chain: gnosis,
		comethSignerConfig: { passKeyName: passkeyName() }
	});

	const paymasterClient = createPimlicoClient({
		transport: http(PIMLICO_URL),
		chain: gnosis,
		entryPoint: { address: ENTRYPOINT_ADDRESS_V07, version: '0.7' }
	});

	const smartAccountClient = createSmartAccountClient({
		account: smartAccount,
		chain: gnosis,
		bundlerTransport: http(PIMLICO_URL),
		paymaster: paymasterClient,
		paymasterContext: { sponsorshipPolicyId: PIMLICO_SPONSORSHIP_POLICY_ID },
		userOperation: {
			estimateFeesPerGas: async () => {
				const gasPrice = await paymasterClient.getUserOperationGasPrice();
				return gasPrice.fast;
			}
		}
	});

	const safeAddress = getAddress(smartAccount.address);
	try {
		localStorage.setItem(SAFE_ADDRESS_KEY, safeAddress);
	} catch {
		/* localStorage unavailable — non-fatal */
	}

	onProgress?.('deploying');
	const setupTx = await smartAccountClient.sendTransaction({
		calls: [
			{
				to: safeAddress,
				value: 0n,
				data: encodeFunctionData({
					abi: SAFE_ABI,
					functionName: 'enableModule',
					args: [INVITATION_MODULE]
				})
			},
			{
				// Set the user's profile (name) metadata digest on the NameRegistry,
				// called by the Safe itself.
				to: NAME_REGISTRY,
				value: 0n,
				data: encodeFunctionData({
					abi: NAME_REGISTRY_ABI,
					functionName: 'updateMetadataDigest',
					args: [metadataDigest]
				})
			}
		]
	});

	onProgress?.('done');
	return { safeAddress, setupTx: setupTx as string, smartAccountClient };
}

/**
 * Ask the invite backend to invite a (just-created) Safe into Circles via the
 * InvitationFarm. Returns 'skipped' if no backend URL is configured so sign-up
 * still succeeds without it.
 *
 * `app` is an attribution tag (the miniapp origin when triggered from inside a
 * miniapp; omitted for direct host sign-ups → recorded as 'direct').
 */
export async function inviteAccount(safeAddress: string, app?: string): Promise<InviteResult> {
	if (!INVITE_BACKEND_URL) {
		return { status: 'skipped', error: 'VITE_INVITE_BACKEND_URL not set' };
	}
	try {
		const res = await fetch(`${INVITE_BACKEND_URL}/invite`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ account: getAddress(safeAddress), ...(app ? { app } : {}) })
		});
		const json = await res.json().catch(() => ({}));
		if (!res.ok) {
			return { status: 'skipped', error: json?.error ?? `Invite failed (${res.status})` };
		}
		return { status: json.status === 'already' ? 'already' : 'invited', txHash: json.txHash };
	} catch (err) {
		return { status: 'skipped', error: err instanceof Error ? err.message : String(err) };
	}
}

const HUB_V2 = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8' as const;
const HUB_IS_HUMAN_ABI = [
	{
		inputs: [{ name: '', type: 'address' }],
		name: 'isHuman',
		outputs: [{ name: '', type: 'bool' }],
		stateMutability: 'view',
		type: 'function'
	}
] as const;

/**
 * Confirm on-chain that `safeAddress` is now a registered Circles human. The
 * invite transaction (run by the backend's farm flow) may take a block or two to
 * settle, so we poll Hub.isHuman a few times before giving up.
 *
 * Authoritative source of truth for "is the account actually in Circles" — used
 * to gate the sign-up success screen so we never claim success prematurely.
 */
export async function confirmRegistered(
	safeAddress: string,
	{ attempts = 8, intervalMs = 1500 }: { attempts?: number; intervalMs?: number } = {}
): Promise<boolean> {
	const pc = createPublicClient({ chain: gnosis, transport: http() });
	const account = getAddress(safeAddress);
	for (let i = 0; i < attempts; i++) {
		try {
			const human = await pc.readContract({
				address: HUB_V2,
				abi: HUB_IS_HUMAN_ABI,
				functionName: 'isHuman',
				args: [account]
			});
			if (human) return true;
		} catch {
			/* transient RPC error — retry */
		}
		if (i < attempts - 1) await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}
