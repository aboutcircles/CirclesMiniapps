# NFT Gallery — Circles MiniApp

A read-only NFT gallery that displays all ERC-721 tokens held by the connected Circles wallet. Runs inside the Gnosis wallet iframe as a MiniApp.

## Features

- **Gallery view** — Grid of all ERC-721 NFTs with images and metadata
- **Hide spam** — Hide unwanted NFTs, persisted in localStorage
- **Hidden tab** — View and unhide previously hidden NFTs
- **Gnosis highlight** — Special badge for Gnosis-related NFTs (pinned to top)
- **Detail modal** — Full image, metadata, contract address, Blockscout link
- **Connected wallet only** — Shows NFTs for the authenticated Circles wallet

## Data source

Uses the [Safe Transaction Service API](https://safe-transaction-gnosis.safe.global/) to fetch ERC-721 collectibles. No custom indexer or backend required.

## Development

```bash
cd examples/nft-viewer
npm install
npm run dev
```

The app runs standalone — no contracts, no API server, no environment variables needed for basic dev.

### Animations

All motion is owned by `src/animations.js` (GSAP core, no premium plugins). Honors `prefers-reduced-motion: reduce` by snapping to the final frame. Add `?demo` (or `?animate`) to the URL to bypass reduced motion and see the full timing — useful for verifying the system is alive.

Console helpers (dev only):
- `__replayEntrance()` — re-runs the page-load animation.
- `__gsap` / `__animator` — direct handles to GSAP and the animator instance.

### Dev mode with local wallet

Create a `.env` file:

```
VITE_DEV_WALLET_PK=0x_your_private_key
```

This activates a viem-based local wallet instead of the miniapp-sdk bridge.

## Build

```bash
npm run build
```

Output goes to `dist/`. Deploy to any static host (Netlify or Vercel).

## Deploy to Netlify (same project)

This app ships with a `netlify.toml` so the existing Netlify project can host
it without any extra config.

**Option A — Git integration (recommended):**
1. In the Netlify dashboard, open the existing site.
2. **Site settings → Build & deploy → Continuous deployment**:
   - Base directory: `examples/nft-viewer`
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Production branch: `feature/nft-viewer-miniapp` (or whichever branch you want deployed)
3. Push to that branch → Netlify builds and deploys automatically.

**Option B — CLI (one-off deploys):**
```bash
cd examples/nft-viewer
npm run deploy        # production deploy to the linked site
# or
npm run deploy:draft  # draft URL for preview
```

You'll need to be logged in first: `npx netlify login` and `npx netlify link`
to associate the directory with the existing site (one-time setup).

## Deploy to Vercel (alternative)

```bash
# From repo root
vercel --prod examples/nft-viewer
# Then disable Deployment Protection in Vercel dashboard
```

## Stack

- Vite (build)
- `@aboutcircles/miniapp-sdk` (wallet bridge)
- `viem` (address utilities)
- Safe Transaction Service API (NFT data)
- No backend, no contracts, no API keys