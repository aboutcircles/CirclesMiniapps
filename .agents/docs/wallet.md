# Wallet patterns

How miniapps connect to the host wallet and detect their runtime environment.

**Load this when:** implementing wallet connection, handling connect/disconnect state, or distinguishing iframe mode from standalone dev mode.

## Pattern A: Wallet connection via `onWalletChange`

The primary entry point for any miniapp. The callback fires whenever the connected wallet changes (initial load, connect, disconnect, account switch).

```javascript
import { onWalletChange, sendTransactions } from '@aboutcircles/miniapp-sdk';

let connectedAddress = null;

onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    showDisconnectedUI();
    return;
  }
  connectedAddress = address; // already checksummed
  await initializeApp(address);
});
```

**Notes:**
- Addresses returned are already checksummed - no need to call `getAddress()` again before display.
- Treat `null` / undefined address as "show disconnected UI", not as an error.
- Fires on initial load if a wallet is already connected, so this is also your bootstrap hook.

## Pattern N: Detecting standalone vs host mode

Use `isMiniappMode()` to provide fallback behaviour when running outside the host iframe (typically during local dev).

```javascript
import { isMiniappMode } from '@aboutcircles/miniapp-sdk';

if (!isMiniappMode()) {
  console.warn('Not running inside the Circles MiniApp host.');
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div style="background:#fff9ea;padding:8px 16px;font-size:12px;text-align:center">' +
    '⚠ Running in standalone mode - wallet operations will not work. ' +
    'Load via https://circles.gnosis.io/miniapps to test fully.</div>'
  );
}
```

**What works in standalone mode:**
- All Circles SDK reads (profile, avatar, balances, trust, RPC queries) - test these locally with any known Circles avatar address.

**What does NOT work in standalone mode:**
- `sendTransactions`, `signMessage` - these require the host iframe.

## Pattern O: Host app data via `onAppData`

The host passes app-specific context as a **raw string** (it arrives base64-decoded from the host's `?data=` query param - the SDK hands you the decoded string, not a parsed object).

```javascript
import { onAppData } from '@aboutcircles/miniapp-sdk';

onAppData((raw) => {
  // raw is a string - the host does NOT parse it for you
  const data = safelyParse(raw); // your own JSON.parse + schema validation
  if (!data) return;
  applyHostContext(data); // e.g. entry resource id, mode, feature flags, referral code
});
```

Typical uses: entry context (resource id, mode, source), feature flags, campaign/referral metadata.

**Never trust raw host data.** Always parse defensively and validate against an expected shape before using it - treat it like untrusted user input (length limits, allowlists, render-safe escaping).

## Pattern P: Signing via `signMessage`

Use when a backend or protocol needs a host-backed signature.

```javascript
import { signMessage } from '@aboutcircles/miniapp-sdk';

const { signature, verified } = await signMessage('Example message', 'erc1271');
// persist BOTH the signature and the signatureType - the verifier needs the type
```

**Notes:**
- `signatureType` defaults to `'erc1271'`. Prefer it unless you explicitly need raw-bytes (EOA) semantics, then pass `'raw'`.
- Host semantics (confirmed in host source): `'erc1271'` returns `verified: true`; `'raw'` returns `verified` as derived by the wallet.
- Always persist the signature type alongside the signature - an ERC-1271 signature verifies differently from a raw one.
- Requires the host iframe; does not work in standalone mode.

## Pattern Q: Bridge isolation, lifecycle & error model

Structural conventions the official guide recommends - apply them to any non-trivial miniapp.

**Isolate the bridge.** Keep every `@aboutcircles/miniapp-sdk` import in one module (e.g. `host/bridge.js`) and import the host primitives only from there. Domain code never imports the SDK directly. This keeps write paths auditable and makes standalone fallbacks trivial.

**Finite-state wallet lifecycle.** Model wallet state explicitly: `disconnected → connecting → connected → error`. On every `onWalletChange`, reset account-scoped caches before loading new data - never assume prior in-memory state survives a reconnect or account switch.

**Normalized error model.** Map every failure into one of: `validation_error`, `user_rejected`, `network_error`, `host_bridge_error`, `unexpected_error`. Normalize unknowns rather than surfacing raw objects:

```javascript
export function normalizeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.shortMessage || err.message || String(err);
}
```

Do not silently retry state-changing actions; preserve user input where safe and show actionable recovery guidance (e.g. passkey auto-connect failure → prompt the user to reconnect via the host).

**Race control.** Guard wallet-dependent init, debounced search, and paginated loads with a request-ID latch so stale async results are discarded:

```javascript
let reqId = 0;
export async function runLatest(task) {
  const id = ++reqId;
  const result = await task();
  return id === reqId ? result : null; // stale → drop
}
```

## Available exports from `@aboutcircles/miniapp-sdk`

Signatures below match the live host protocol in `src/routes/miniapps/[slug]/+page.svelte`, not just the published docs.

| Export | Signature | Purpose |
|---|---|---|
| `isMiniappMode()` | `(): boolean` | Detect if running in the host iframe |
| `onWalletChange(cb)` | `(fn: (address: string \| null) => void): () => void` | Subscribe to wallet state changes; **returns an unsubscribe function** |
| `onAppData(cb)` | `(fn: (data: string) => void): void` | Receive a raw string passed by the host (see Pattern O) |
| `sendTransactions(txs)` | `(txs: Transaction[]): Promise<string[]>` | Send transactions via the host wallet; resolves to hashes |
| `signMessage(msg, type?)` | `(message: string, signatureType?: 'erc1271' \| 'raw'): Promise<{ signature: string; verified: boolean }>` | Sign a message via the host wallet (see Pattern P) |

`Transaction` is `{ to: string; data?: string; value?: string }` - `value` is a hex string (e.g. `"0x0"`). See `@.agents/docs/transactions.md` for the host formatting adapter.
