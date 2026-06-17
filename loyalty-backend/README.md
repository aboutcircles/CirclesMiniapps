# coffee-loyalty-backend

Backend for the [Coffee Loyalty miniapp](../src/routes/apps/coffee-loyalty). A
minimal Hono service (same shape as `invite-backend`) that turns a scanned QR +
wallet signature into a loyalty stamp, adds first-time customers to the shop's
Circles group, and mints a free-coffee NFT every 10 stamps.

## How it works

1. The shop owner displays today's QR (the owner view fetches today's rotating
   `secret` from `POST /owner/dashboard`). The QR opens the miniapp with
   `?data=<base64 {shop, secret}>`.
2. A customer scans it, the miniapp asks their wallet to **sign** a challenge
   binding the shop + today's secret, and POSTs `{ address, secret, signature }`.
3. This service verifies the signature (Safe/EIP-1271 supported), checks the
   secret is current, enforces **one stamp per customer per day**, and:
   - on first visit, calls `Hub.trust(customer)` **from the group Safe** (via a
     `SafeContractRunner` holding an owner key) — adding them to the group;
   - on the **10th** stamp, mints a `CoffeeStampNFT` to the customer and resets
     the counter.
4. The owner view lists customers and their unredeemed free-coffee NFTs and can
   `POST /redeem` (owner-signed) to mark one served.

The group-trust pattern is identical to the DappCon Booth Pass: a hot EOA that is
a signer on the group trusts anyone who signs in.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | — | liveness |
| GET | `/config` | — | `{ owner, group, nft, stampsPerReward }` |
| GET | `/customer/:address` | — | `{ stamps, rewards, isMember }` |
| POST | `/stamp` | customer signature | collect a stamp (`{ address, secret, signature }`) |
| POST | `/owner/dashboard` | owner signature | today's secret + all customers |
| POST | `/redeem` | owner signature | mark a free-coffee NFT redeemed |

Write endpoints are gated to `gnosis.io` origins and per-IP rate-limited.

## Run

```sh
cp .env.example .env   # fill in GROUP_SAFE_ADDRESS, OWNER_ADDRESS, OPERATOR_PRIVATE_KEY, NFT_CONTRACT_ADDRESS
npm install
npm run dev            # or: npm start
```

### Prerequisites (one-time, on-chain)

- A Circles **group** (Safe avatar) for the shop.
- The **operator EOA** added as an **owner/signer of the group Safe** (so it can
  sign `Hub.trust` on the group's behalf).
- The **CoffeeStampNFT** deployed (see `../contracts`) with the operator EOA set
  as `minter`.

`OPERATOR_PRIVATE_KEY` is a hot key — keep it server-side only, never in the
frontend or in commits.
