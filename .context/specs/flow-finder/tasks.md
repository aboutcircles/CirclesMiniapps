# Flow Finder — Tasks

## Phase 1: Scaffold
- [ ] Run `./scripts/new-miniapp.sh flow-finder "Flow Finder"`
- [ ] Install deps
- [ ] Verify scaffold loads

## Phase 2: Wallet + Input
- [ ] `onWalletChange` handler
- [ ] Destination address input field
- [ ] Profile search autocomplete
- [ ] Lazy SDK init

## Phase 3: Data Fetching
- [ ] Query transfers involving source address
- [ ] Query transfers involving destination address
- [ ] Build intersection graph (addresses that appear in both)
- [ ] Resolve profile names for all nodes

## Phase 4: Visualisation
- [ ] Canvas rendering with directed graph layout
- [ ] Animated particles along edges
- [ ] Edge thickness proportional to volume
- [ ] Node sizing and labelling

## Phase 5: Interaction
- [ ] Node click → profile card
- [ ] Edge click → transfer details
- [ ] Summary stats panel
- [ ] Zoom and pan

## Phase 6: Deploy
- [ ] Build, deploy, register, PR