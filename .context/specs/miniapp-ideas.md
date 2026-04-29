# MiniApp Ideas
_Generated: 2026-04-28_

## Selection Rationale

After brainstorming 15 creative, visual miniapp ideas for the Circles ecosystem, 10 have full specs. The top 5 (original batch) and the generative art batch (5 new) were selected based on feasibility (no backend needed, all on-chain data), visual impact, novelty, and SDK fit. The remaining 5 ideas are documented below as candidates for future builds.

**Batch 1 — Core Visual (specs created, ready to build):**
1. **Trust Constellation** (23/25) — Interactive starfield of your trust network
2. **Flow Finder** (22/25) — Animated transfer path visualisation
3. **Trust Garden** (21/25) — Procedural garden from on-chain data
4. **Circles Oracle** (22/25) — Mystical fortune-teller powered by on-chain facts
5. **Demurrage Clock** (22/25) — Live visualisation of CRC erosion

**Batch 2 — Generative Art & Sound (specs created, ready to build):**
6. **Flow Field Painting** (23/25) — Perlin noise flow field from trust graph
7. **Wallet Waveform** (22/25) — Audio waveform visualisation from transfers
8. **Lissajous Weave** (21/25) — Harmonic curves from address pairs
9. **Transfer Sequencer** (22/25) — Step sequencer turning transfers into music
10. **Fractal Trust Tree** (23/25) — Interactive fractal tree of trust network

---

## Trust Constellation
**Score**: 23/25
**Feasibility**: 5/5
**Novelty**: 5/5
**User value**: 5/5
**Complexity**: 3/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: Visualise your trust network as an interactive starfield on a dark Canvas. Each trusted contact is a star whose brightness reflects their CRC balance. Animated glowing lines connect trusted nodes. Click any star to see profile info. Search to overlay another address's constellation. Zoom, pan, explore your economic universe.
**Patterns used**: Trust graph reads (Pattern C), profile queries, balance queries, Canvas rendering, zoom/pan interaction
**Status**: Specs ready — `.context/specs/trust-constellation/`
**Branch**: `feature/trust-constellation`

---

## Flow Finder
**Score**: 22/25
**Feasibility**: 5/5
**Novelty**: 4/5
**User value**: 4/5
**Complexity**: 4/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: Visualise the transfer paths between any two addresses as an animated river of value. Enter a destination, query CirclesRPC for transfers, and watch particles flow along the graph edges showing direction and volume. Edge thickness = transfer amount, particle speed = frequency. Great for understanding how CRC moves through communities.
**Patterns used**: CirclesRPC queries (Pattern G), profile lookups, Canvas/SVG animated graph
**Status**: Specs ready — `.context/specs/flow-finder/`
**Branch**: `feature/flow-finder`

---

## Trust Garden
**Score**: 21/25
**Feasibility**: 4/5
**Novelty**: 5/5
**User value**: 4/5
**Complexity**: 3/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: Your trust network rendered as a living garden. Each trusted contact is a procedurally-generated plant — species determined by hashing their address (keccak256 → deterministic), height by CRC balance, placement by trust depth. Animated garden with swaying plants, butterflies for active senders. Download your garden as an image. Whimsical, emotional, unique.
**Patterns used**: Trust graph reads, balance queries, keccak256 hashing for deterministic art, Canvas procedural rendering
**Status**: Specs ready — `.context/specs/trust-garden/`
**Branch**: `feature/trust-garden`

---

## Circles Oracle
**Score**: 22/25
**Feasibility**: 5/5
**Novelty**: 5/5
**User value**: 4/5
**Complexity**: 5/5 (5 = simplest)
**SDK fit**: 3/5
**New contracts needed**: No
**Description**: A mystical fortune-teller miniapp. Ask a question, and the Oracle responds with a deterministic "fortune" derived from your on-chain data — trust count, balance, recent activity — via keccak256 hashing. No AI needed; the magic comes from real blockchain facts wrapped in mystical language. Daily fortune, shareable fortune cards, localStorage history. Pure entertainment that teaches users about their Circles data.
**Patterns used**: Balance queries, trust reads, keccak256 for deterministic fortune selection, localStorage for history
**Status**: Specs ready — `.context/specs/circles-oracle/`
**Branch**: `feature/circles-oracle`

