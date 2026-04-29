# Wallet Waveform — Design

## Architecture
Web Audio API synthesiser + Canvas oscilloscope. On connect: fetch trust + balances → create oscillators → visualise waveform.

## File Structure
```
examples/wallet-waveform/
├── index.html          # Oscilloscope canvas + oscillator node ring
├── main.js             # Wallet connect, orchestration
├── audio-engine.js     # Web Audio API: oscillators, mixer, recorder
├── oscilloscope.js     # Canvas waveform rendering
├── style.css           # Gnosis design tokens, dark theme
├── miniapp-sdk.js
├── package.json
└── vite.config.js
```

## Key SDK Calls
- `sdk.data.getTrustRelations(address)` — trusted contacts
- `sdk.getAvatar(address).balances.getTokenBalances()` — per-contact balances
- `circlesQuery('CrcV2', 'Transfer', ...)` — last transfer timestamps
- `viem keccak256()` — deterministic frequency mapping

## Audio Engine Design
```
AudioContext
├── GainNode (master volume)
│   ├── OscillatorNode (contact 1: freq=440Hz, gain=0.3)
│   ├── OscillatorNode (contact 2: freq=220Hz, gain=0.5)
│   ├── ...up to 24 oscillators
│   └── OscillatorNode (contact N)
├── AnalyserNode → Canvas oscilloscope
└── MediaStreamDestination → MediaRecorder (for recording)
```

## Frequency Mapping
```js
// keccak256(address) → first 4 bytes → map to musical range
const hash = keccak256(toHex(address));
const freq = 110 * Math.pow(2, (hashToVal(hash) % 24) / 12); // 110–880Hz
```

## State Machine
1. **Disconnected** — "Connect wallet" prompt
2. **Loading** — Fetching trust + balances
3. **Ready** — Data loaded, "Play" button visible (awaiting user gesture)
4. **Playing** — Audio active, oscilloscope running
5. **Recording** — 5s capture in progress
6. **Error** — No trust relations or audio API unavailable

## Visual Design
- Dark background matching Gnosis palette
- Circular ring of oscillator nodes around central oscilloscope
- Each node pulses at its frequency, sized by amplitude
- Colour from address hash (HSL)
- Central oscilloscope shows combined waveform in brand blue