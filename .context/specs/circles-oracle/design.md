# Circles Oracle — Design

## Architecture
Single-page app with animated oracle visual (Canvas) + question input + fortune display. Fortune engine uses deterministic hashing of on-chain data to generate mystical responses. localStorage for history.

## File Structure
```
examples/circles-oracle/
├── index.html
├── main.js             # App logic, SDK, fortune engine
├── oracle.js           # Crystal ball rendering, particle effects
├── fortunes.js         # Fortune templates + deterministic selection
├── style.css
├── miniapp-sdk.js
├── package.json
├── vite.config.js
└── README.md
```

## Fortune Engine (Deterministic)
```javascript
// No AI — pure deterministic from on-chain data
import { keccak256, toBytes } from 'viem';

function generateFortune(address, balance, trustCount, question, date) {
  const seed = keccak256(toBytes(`${address}-${date}-${question}`));
  const index = Number(BigInt(seed) % BigInt(fortunes.length));
  
  // Inject real on-chain facts into template
  return fortunes[index]
    .replace('{balance}', formatCRC(balance))
    .replace('{trusts}', trustCount)
    .replace('{name}', profileName);
}
```

## Fortune Templates (examples)
- "The spirits sense {trusts} trusted souls in your constellation. A new connection approaches."
- "Your vault holds {balance} CRC. The demurrage spirits nibble gently — spend freely."
- "The oracle sees {trusts} threads in your web. Strength comes from diversity."

## Visual Design
- Deep cosmic background (dark purple/navy gradient)
- Central crystal ball: animated with swirling particles inside
- Fortune text appears with typewriter effect
- Fortune card: ornate border with Circles logo watermark
- Mystical but fun — not taking itself too seriously