---

## Demurrage Clock
**Score**: 22/25
**Feasibility**: 5/5
**Novelty**: 4/5
**User value**: 5/5
**Complexity**: 4/5 (5 = simplest)
**SDK fit**: 4/5
**New contracts needed**: No
**Description**: A beautiful live countdown showing your CRC balance melting away in real-time. Large animated counter ticks down every second. SVG projection chart shows decay over 1/7/30/365 days. "Time to zero" calculator. Educational card explains demurrage. Motivates spending and engagement. The most practical of the visual apps — genuinely useful while being visually stunning.
**Patterns used**: Balance queries, client-side demurrage calculation, SVG chart rendering, setInterval timer
**Status**: Specs ready — `.context/specs/demurrage-clock/`
**Branch**: `feature/demurrage-clock`

---

## Trust Heatmap
**Score**: 20/25
**Feasibility**: 5/5
**Novelty**: 4/5
**User value**: 4/5
**Complexity**: 4/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: A geographical-style heatmap of trust density across the Circles network. Fetch trust relations for multiple addresses and render a 2D density map where "hot" zones represent clusters of high trust activity. Zoom into areas to see individual trust connections. Useful for understanding community formation and trust concentration.
**Patterns used**: Trust graph reads, CirclesRPC queries, Canvas heatmap rendering
**Status**: Unbuilt

---

## CRC Sound Machine
**Score**: 19/25
**Feasibility**: 4/5
**Novelty**: 5/5
**User value**: 3/5
**Complexity**: 3/5 (5 = simplest)
**SDK fit**: 4/5
**New contracts needed**: No
**Description**: Turn your trust network into music. Each trusted contact becomes a musical layer — balance determines volume, trust depth determines pitch, recent transfers trigger beats. Uses the Web Audio API to create ambient soundscapes from on-chain data. Every wallet has a unique sound. Record and share 10-second audio clips.
**Patterns used**: Trust reads, balance queries, Web Audio API, deterministic sonification
**Status**: Unbuilt

---

## Trust Snowglobe
**Score**: 20/25
**Feasibility**: 5/5
**Novelty**: 5/5
**User value**: 4/5
**Complexity**: 4/5 (5 = simplest)
**SDK fit**: 4/5
**New contracts needed**: No
**Description**: Your trust network inside a snow globe. Shake it (drag/accelerometer) to see trusted contacts swirl around as snowflakes. Each snowflake carries a profile avatar. Settle time depends on trust depth — deeper connections "land" faster. Simple, delightful, shareable. Download a snapshot of your snowglobe.
**Patterns used**: Trust reads, profile avatar fetching, Canvas physics simulation, device accelerometer
**Status**: Unbuilt

---

## Balance Mandala
**Score**: 20/25
**Feasibility**: 5/5
**Novelty**: 4/5
**User value**: 4/5
**Complexity**: 4/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: Generate a unique geometric mandala from your wallet address and trust graph. Each trusted contact adds a layer of symmetry — more trusts = more complex pattern. Balance determines colour intensity. The mandala slowly rotates and pulses. Beautiful, meditative, and deeply personal. Every wallet produces a completely unique artwork.
**Patterns used**: keccak256 hashing, trust reads, Canvas geometric rendering, deterministic art generation
**Status**: Unbuilt

---

## CRC Fireplace
**Score**: 18/25
**Feasibility**: 5/5
**Novelty**: 4/5
**User value**: 3/5
**Complexity**: 5/5 (5 = simplest)
**SDK fit**: 3/5
**New contracts needed**: No
**Description**: A cosy animated fireplace where each flame log represents a trusted contact. Active contacts (recent transfers) burn brighter. Demurrage is visualised as embers fading. The more active your network, the warmer the fire. Simple, ambient, delightful. No complex interaction needed — just a living art piece from your Circles data.
**Patterns used**: Trust reads, recent transfer queries, Canvas particle fire simulation
**Status**: Unbuilt

