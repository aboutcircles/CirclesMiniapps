import { createPublicClient, http, getAddress } from 'viem';
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

let address = $state<string>('');
let connected = $state(false);
let connecting = $state(false);
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

		smartAccountClient = createSmartAccountClient({
			account: smartAccount,
			chain: gnosis,
			bundlerTransport: http(config.bundlerUrl),
			paymaster: paymasterClient,
			userOperation: {
				estimateFeesPerGas: async () => ({
					maxFeePerGas: 2000000000n,
					maxPriorityFeePerGas: 1000000000n
				})
			}
		});

		address = safeAddress;
		connected = true;
	} catch (error: any) {
		console.error('Connection error:', error);
		if (!autoConnecting) alert('Failed to connect: ' + error.message);
	} finally {
		connecting = false;
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
	if (txs.length === 1) return sendTransaction(txs[0]);
	return smartAccountClient.sendUserOperation({
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
	const signature = await smartAccountClient.account.signMessage({ message });
	const verified = await publicClient.verifyMessage({
		address: smartAccountClient.account.address,
		message,
		signature
	});
	return { signature, verified };
}

export const wallet = {
	get address() { return address; },
	get connected() { return connected; },
	get connecting() { return connecting; },
	getSavedSafeAddress,
	connect,
	connectWithPasskey,
	disconnect,
	autoConnect,
	sendTransaction,
	sendTransactions,
	signMessage
};
