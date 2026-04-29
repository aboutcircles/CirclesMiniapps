# Transfer Sequencer — Design

## Architecture
Step sequencer UI + Web Audio synthesiser. Transfers → note sequence → looping playback with grid visualisation.

## File Structure
```
examples/transfer-sequencer/
├── index.html          # Sequencer grid + controls
├── main.js             # Wallet connect, data fetch, orchestration
├── sequencer.js        # Step sequencer logic, playback scheduling
├── audio-engine.js     # Web Audio: oscillators, envelopes, recorder
├── style.css           # Gnosis design tokens, grid layout
├── miniapp-sdk.js
├── package.json
└── vite.config.js
```

## Key SDK Calls
- `circlesQuery('CrcV2', 'Transfer', ...)` — last 64 transfers
- `onWalletChange()` — wallet connection
- `viem keccak256()` — deterministic pitch mapping

## Audio Design
```
Pentatonic scale (C major pentatonic): C D E G A
Mapped across 3 octaves (C3–C6) = 15 notes
keccak256(txHash) % 15 → note index
Amount → duration: 0.05s (tiny) to 0.4s (large)
Direction → StereoPanner: sent = -0.7, received = +0.7
```

## Sequencer Grid
- 8 rows × 8 columns = 64 steps
- Each step = one transfer (chronological)
- Active cell colour: HSL from counterparty address
- Playhead: bright column indicator sweeping left→right
- Empty cells = time gaps between transfers

## State Machine
1. **Disconnected** — "Connect wallet"
2. **Loading** — Fetching transfers
3. **Ready** — Sequence computed, "Play" button
4. **Playing** — Loop active, playhead moving
5. **Paused** — Playback stopped at current step
6. **Recording** — OfflineAudioContext rendering WAV
7. **Error** — No transfers found

## Visual Design
- Dark background with frosted card for grid
- Grid cells: rounded squares with glow when active
- Playhead: brand blue column highlight
- Controls below: Play/Pause, BPM slider, Download WAV
- Transfer detail tooltip on cell click