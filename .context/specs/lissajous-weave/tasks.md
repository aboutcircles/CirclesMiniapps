# Lissajous Weave — Tasks

## Phase 1: Scaffold
- [ ] Run `./scripts/new-miniapp.sh lissajous-weave "Lissajous Weave"`
- [ ] Install deps
- [ ] Add `lissajous.js` module

## Phase 2: Wallet + Data
- [ ] Implement `onWalletChange` handler
- [ ] Fetch trust relations
- [ ] Fetch balances per trusted contact
- [ ] Resolve contact names via profile lookup
- [ ] Cap curves at 10 (top by balance)

## Phase 3: Lissajous Engine
- [ ] Compute curve params from address pairs (freq ratio, amplitude, phase)
- [ ] Implement parametric curve renderer on Canvas
- [ ] Layer curves with transparency
- [ ] Slow phase rotation animation loop (requestAnimationFrame)

## Phase 4: Interaction
- [ ] Hit-testing: which curve is mouse near?
- [ ] Hover highlight: full opacity + glow + tooltip
- [ ] Pause/play toggle
- [ ] Download PNG (canvas.toDataURL)
- [ ] Download SVG (reconstruct paths from params)

## Phase 5: Polish + Deploy
- [ ] Handle empty trust graph
- [ ] Responsive canvas sizing
- [ ] Loading states, error handling
- [ ] Build, deploy, register, open PR