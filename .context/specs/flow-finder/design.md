# Flow Finder — Design

## Architecture
Single-page Canvas app. Source = connected wallet. User inputs destination. Query transfer history, build directed graph, render with animated particle flow.

## File Structure
```
examples/flow-finder/
├── index.html
├── main.js
├── style.css
├── miniapp-sdk.js
├── package.json
├── vite.config.js
└── README.md
```

## Key SDK Calls
- `circlesQuery('CrcV2', 'Transfer', ...)` — transfer history
- `sdk.rpc.profile.getProfileByAddress(addr)` — resolve names
- `sdk.rpc.profile.searchByAddressOrName(query, 5, 0)` — search for destination

## State Machine
```
DISCONNECTED → CONNECTED → DESTINATION_ENTERED → LOADING_PATHS → RENDERING_PATHS → INTERACTIVE
```

## Data Model
```javascript
// Transfer edge
{ from, to, value, count, timestamps[] }

// Path node
{ address, name, totalSent, totalReceived, x, y }

// Flow state
{ source, destination, nodes: Map, edges: [], particles: [] }
```

## Visual Design
- Dark background with flowing river metaphor
- Nodes as circular tokens with profile initials
- Edges as curved paths with animated dots (particles)
- Edge thickness = volume, colour = direction (blue outbound, green inbound)
- Summary card: glassmorphic overlay with stats