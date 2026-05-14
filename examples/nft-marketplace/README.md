# NFT Marketplace MiniApp

Mint, list, and sell ERC-721 NFTs priced in Gnosis BaseGroup wrapped CRC (`s-gCRC`). Embedded miniapp - runs inside the Gnosis wallet iframe.

## Stack

- Vite + vanilla JS frontend
- Vercel serverless functions for: IPFS pinning (Filebase), HMAC-signed payment-intent build, and indexer-based settlement
- Vercel KV (Upstash) for settlement idempotency
- Foundry contracts under [`contracts/`](contracts/)

## Locked addresses (Gnosis Chain, chainId 100)

| Role | Address |
|---|---|
| BaseGroup | `0xC19BC204eb1c1D5B3FE500E5E5dfaBaB625F286c` |
| Wrapped CRC (s-gCRC, static InflationaryCircles) | `0xeeF7B1f06B092625228C835Dd5D5B14641D1e54A` |
| Hub V2 | `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8` |

## Required env vars

Set these in the Vercel project (Production + Preview):

| Var | Purpose |
|---|---|
| `VITE_FACTORY_ADDRESS` | EditionsFactory address (populate after `forge script` deploy) |
| `VITE_DEPLOY_BLOCK` | Block number of the factory deploy (event indexing start) |
| `VITE_WRAPPED_CRC_ADDRESS` | s-gCRC token address (defaults to the locked address above) |
| `VITE_GNOSIS_RPC_URL` | RPC endpoint (defaults to `https://rpc.aboutcircles.com/`) |
| `APP_OPERATOR_PK` | Private key of the App Operator EOA that signs `Edition.settle` |
| `APP_HMAC_SECRET` | HMAC secret for payment intents (any high-entropy string) |
| `FILEBASE_ACCESS_KEY` | Filebase S3 access key |
| `FILEBASE_SECRET_KEY` | Filebase S3 secret key |
| `FILEBASE_BUCKET` | Filebase bucket name (IPFS-pinned) |
| `KV_REST_API_URL` | Vercel KV REST URL (auto-set by the KV integration) |
| `KV_REST_API_TOKEN` | Vercel KV REST token (auto-set by the KV integration) |
| `GNOSIS_RPC_URL` | Same as `VITE_GNOSIS_RPC_URL` but for server-side use |
| `CIRCLES_RPC_URL` | Circles indexer RPC (defaults to `https://rpc.aboutcircles.com/`) |

## Local development

```bash
pnpm install      # or npm install
pnpm dev          # vite on :5184
```

Test in the Gnosis playground: <https://circles.gnosis.io/playground> and paste `http://localhost:5184` as the miniapp URL.

## Contracts

See [`contracts/README.md`](contracts/) for deploy instructions. After deploy, copy the factory address + deploy block into `VITE_FACTORY_ADDRESS` and `VITE_DEPLOY_BLOCK` in the Vercel env (and locally in `.env.local` for dev).

## Architecture

See [`.agents/plans/nft-marketplace/design.md`](../../.agents/plans/nft-marketplace/design.md) for the full design - architecture diagram, contract interfaces, frontend views, buy flow, and indexing strategy.
