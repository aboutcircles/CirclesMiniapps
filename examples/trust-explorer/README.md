# Circles Trust Explorer

> Explore the Circles social graph — view trust connections, search users, and trust/untrust in one tap.

## Overview

Trust Explorer lets you navigate the Circles web of trust. After connecting your wallet you instantly see your own trust stats (who you trust, who trusts you, and mutual connections). You can search any user by name or address, drill into their profile to see their trust graph, and trust or untrust them directly from the app. All reads use the `@aboutcircles/sdk`; trust/untrust writes go through the Hub V2 contract via the `miniapp-sdk.js` postMessage bridge.

## Development

```bash
npm install
npm run dev
```

Load it in the Circles MiniApp host via the Advanced tab at `https://circles.gnosis.io/miniapps`.

## Deployment

```bash
# From repo root:
./scripts/deploy-miniapp.sh examples/trust-explorer
```

## Architecture

- **Wallet bridge**: `miniapp-sdk.js` — postMessage protocol for transactions and signing
- **Circles reads**: `@aboutcircles/sdk` — profiles, trust, balances, RPC queries
- **Chain**: Gnosis Chain (ID 100)
