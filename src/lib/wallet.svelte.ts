import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';
import {
	createSafeSmartAccount,
	createSmartAccountClient,
	ENTRYPOINT_ADDRESS_V07
} from '@cometh/connect-sdk-4337';
import { createPimlicoClient } from 'permissionless/clients/pimlico';

const PIMLICO_URL = 'https://api.pimlico.io/v2/100/rpc?apikey=pim_2Zdnmr93fLfjgqHF9cDqKb';
const SAFE_ADDRESS = '0xc7d3dF890952a327Af94D5Ba6fdC1Bf145188a1b';

let address = $state<string>('');
let connected = $state(false);
let connecting = $state(false);

let smartAccountClient: any = null;
let publicClient: any = null;

function getConfig() {
	let apiKey = localStorage.getItem('cometh_api_key');
	if (!apiKey) {
		apiKey = prompt('Enter COMETH_API_KEY for Gnosis Chain:');
		if (!apiKey) return null;
		localStorage.setItem('cometh_api_key', apiKey);
	}
	return {
		apiKey,
		bundlerUrl: `https://bundler.cometh.io/100?apikey=${apiKey}`
	};
}

async function connect() {
	const config = getConfig();
	if (!config) return;

	connecting = true;

	try {
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
			smartAccountAddress: SAFE_ADDRESS
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

		address = SAFE_ADDRESS;
		connected = true;
	} catch (error: any) {
		console.error('Connection error:', error);
		if (error.message?.includes('API') || error.message?.includes('401')) {
			localStorage.removeItem('cometh_api_key');
		}
		alert('Failed to connect: ' + error.message);
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
	connect,
	sendTransaction,
	signMessage
};
