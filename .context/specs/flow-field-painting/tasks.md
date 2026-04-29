# Flow Field Painting — Tasks

## Phase 1: Scaffold & Shared Infrastructure
- [x] Create `examples/miniapp-sdk.js` — shared postMessage bridge (`onWalletChange`, `sendTransactions`, `signMessage`, `isMiniappMode`)
- [x] Create `examples/flow-field-painting/` directory structure
- [x] Create `package.json` with Vite build setup
- [x] Create `vite.config.js` with standalone root config (avoids parent tsconfig resolution)
- [x] Create `vercel.json` for deployment
- [x] Create `.gitignore`
- [x] Install deps: `npm install`

## Phase 2: Wallet Integration
- [x] Implement `onWalletChange` handler via miniapp-sdk.js bridge
- [x] Manual address input fallback for standalone mode (not in iframe)
- [x] Address validation (0x + 40 hex chars)
- [x] Truncated address display with wallet status badge
- [x] Auto-generate artwork on wallet connect

## Phase 3: Flow Field Engine
- [x] Implement simplex noise algorithm (Stefan Gustavson-based, in-file)
- [x] Deterministic seed from wallet address via hash function
- [x] Dual noise layers (primary + secondary with XOR seed offset) for organic variation
- [x] Seeded PRNG (mulberry32) for deterministic particle placement
- [x] Flow angle computed from noise field at each particle position

## Phase 4: Particle System & Rendering
- [x] Configurable particle count (default 2000, slider-controlled)
- [x] Each particle traces path through vector field (up to 200 steps)
- [x] Deterministic colour selection from palette per particle
- [x] Variable opacity per particle (0.15–0.50 range)
- [x] Configurable line width via slider
- [x] Configurable noise scale via slider
- [x] Batch rendering with progress bar
- [x] Canvas renders at device pixel ratio (up to 2×) for crisp output
- [x] **Bug fix**: Canvas 0×0 dimensions when parent hidden — show artwork screen before rendering
- [x] **Bug fix**: `handleGenerate` ReferenceError in ES module IIFE scope — use `window.handleGenerate()`

## Phase 5: UI & Controls
- [x] Gnosis design system styling (warm beige, navy, brand blue #0e00a8)
- [x] Space Grotesk + JetBrains Mono fonts
- [x] Three-screen flow: Connect → Rendering → Artwork
- [x] Art stats panel: seed hash, particle count, max steps
- [x] 6 colour palettes: Ember, Ocean, Aurora, Midnight, Earth, Neon
- [x] Palette selector buttons with conic-gradient previews
- [x] Particle count slider (500–5000)
- [x] Line width slider (0.3–3.0)
- [x] Noise scale slider (0.001–0.010)
- [x] "Regenerate" button (re-renders with current params)
- [x] "Download PNG" button (saves as flowfield-{address}.png)
- [x] "Stamp on Chain" button (SHA-256 hash + signMessage for proof of creation)
- [x] Address watermark on canvas (semi-transparent, bottom-right)

## Phase 6: Registration & Build
- [x] Register in `static/miniapps.json` with slug `flow-field-painting`
- [x] Production build succeeds (`npm run build` → dist/)
- [x] Dev server tested at http://localhost:5182/

## Known Issues
- [ ] TypeScript type-checking warnings on `.js` file (cosmetic only, no runtime impact)
- [ ] "Stamp on Chain" requires miniapp host iframe for `signMessage` — no standalone fallback
- [ ] No actual on-chain transaction — signed message only (by design)

## Future Enhancements
- [ ] Trust relation count → particle density
- [ ] Balance amount → colour saturation
- [ ] High-res export (4K canvas)
- [ ] Shareable URL with address param
- [ ] Animation mode (live particle tracing)