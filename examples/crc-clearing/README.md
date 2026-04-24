# Circles Clearing

> A Circles MiniApp.

## Overview

<!-- TODO: one paragraph describing what this app does and why -->

## Development

```bash
npm install
npm run dev
```

Load it in the Circles MiniApp host via the Advanced tab at `https://circles.gnosis.io/miniapps`.

## Deployment

```bash
# From repo root:
./scripts/deploy-miniapp.sh examples/crc-clearing
```

## Architecture

- **Wallet bridge**: `miniapp-sdk.js` — postMessage protocol for transactions and signing
- **Circles reads**: `@aboutcircles/sdk` — profiles, trust, balances, RPC queries
- **Chain**: Gnosis Chain (ID 100)
