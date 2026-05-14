// Wallet abstraction: switches between the @aboutcircles/miniapp-sdk bridge
// (when running embedded in the Gnosis wallet) and a viem-based local wallet
// (when running against a local Anvil for dev / click-through testing).
//
// Activate dev mode by setting `VITE_DEV_WALLET_PK` in the env. When that env
// is empty, the module just re-exports from miniapp-sdk so the production
// build is byte-identical.

import {
  isMiniappMode as sdkIsMiniappMode,
  onWalletChange as sdkOnWalletChange,
  sendTransactions as sdkSendTransactions,
  signMessage as sdkSignMessage,
} from '@aboutcircles/miniapp-sdk';

const DEV_PK = import.meta.env.VITE_DEV_WALLET_PK;
const DEV_RPC = import.meta.env.VITE_GNOSIS_RPC_URL || 'http://localhost:8545';

let devClient;
let devAccount;

async function getDev() {
  if (devClient) return { client: devClient, account: devAccount };
  const { createWalletClient, createPublicClient, http } = await import('viem');
  const { privateKeyToAccount } = await import('viem/accounts');
  // Chain stub: local anvil pretends to be Gnosis (id 100) by default.
  const chain = { id: 100, name: 'anvil-gnosis', nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 }, rpcUrls: { default: { http: [DEV_RPC] } } };
  devAccount = privateKeyToAccount(DEV_PK.startsWith('0x') ? DEV_PK : `0x${DEV_PK}`);
  devClient = createWalletClient({ account: devAccount, chain, transport: http(DEV_RPC) });
  devClient.public = createPublicClient({ chain, transport: http(DEV_RPC) });
  return { client: devClient, account: devAccount };
}

export function isDevMode() {
  return Boolean(DEV_PK);
}

export function isMiniappMode() {
  if (isDevMode()) return true; // pretend we're embedded so the UI doesn't show the "not embedded" hint
  return sdkIsMiniappMode();
}

export function onWalletChange(cb) {
  if (!isDevMode()) return sdkOnWalletChange(cb);
  // Fire once with the dev account.
  getDev().then(({ account }) => cb(account.address));
}

export async function sendTransactions(txs) {
  if (!isDevMode()) return sdkSendTransactions(txs);
  const { client } = await getDev();
  const hashes = [];
  for (const tx of txs) {
    const hash = await client.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : 0n,
    });
    hashes.push(hash);
    // Wait for the tx to be mined so subsequent reads see the new state.
    await client.public.waitForTransactionReceipt({ hash });
  }
  return hashes;
}

export async function signMessage(message) {
  if (!isDevMode()) return sdkSignMessage(message);
  const { client } = await getDev();
  return client.signMessage({ message });
}
