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

## Available exports from `@aboutcircles/miniapp-sdk`

| Export | Type | Purpose |
|---|---|---|
| `onWalletChange(cb)` | function | Subscribe to wallet state changes |
| `sendTransactions(txs)` | async function | Send transactions via the host wallet |
| `signMessage(msg)` | async function | Sign a message via the host wallet |
| `onAppData(cb)` | function | Receive structured data from the host |
| `isMiniappMode()` | boolean function | Detect if running in the host iframe |
