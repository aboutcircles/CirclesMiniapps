# Fractal Trust Tree — Tasks

## Phase 1: Scaffold
- [ ] Run `./scripts/new-miniapp.sh fractal-trust-tree "Fractal Trust Tree"`
- [ ] Install deps
- [ ] Add `tree-layout.js` and `tree-renderer.js` modules

## Phase 2: Wallet + Data
- [ ] Implement `onWalletChange` handler
- [ ] Fetch trust relations (2 hops deep, recursive)
- [ ] Resolve profile names for each node
- [ ] Determine mutual vs one-way trust per edge
- [ ] Cache fetched nodes to avoid re-fetching on expand

## Phase 3: Tree Layout
- [ ] Implement fractal layout: root at bottom, branches upward
- [ ] Angle from keccak256(contactAddr), length from depth
- [ ] Bezier curves for organic branch shapes
- [ ] Collision avoidance (spread overlapping branches)
- [ ] Cap at 200 visible nodes

## Phase 4: Tree Renderer
- [ ] Canvas rendering with transform (pan/zoom)
- [ ] Animated growth: branches extend with easing
- [ ] Node circles with profile images (or coloured dots)
- [ ] Colour coding: mutual/one-way/group
- [ ] Hit-testing for mouse interaction

## Phase 5: Interaction
- [ ] Pan: mouse drag + touch drag
- [ ] Zoom: mouse wheel + pinch
- [ ] Hover: tooltip with name, address, trust type
- [ ] Click: lazy-load sub-tree + animate growth
- [ ] Download PNG

## Phase 6: Polish + Deploy
- [ ] Handle no trust relations
- [ ] Loading progress indicator
- [ ] Responsive canvas
- [ ] Build, deploy, register, open PR