# Test Account Flag

A Circles MiniApp that allows account owners to flag their Circles accounts as **test accounts** to improve data quality across the ecosystem.

## What It Does

- Connects to your Circles wallet
- Reads your current Circles profile
- Allows you to **set** or **remove** an `isTestAccount: true` flag in your profile's `customFields`
- Writes the updated profile to IPFS and registers the new metadata digest on-chain via the NameRegistry contract

## Why

A significant number of Circles accounts are test accounts controlled by Circles/Gnosis App teams. These accounts:

- Skew analytics and growth metrics
- Get added to groups by various TMSs
- Are not distinguished from real user accounts

This tool enables self-flagging so that analytics dashboards, TMS services, and other ecosystem tools can filter test accounts from real user data.

## Security

- **Only the account owner can flag their own account** — the wallet must be connected and the on-chain metadata update is signed by the owner
- The `isTestAccount` flag is stored as a boolean in the profile's `customFields` object on IPFS
- The on-chain metadata digest (CIDv0 → bytes32) is updated via the NameRegistry contract

## Technical Flow

1. User connects wallet → reads current profile from Circles profile service (`getProfileByAddress`)
2. Current profile is merged with `{ isTestAccount: true/false }` in `customFields`
3. Updated profile is pinned to IPFS via `profilesClient.create()`
4. CID is converted to a bytes32 digest via `cidV0ToHex()`
5. `nameRegistry.updateMetadataDigest(newDigest)` transaction is built and sent via the miniapp postMessage bridge to the host wallet
6. Receipt is polled and confirmed on-chain
7. Profile is reloaded from the service to verify the updated state

## Development

```bash
npm install
npm run dev     # Start dev server at localhost:5173
npm run build   # Build for production
```

## Deployment

Deployed to Vercel: https://test-account-flag.vercel.app