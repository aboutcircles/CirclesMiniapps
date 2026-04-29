# Flow Field Painting — Design

## Architecture
Single-page Canvas app. On connect: fetch transfers → build flow field → animate particles → stabilise.

## File Structure
```
examples/flow-field-painting/
├── index.html          # Canvas container + controls overlay
├── main.js             # Wallet connect, data fetch, orchestration
├── flow-field.js       # Flow field computation from transfers
├── particle.js         # Particle system + trail rendering
├── style.css           # Gnosis design tokens, layout
├── miniapp-sdk.js      # Wallet bridge
├── package.json
└── vite.config.js
```

## Key SDK Calls
- `sdk.circlesRpc.call('circles_query', ...)` — fetch transfers (CrcV2.Transfer)
- `onWalletChange()` — wallet connection
- `viem keccak256()` — deterministic colour hashing

## State Machine
1. **Disconnected** — "Connect wallet" prompt
2. **Loading** — Fetching transfers, building field
3. **Painting** — Particles active, animation running
4. **Complete** — Painting stabilised, download available
5. **Error** — No transfers found or fetch failed

## Data Model
```js
// Transfer data from CirclesRPC
{ from, to, value, timestamp }

// Flow field: 2D grid of angle vectors
field[col][row] = angle (radians)

// Particle
{ x, y, vx, vy, life, maxLife, hue, opacity, width }
```

## Rendering Pipeline
1. Clear canvas to dark background (#0a0a12)
2. For each particle: lookup flow angle at position → update velocity → draw line segment → decrease life
3. Use `globalCompositeOperation = 'lighter'` for additive glow
4. After all particles dead → painting complete

## Colour Palette
- Background: Deep navy/black (#0a0a12)
- Particle hues: Full spectrum from address hash (HSL 0-360)
- Opacity: 0.05–0.4 range for layered watercolour effect
- Line width: 0.5–2px for fine detail