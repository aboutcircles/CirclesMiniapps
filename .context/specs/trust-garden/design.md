# Trust Garden — Design

## Architecture
Single-page Canvas app with garden scene. Trust contacts become procedurally-generated plants. On-chain data drives visual properties. Pure frontend, no backend.

## File Structure
```
examples/trust-garden/
├── index.html
├── main.js             # App logic, SDK, garden engine
├── garden.js           # Plant rendering, procedural generation
├── style.css
├── miniapp-sdk.js
├── package.json
├── vite.config.js
└── README.md
```

## Key SDK Calls
- `sdk.data.getTrustRelations(address)` → trusted contacts
- `sdk.rpc.profile.getProfileByAddress(addr)` → names
- `sdk.getAvatar(addr).balances.getTokenBalances()` → balance for plant size
- `circlesQuery('CrcV2', 'Transfer', ...)` → recent activity for butterflies/rain

## Deterministic Plant Species
```javascript
// Hash address → seed → species
import { keccak256, toBytes } from 'viem';
const seed = BigInt(keccak256(toBytes(address)));
const speciesIndex = Number(seed % 8n); // 8 species
// 0: Rose, 1: Sunflower, 2: Oak, 3: Fern, 4: Tulip, 5: Cactus, 6: Bamboo, 7: Lavender
```

## Visual Design
- Warm garden background (green gradient, sky blue top)
- Procedural plants: stem + leaves + flower/crown drawn via Canvas paths
- Ground: textured earth tones
- Sky: animated clouds, day/night based on... demurrage clock? (optional)
- Particle effects: butterflies (active senders), rain (receivers), sparkles (high balance)
- User's own plant: centre, larger, golden pot