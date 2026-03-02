import { createPublicClient, http, getAddress, toHex } from 'viem';
import { gnosis } from 'viem/chains';
import {
	createSafeSmartAccount,
	createSmartAccountClient,
	retrieveAccountAddressFromPasskeys,
	ENTRYPOINT_ADDRESS_V07
} from '@cometh/connect-sdk-4337';
import { createPimlicoClient } from 'permissionless/clients/pimlico';

const COMETH_API_KEY = import.meta.env.VITE_COMETH_API_KEY;
const PIMLICO_API_KEY = import.meta.env.VITE_PIMLICO_API_KEY;
const PIMLICO_URL = `https://api.pimlico.io/v2/100/rpc?apikey=${PIMLICO_API_KEY}`;

const SAFE_ADDRESS_KEY = 'safe_address';
const CIRCLES_RPC_URL = 'https://rpc.aboutcircles.com/';

let address = $state<string>('');
let connected = $state(false);
let connecting = $state(false);
let avatarName = $state<string>('');
let avatarImageUrl = $state<string>('');
let manuallyDisconnected = false;
let autoConnecting = false;

function getSavedSafeAddress(): string {
	return localStorage.getItem(SAFE_ADDRESS_KEY) ?? '';
}

let smartAccountClient: any = null;
let publicClient: any = null;

function getConfig() {
	if (!COMETH_API_KEY) {
		console.error('VITE_COMETH_API_KEY is not set in .env');
		return null;
	}
	return {
		apiKey: COMETH_API_KEY,
		bundlerUrl: `https://bundler.cometh.io/100?apikey=${COMETH_API_KEY}`
	};
}

async function connectWithPasskey() {
	const config = getConfig();
	if (!config) return;

	connecting = true;
	try {
		const resolved = await retrieveAccountAddressFromPasskeys({
			apiKey: config.apiKey,
			chain: gnosis
		});
		await connect(resolved as string);
	} catch (error: any) {
		console.error('Passkey connection error:', error);
		if (!autoConnecting) alert('Failed to connect: ' + error.message);
	} finally {
		connecting = false;
	}
}

async function connect(safeAddress: string) {
	const config = getConfig();
	if (!config) return;

	connecting = true;

	try {
		safeAddress = getAddress(safeAddress);
		localStorage.setItem(SAFE_ADDRESS_KEY, safeAddress);

		publicClient = createPublicClient({
			chain: gnosis,
			transport: http(),
			cacheTime: 60_000,
			batch: { multicall: { wait: 50 } }
		});

		const smartAccount = await createSafeSmartAccount({
			apiKey: config.apiKey,
			publicClient,
			chain: gnosis,
			smartAccountAddress: safeAddress
		});

		const paymasterClient = createPimlicoClient({
			transport: http(PIMLICO_URL),
			chain: gnosis,
			entryPoint: { address: ENTRYPOINT_ADDRESS_V07, version: '0.7' }
		});

		const gasPrice = await paymasterClient.getUserOperationGasPrice();

		smartAccountClient = createSmartAccountClient({
			account: smartAccount,
			chain: gnosis,
			bundlerTransport: http(config.bundlerUrl),
			paymaster: paymasterClient,
			userOperation: {
				estimateFeesPerGas: async () => gasPrice.fast
			}
		});

		address = safeAddress;
		connected = true;
		fetchAvatarInfo(safeAddress);
	} catch (error: any) {
		console.error('Connection error:', error);
		if (!autoConnecting) alert('Failed to connect: ' + error.message);
	} finally {
		connecting = false;
	}
}

async function fetchAvatarInfo(safeAddress: string) {
	try {
		const res = await fetch(CIRCLES_RPC_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'circles_getProfileByAddress',
				params: [safeAddress]
			})
		});
		const json = await res.json();
		const result = json?.result;
		avatarName = result?.name ?? '';
		avatarImageUrl = result?.previewImageUrl ?? '';
	} catch {
		avatarName = '';
		avatarImageUrl = '';
	}
}

