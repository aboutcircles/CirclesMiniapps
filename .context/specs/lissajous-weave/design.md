# Lissajous Weave — Design

## Architecture
Canvas-based Lissajous curve renderer. Each trust relation → one parametric curve with unique harmonics.

## File Structure
```
examples/lissajous-weave/
├── index.html          # Canvas + controls overlay
├── main.js             # Wallet connect, data fetch, orchestration
├── lissajous.js        # Curve computation and rendering
├── style.css           # Gnosis design tokens
├── miniapp-sdk.js
├── package.json
└── vite.config.js
```

## Key SDK Calls
- `sdk.data.getTrustRelations(address)` — trusted contacts
- `sdk.getAvatar(address).balances.getTokenBalances()` — balances
- `sdk.rpc.profile.getProfileByAddress()` — contact names
- `viem keccak256()` — deterministic curve parameters

## Lissajous Mathematics
```
x(t) = Ax * sin(a*t + δ)
y(t) = Ay * sin(b*t)

Where:
  a, b = frequency ratio from keccak256(userAddr + contactAddr) → integers 1-7
  Ax, Ay = amplitude from balance (scaled)
  δ = phase from trust depth/mutuality
```

## State Machine
1. **Disconnected** — "Connect wallet" prompt
2. **Loading** — Fetching trust + balances
3. **Animating** — Curves rendering and slowly rotating
4. **Paused** — Animation frozen, interaction still works
5. **Error** — No trust relations found

## Visual Design
- Dark background (deep navy)
- Curves drawn with 0.3–0.6 alpha, creating overlap beauty
- Line width 1–3px based on balance
- Slowly rotating phase creates living, breathing motion
- Hovered curve: full opacity, glow effect, tooltip with name + params
- Central label: "X relationships, Y trusted"