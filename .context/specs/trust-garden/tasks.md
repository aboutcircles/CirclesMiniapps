# Trust Garden — Tasks

## Phase 1: Scaffold
- [ ] Run `./scripts/new-miniapp.sh trust-garden "Trust Garden"`
- [ ] Install deps
- [ ] Verify scaffold loads

## Phase 2: Procedural Plant Engine
- [ ] Implement address → hash → species mapping (keccak256)
- [ ] Draw 8 plant species via Canvas paths (rose, sunflower, oak, fern, tulip, cactus, bamboo, lavender)
- [ ] Scale plants by balance (growth stage)
- [ ] Gentle sway animation loop

## Phase 3: Wallet + Data
- [ ] `onWalletChange` handler
- [ ] Lazy SDK init
- [ ] Fetch trust relations
- [ ] Fetch balances for each contact
- [ ] Resolve profile names

## Phase 4: Garden Scene
- [ ] Garden background (sky gradient, ground, clouds)
- [ ] Position plants by trust depth (near/far from centre)
- [ ] User's plant as centrepiece
- [ ] Particle effects (butterflies, sparkles)
- [ ] Profile card on plant click

## Phase 5: Polish
- [ ] Garden stats panel
- [ ] Download garden as PNG (canvas.toDataURL)
- [ ] Loading state
- [ ] Error handling
- [ ] Mobile responsive

## Phase 6: Deploy
- [ ] Build, deploy, register, PR