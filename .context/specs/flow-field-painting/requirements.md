# Flow Field Painting — Requirements

## User Story
As a Circles user, I want my CRC transfer history rendered as a unique generative painting, so I can own and share a one-of-a-kind artwork mathematically derived from my economic activity.

## Functional Requirements
- FR1: On wallet connect, fetch CRC transfers (sent + received) via CirclesRPC
- FR2: Build a 2D flow field — each transfer defines a vector (direction from hash, magnitude from amount)
- FR3: Release 2000+ particles that follow the flow field, painting ink trails on Canvas
- FR4: Particle colour derived from keccak256(counterparty address) → HSL
- FR5: Particle opacity fades with transfer age (recent = vivid, old = ghostly)
- FR6: Painting evolves over ~30 seconds then stabilises
- FR7: Download as high-res PNG (canvas.toDataURL at 2x)
- FR8: "Regenerate" button replays with a new random seed
- FR9: Stats overlay: transfer count, unique counterparties, total volume
- FR10: Wallet address watermark in corner (semi-transparent)

## Non-Functional Requirements
- NFR1: Must load inside Gnosis wallet iframe
- NFR2: No backend — all generation client-side from on-chain data
- NFR3: Canvas rendering < 16ms/frame (requestAnimationFrame)
- NFR4: Responsive down to 320px
- NFR5: Pure Canvas 2D API — no WebGL dependency

## Out of Scope
- WebGL/Three.js rendering
- On-chain NFT minting (future possibility)
- Real-time transfer streaming

## Acceptance Criteria
- [ ] Wallet connection fetches transfers and starts painting
- [ ] Each wallet produces a visually distinct painting
- [ ] Animation completes in ~30 seconds
- [ ] Download as PNG works
- [ ] Regenerate produces a different composition