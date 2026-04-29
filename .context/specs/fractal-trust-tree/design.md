# Fractal Trust Tree — Design

## Architecture
Interactive Canvas tree visualisation. Recursive trust fetch → tree layout algorithm → animated growth rendering.

## File Structure
```
examples/fractal-trust-tree/
├── index.html          # Canvas + controls overlay
├── main.js             # Wallet connect, data orchestration
├── tree-layout.js      # Fractal tree layout algorithm
├── tree-renderer.js    # Canvas rendering, animation, interaction
├── style.css           # Gnosis design tokens
├── miniapp-sdk.js
├── package.json
└── vite.config.js
```

## Key SDK Calls
- `sdk.data.getTrustRelations(address)` — recursive per-node
- `sdk.rpc.profile.getProfileByAddress()` — names for nodes
- `sdk.getAvatar(address)` — check mutual trust
- `circlesQuery('CrcV2', ...)` — trust depth metrics

## Tree Layout Algorithm
```
Root = user address (bottom centre)
For each trusted contact:
  angle = keccak256(contactAddr)[0:2] / 256 * spreadAngle
  length = baseLength * (0.7 ^ depth)
  Recurse for contact's trusted contacts (up to depth 3)
  
Spread angle: -60° to +60° from parent branch direction
Depth 0 → 2 auto-loaded, depth 3+ on click
```

## State Machine
1. **Disconnected** — "Connect wallet"
2. **Loading** — Fetching trust graph (recursive)
3. **Growing** — Animated tree growth from root
4. **Interactive** — Fully grown, pan/zoom/click/hover
5. **Expanding** — Loading sub-tree for clicked node
6. **Error** — No trust relations

## Interaction Model
- **Pan**: Mouse drag / touch drag
- **Zoom**: Mouse wheel / pinch
- **Hover node**: Tooltip with name, address, trust type
- **Click node**: Expand sub-tree (lazy fetch + animate growth)
- **Double-click**: Center on that node

## Visual Design
- Background: warm beige gradient (Gnosis palette)
- Branches: curved bezier paths, thickness 1–8px by depth
- Nodes: circles with profile image or coloured dot
- Colours: mutual=#145324, one-way=#8a482c, group=#0e00a8
- Growth animation: branches extend over 2 seconds with easing
- Leaf glow: subtle radial gradient around leaf nodes