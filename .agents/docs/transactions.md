# Transaction patterns

Sending transactions through the host wallet bridge and waiting for receipts.

**Load this when:** sending transactions of any kind - direct ERC20 transfers, Hub V2 calls, Safe operations, contract interactions.

## Pattern D: SDK runner for write operations

The Circles SDK can send transactions on the user's behalf when given a runner. The runner is a small adapter that translates SDK transaction objects into the postMessage bridge format.

```javascript
import { Sdk } from '@aboutcircles/sdk';
import { sendTransactions } from '@aboutcircles/miniapp-sdk';

function toHexValue(value) {
  return value ? `0x${BigInt(value).toString(16)}` : '0x0';
}

function formatTxForHost(tx) {
  return { to: tx.to, data: tx.data || '0x', value: toHexValue(tx.value || 0n) };
}

let lastTxHashes = [];

function createRunner(address) {
  return {
    address,
    async sendTransaction(txs) {
      const hashes = await sendTransactions(txs.map(formatTxForHost));
      lastTxHashes = hashes;
      return await waitForReceipts(hashes);
    },
  };
}

const sdk = new Sdk('https://rpc.aboutcircles.com/', createRunner(connectedAddress));
```

**Notes:**
- Always pass values as `0x`-prefixed hex strings, never raw numbers or BigInts.
- `sendTransactions` returns an array of hashes. The host may batch them as a UserOp - which is why receipt polling needs the fallback in Pattern F.
- Recreate the runner whenever the connected address changes.

## Pattern F: Receipt polling with multi-RPC and UserOp fallback

The host wallet uses ERC-4337 account abstraction, so transaction hashes returned to the miniapp may actually be **UserOperation hashes**, not transaction hashes. Standard `getTransactionReceipt` will not resolve these directly. Use this pattern.

```javascript
import { createPublicClient, http, parseAbiItem } from 'viem';
import { gnosis } from 'viem/chains';

const RPC_FALLBACK_URLS = [
  'https://rpc.aboutcircles.com/',
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

const POLL_MS = 3000;
const TIMEOUT_MS = 12 * 60 * 1000;
const ENTRYPOINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const LOOKBACK = 5000n;

const receiptClients = RPC_FALLBACK_URLS.map(url =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

async function waitForReceipts(hashes) {
  return Promise.all(hashes.map(waitForReceiptFromAnyRpc));
}

async function waitForReceiptFromAnyRpc(hash) {
  const deadline = Date.now() + TIMEOUT_MS;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    // First try direct receipt lookup
    for (const client of receiptClients) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        if (r) return r;
      } catch {}
    }
    // Every other round, try resolving as a UserOp
    if (round % 2 === 0) {
      for (const client of receiptClients) {
        const r = await tryResolveUserOp(client, hash);
        if (r) return r;
      }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for ${hash}`);
}

async function tryResolveUserOp(client, userOpHash) {
  try {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > LOOKBACK ? latest - LOOKBACK : 0n;
    const logs = await client.getLogs({
      address: ENTRYPOINT,
      event: parseAbiItem(
        'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
      ),
      args: { userOpHash },
      fromBlock,
      toBlock: latest,
    });
    if (logs.length > 0) {
      return await client.getTransactionReceipt({ hash: logs.at(-1).transactionHash });
    }
  } catch {}
  return null;
}
```

**Notes:**
- The 12-minute timeout is generous and accounts for Gnosis Chain congestion plus bundler delays.
- A 5000-block lookback (`LOOKBACK`) is roughly 16 hours on Gnosis Chain - enough headroom for any reasonable user flow.
- Always verify receipts have `status: 'success'` before declaring a transaction successful. A confirmed receipt with `status: 'reverted'` is still a failure.

## Hex encoding rules

All transaction fields passed to `sendTransactions` must be hex-encoded:

| Field | Format | Example |
|---|---|---|
| `to` | `0x`-prefixed checksummed address | `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8` |
| `data` | `0x`-prefixed hex bytes (or `0x` for empty) | `0xa9059cbb...` |
| `value` | `0x`-prefixed hex of wei amount (or `0x0` for none) | `0xde0b6b3a7640000` |

Use the `toHexValue()` helper above for any BigInt-to-hex conversion.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Receipt never returns | Transaction is a UserOp, direct lookup doesn't work | Use the multi-RPC + UserOp fallback above |
| Transaction throws "passkey" error | Passkey auto-connect failed at the host | Show specific recovery message - see `@.agents/docs/patterns/utilities.md` Pattern M |
| `value` rejected | Passed as number or raw BigInt | Always hex-encode via `toHexValue()` |
| Receipt has `status: 'reverted'` | On-chain revert | Surface to user; check transaction inputs and contract state |