---

## Flow Field Painting
**Score**: 23/25
**Feasibility**: 5/5
**Novelty**: 5/5
**User value**: 4/5
**Complexity**: 4/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: Generate a unique flow field painting from your trust graph and balance data. Perlin noise seeds from keccak256(walletAddress) create a deterministic noise field. Particles (500–1000) flow along the field with colours from the Gnosis palette mapped to trust connections. Every wallet produces a completely unique abstract artwork. Interactive controls for density, colour mode, and animation speed. Download as PNG.
**Patterns used**: Trust graph reads, balance queries, keccak256 hashing, Canvas 2D rendering, Perlin noise
**Status**: Specs ready — `.context/specs/flow-field-painting/`

---

## Wallet Waveform
**Score**: 22/25
**Feasibility**: 5/5
**Novelty**: 4/5
**User value**: 4/5
**Complexity**: 4/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: Visualise your CRC transfer history as an audio waveform oscilloscope. Each transfer becomes a pulse — amplitude from amount, frequency from keccak256(txHash), direction (sent/received) as positive/negative deflection. Animated scan line with Web Audio API sonification using pentatonic scale (always consonant). Every wallet has a unique visual and sonic signature. Download audio snapshot as WAV.
**Patterns used**: CirclesRPC queries, keccak256 hashing, Canvas rendering, Web Audio API
**Status**: Specs ready — `.context/specs/wallet-waveform/`

---

## Lissajous Weave
**Score**: 21/25
**Feasibility**: 5/5
**Novelty**: 5/5
**User value**: 4/5
**Complexity**: 3/5 (5 = simplest)
**SDK fit**: 4/5
**New contracts needed**: No
**Description**: Render your trust relationships as layered Lissajous curves. Each trusted address paired with yours generates a parametric curve with unique frequency ratios (from keccak256 of the pair). Balances set amplitude, trust depth sets phase offset. The result is a mesmerising, slowly-rotating harmonic pattern unique to each wallet. Hover a curve to see who it represents. Download as PNG or SVG.
**Patterns used**: Trust reads, balance queries, keccak256 hashing, Canvas parametric curves, mathematical art
**Status**: Specs ready — `.context/specs/lissajous-weave/`

---

## Transfer Sequencer
**Score**: 22/25
**Feasibility**: 5/5
**Novelty**: 5/5
**User value**: 4/5
**Complexity**: 3/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: A step sequencer that turns your last 64 CRC transfers into a looping musical pattern. Each transfer maps to a note — pitch from keccak256(txHash) on a pentatonic scale, duration from amount, stereo pan from direction (sent/received). 8×8 grid of lit cells with a sweeping playhead. BPM control, WAV download via OfflineAudioContext. Every wallet's transfer history becomes a unique melody.
**Patterns used**: CirclesRPC transfer queries, keccak256 hashing, Web Audio API, CSS Grid, OfflineAudioContext
**Status**: Specs ready — `.context/specs/transfer-sequencer/`

---

## Fractal Trust Tree
**Score**: 23/25
**Feasibility**: 4/5
**Novelty**: 5/5
**User value**: 5/5
**Complexity**: 4/5 (5 = simplest)
**SDK fit**: 5/5
**New contracts needed**: No
**Description**: Explore your trust network as an interactive fractal tree. Root = your wallet, branches = trusted contacts, sub-branches = their trusted contacts (recursive). Branch angle from keccak256(contactAddr), thickness from mutual trust, colour from trust type (mutual/one-way/group). Animated growth from root outward. Click nodes to expand deeper. Pan, zoom, download as PNG. An organic, living map of trust.
**Patterns used**: Recursive trust graph reads, profile queries, keccak256 hashing, Canvas rendering, pan/zoom interaction
**Status**: Specs ready — `.context/specs/fractal-trust-tree/`
