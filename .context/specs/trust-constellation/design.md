# Trust Constellation — Design

## Architecture
Single-page Canvas app. On wallet connect → fetch trust graph → render interactive starfield. HTML overlay for search, profile cards, and stats. All reads via Circles SDK, no writes.

## File Structure
```
examples/trust-constellation/
├── index.html          # Canvas + overlay UI
├── main.js             # App logic, SDK calls, Canvas rendering
├── style.css           # Gnosis design tokens
├── miniapp-sdk.js      # Host bridge (copy from examples/)
├── package.json
├── vite.config.js
└── README.md
```

## Key SDK Calls
- `sdk.data.getTrustRelations(address)` → trust edges
- `sdk.rpc.profile.getProfileByAddress(addr)` → names for each node
- `sdk.getAvatar(addr).balances.getTokenBalances()` → balances for brightness
- `sdk.rpc.profile.searchByAddressOrName(query, 10, 0)` → search

## State Machine
```
DISCONNECTED → CONNECTING → LOADING_GRAPH → RENDERING → INTERACTIVE
                                                  ↕
                                              SEARCHING (overlay mode)
```

## Data Model
```javascript
// Node = trusted contact
{ address, name, balance, trustDepth, x, y, radius, brightness }

// Edge = trust connection
{ from, to, animated }

// Graph state
{ nodes: Map<address, Node>, edges: Edge[], centerAddress, zoom, panX, panY }
```

## Visual Design
- Dark navy background (#05061a) — constellation feel
- Stars: white/blue circles with CSS glow effect, brightness = opacity + size
- Connections: thin blue lines (#4335df) with pulse animation
- User's own star: larger, golden glow
- Overlay cards: frosted glass (standard Gnosis card style)
- Search bar: top, translucent
- Stats: bottom bar showing trust count, total connections