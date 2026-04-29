# Circles Backer MiniApp — Tasks

## Phase 1: Scaffold
- [x] Create directory structure (`examples/circles-backer/`)
- [x] Copy miniapp-sdk.js
- [x] Set up package.json with deps (viem, @aboutcircles/sdk, vite)
- [x] Basic index.html shell with 6-step views
- [x] vite.config.js with node polyfills

## Phase 2: Wallet Integration
- [x] Import onWalletChange from miniapp-sdk.js
- [x] Handle connect / disconnect states
- [x] Show address when connected
- [x] Lazy SDK initialisation (getSdk() pattern)

## Phase 3: Core Feature — Backing Flow
- [x] Contract constants and ABI definitions (backing.js)
- [x] Factory `computeAddress` call to detect existing backers
- [x] CRC balance check via Circles SDK with Hub V2 fallback
- [x] USDC.e balance check via ERC-20 contract read
- [x] Asset selection (WBTC, WETH, GNO, sDAI)
- [x] Transaction building: USDC approve + Hub safeTransferFrom
- [x] CowSwap appData registration before execution
- [x] Already-a-backer detection with dedicated view

## Phase 4: UI & UX
- [x] 6-step wizard: Connect → About → Eligibility → Select → Confirm → Success
- [x] Already-backer view with contract address display
- [x] USDC funding flow with progress bar (polls every 10s)
- [x] Asset selection grid with visual cards
- [x] Confirmation summary before execution
- [x] Toast notifications for errors/success
- [x] Passkey auto-connect error handling
- [x] Responsive layout

## Phase 5: Style
- [x] Gnosis design system (warm beige gradient, frosted glass cards)
- [x] Space Grotesk + JetBrains Mono fonts
- [x] Pill-shaped buttons with brand blue gradient
- [x] CSS custom properties for all design tokens

## Phase 6: Deploy
- [x] Build succeeds (`npm run build`)
- [x] Deployed to Vercel: `https://circles-miniapp-circles-backer.vercel.app`
- [x] Registered in `static/miniapps.json`
- [ ] Disable Vercel Deployment Protection (manual step)
- [ ] Push to remote and open PR (pending user approval)

## Known Issues / Follow-ups
- [ ] Vercel deployment protection must be disabled manually for iframe loading
- [ ] Chunk size warning (674KB) — could benefit from code splitting
- [ ] CRC replenish flow (unwrap wrapped CRC) not implemented — wallet has this but miniapp skips it
- [ ] No offline/error boundary for RPC failures during funding polling