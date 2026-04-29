# Demurrage Clock — Design

## Architecture
Single-page app with live countdown, SVG projection chart, and educational cards. Demurrage calculated client-side using Circles formula. No backend.

## File Structure
```
examples/demurrage-clock/
├── index.html
├── main.js             # App logic, SDK, demurrage calculations
├── chart.js            # SVG projection chart rendering
├── style.css
├── miniapp-sdk.js
├── package.json
├── vite.config.js
└── README.md
```

## Demurrage Formula
```javascript
// Circles demurrage: ~6.8% annual, applied per-block
// Simplified: balance * (1 - 0.068) ^ (days/365)
// Per-second rate: balance * (1 - 0.068) ^ (1/(365.25*24*3600))
const ANNUAL_DEMURRAGE = 0.068;
const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
const perSecondRate = 1 - Math.pow(1 - ANNUAL_DEMURRAGE, 1 / SECONDS_PER_YEAR);

// Real-time counter
function getCurrentBalance(initialBalance, secondsElapsed) {
  return initialBalance * Math.pow(1 - perSecondRate, secondsElapsed);
}
```

## Key SDK Calls
- `sdk.getAvatar(addr).balances.getTokenBalances()` → initial balance
- On-chain demurrage is already reflected in reported balance (no separate calculation needed for current balance)

## Visual Design
- Warm amber/orange palette (time/erosion theme)
- Large animated counter: monospace font, digits "melt" with CSS animation
- Circular progress ring showing % lost today
- SVG line chart: smooth decay curve over time periods
- "Time to zero" shown as hourglass icon with countdown
- Educational card: frosted glass with demurrage explanation