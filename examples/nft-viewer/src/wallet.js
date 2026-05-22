/**
 * Wallet abstraction — bridges @aboutcircles/miniapp-sdk (production)
 * with a viem-based local wallet (dev/testing).
 *
 * Set VITE_DEV_WALLET_PK in .env to activate dev mode.
 */

const DEV_PK = import.meta.env.VITE_DEV_WALLET_PK;

export function isDevMode() {
  return !!DEV_PK;
}

export function isMiniappMode() {
  // In dev mode we pretend to be embedded so the UI doesn't show the
  // "not embedded" hint.
  return true;
}

/**
 * Subscribe to wallet changes. In production the miniapp-sdk fires events;
 * in dev mode we immediately call back with the local account.
 *
 * @param {(address: `0x${string}` | false) => void} cb
 */
export function onWalletChange(cb) {
  if (DEV_PK) {
    import('viem/accounts').then(({ privateKeyToAccount }) => {
      const account = privateKeyToAccount(DEV_PK);
      cb(account.address);
    });
    return () => {};
  }

  // Production: dynamically import the SDK to avoid bundling issues
  // when running standalone.
  import('@aboutcircles/miniapp-sdk').then(({ onWalletChange: sdkOnWalletChange }) => {
    sdkOnWalletChange((wallet) => {
      if (wallet?.address) cb(wallet.address);
      else cb(false);
    });
  }).catch(() => {
    // SDK not available (e.g. standalone browser) — fire false after a tick
    setTimeout(() => cb(false), 100);
  });

  return () => {};
}

/**
 * Send transactions. In dev mode broadcasts directly; in production
 * routes through the miniapp-sdk bridge.
 */
export async function sendTransactions(txs) {
  if (DEV_PK) {
    const { createWalletClient, http } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { gnosis } = await import('viem/chains');
    const account = privateKeyToAccount(DEV_PK);
    const client = createWalletClient({
      account,
      chain: gnosis,
      transport: http(import.meta.env.VITE_RPC_URL || 'https://rpc.aboutcircles.com/'),
    });
    const hashes = [];
    for (const tx of txs) {
      const hash = await client.sendTransaction(tx);
      hashes.push(hash);
    }
    return hashes;
  }

  const { sendTransactions: sdkSend } = await import('@aboutcircles/miniapp-sdk');
  return sdkSend(txs);
}

/**
 * Sign a message.
 */
export async function signMessage(message) {
  if (DEV_PK) {
    const { createWalletClient, http } = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { gnosis } = await import('viem/chains');
    const account = privateKeyToAccount(DEV_PK);
    const client = createWalletClient({
      account,
      chain: gnosis,
      transport: http(import.meta.env.VITE_RPC_URL || 'https://rpc.aboutcircles.com/'),
    });
    return client.signMessage({ message });
  }

  const { signMessage: sdkSign } = await import('@aboutcircles/miniapp-sdk');
  return sdkSign(message);
}