async function sendTransaction(tx: { to: string; data?: string; value?: string }) {
	if (!smartAccountClient) throw new Error('Wallet not connected');
	return smartAccountClient.sendTransaction({
		to: tx.to,
		data: tx.data || '0x',
		value: tx.value ? BigInt(tx.value) : 0n
	});
}

async function sendTransactions(txs: { to: string; data?: string; value?: string }[]) {
	if (!smartAccountClient) throw new Error('Wallet not connected');
	return smartAccountClient.sendTransaction({
		calls: txs.map((tx) => ({
			to: tx.to,
			data: tx.data || '0x',
			value: tx.value ? BigInt(tx.value) : 0n
		}))
	});
}

function disconnect() {
	smartAccountClient = null;
	publicClient = null;
	localStorage.removeItem(SAFE_ADDRESS_KEY);
	if (address) localStorage.removeItem(`cometh-connect-${address}`);
	address = '';
	avatarName = '';
	avatarImageUrl = '';
	connected = false;
	manuallyDisconnected = true;
}

/** Call on page mount. Auto-connects from saved address or passkey; skips if user disconnected this session. */
async function autoConnect() {
	if (connected || connecting || manuallyDisconnected) return;
	autoConnecting = true;
	try {
		const target = getSavedSafeAddress();
		if (target) {
			await connect(target);
		} else {
			await connectWithPasskey();
		}
	} finally {
		autoConnecting = false;
	}
}

async function signMessage(message: string) {
	if (!smartAccountClient) throw new Error('Wallet not connected');
	// The auth service verifies via Safe.isValidSignature(bytes rawMsgBytes, sig),
	// which on-chain computes: challenge = SafeMessage EIP-712 of keccak256(rawMsgBytes).
	//
	// signTypedData bypasses the SDK's internal generateSafeMessageMessage() wrapper
	// (which would add an extra EIP-191 hash), letting us pass rawMsgBytes directly
	// as the SafeMessage content — matching exactly what the auth service verifies.
	const chainId = smartAccountClient.chain?.id ?? 100;
	const safeAddress = smartAccountClient.account.address;
	const rawMsgBytes = toHex(new TextEncoder().encode(message));
	const signature = await smartAccountClient.account.signTypedData({
		domain: { chainId, verifyingContract: safeAddress },
		types: { SafeMessage: [{ name: 'message', type: 'bytes' }] },
		primaryType: 'SafeMessage',
		message: { message: rawMsgBytes }
	});
	const verified = await publicClient.verifyMessage({
		address: safeAddress,
		message,
		signature
	});
	return { signature, verified };
}

/**
 * Sign a message using the standard EIP-191 + ERC-1271 path.
 *
 * Use this for any consumer that verifies via isValidSignature(eip191Hash, sig),
 * including XMTP (libxmtp passes eip191_hash_message(text) to isValidSignature)
 * and standard EIP-1271 wallets.
 *
 * Flow:
 *   account.signMessage({ message }) → generateSafeMessageMessage(msg) = hashMessage(msg) = eip191Hash
 *   → signs SafeMessage{ message: eip191Hash } via signTypedData
 *   Verifier calls isValidSignature(eip191Hash, sig) → Safe reconstructs same SafeMessage hash ✓
 *
 * NOTE: This is NOT compatible with the auth service (which calls isValidSignature(rawBytes, sig)).
 * Use wallet.signMessage() for the auth service flow.
 */
async function signErc1271Message(message: string) {
	if (!smartAccountClient) throw new Error('Wallet not connected');
	const signature = await smartAccountClient.account.signMessage({ message });
	return signature as `0x${string}`;
}

export const wallet = {
	get address() { return address; },
	get connected() { return connected; },
	get connecting() { return connecting; },
	get avatarName() { return avatarName; },
	get avatarImageUrl() { return avatarImageUrl; },
	getSavedSafeAddress,
	connect,
	connectWithPasskey,
	disconnect,
	autoConnect,
	sendTransaction,
	sendTransactions,
	signMessage,
	signErc1271Message
};
