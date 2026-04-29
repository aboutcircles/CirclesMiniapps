# Trust Constellation — Tasks

## Phase 1: Scaffold
- [ ] Run `./scripts/new-miniapp.sh trust-constellation "Trust Constellation"`
- [ ] Install deps: `cd examples/trust-constellation && npm install`
- [ ] Verify scaffold loads in browser

## Phase 2: Wallet + Data
- [ ] Implement `onWalletChange` handler
- [ ] Lazy SDK initialisation (`getSdk()`)
- [ ] Fetch trust relations on connect
- [ ] Fetch profile names for each trusted address
- [ ] Fetch token balances for brightness calculation

## Phase 3: Canvas Rendering
- [ ] Create full-viewport Canvas element
- [ ] Implement star renderer with glow effects
- [ ] Draw trust connections as animated lines
- [ ] Position nodes using force-directed layout (simple spring algorithm)
- [ ] Render user's own node as golden center star

## Phase 4: Interaction
- [ ] Implement Canvas zoom (wheel) and pan (drag)
- [ ] Hit-test for star clicks → show profile overlay card
- [ ] Search bar with profile lookup
- [ ] Overlay another address's constellation on search

## Phase 5: Polish
- [ ] Stats bar (trust count, connections)
- [ ] Loading animation while graph fetches
- [ ] Error states (no avatar, no trust relations, RPC failure)
- [ ] Mobile touch support (pinch zoom, tap)
- [ ] Responsive layout

## Phase 6: Deploy
- [ ] `npm run build` succeeds
- [ ] Deploy via `./scripts/deploy-miniapp.sh`
- [ ] Disable Vercel Deployment Protection
- [ ] Register in `static/miniapps.json`
- [ ] Open PR via `./scripts/open-pr.sh`