# Lissajous Weave — Requirements

## User Story
As a Circles user, I want to see my trust relationships rendered as beautiful Lissajous curves, so I can experience my economic network as mesmerising harmonic art that is mathematically unique to my wallet.

## Functional Requirements
- FR1: On connect, fetch trust relations and balances
- FR2: Each trusted address paired with user address generates a Lissajous curve
- FR3: Curve parameters: keccak256(pair) → frequency ratio (a/b), balances → amplitude, trust depth → phase offset
- FR4: Render 5–10 layered curves with semi-transparent strokes on Canvas
- FR5: Slow rotation animation — curves drift continuously
- FR6: Colour per curve from address hash → HSL (distinct hue per relationship)
- FR7: Interactive: hover a curve to highlight it and show contact name
- FR8: Pause/play animation toggle
- FR9: Download as PNG and SVG
- FR10: Parameter display: show frequency ratio, amplitude, phase for selected curve

## Non-Functional Requirements
- NFR1: Pure Canvas 2D — no WebGL
- NFR2: Smooth 60fps animation
- NFR3: No backend needed
- NFR4: Responsive down to 320px

## Out of Scope
- WebGL rendering
- Audio output (future: sonify the curves)
- On-chain storage

## Acceptance Criteria
- [ ] Each wallet produces distinct Lissajous patterns
- [ ] Animation is smooth and continuous
- [ ] Hovering a curve shows contact info
- [ ] Download works (PNG + SVG)