# Wallet Waveform — Requirements

## User Story
As a Circles user, I want to hear what my trust network sounds like, so I can experience my economic relationships as a unique ambient soundscape with real-time visualisation.

## Functional Requirements
- FR1: On connect, fetch trust relations and balances for each trusted contact
- FR2: Each trusted address becomes a sine wave oscillator — keccak256(addr) → frequency (110–880Hz)
- FR3: Balance of each contact → amplitude of their oscillator
- FR4: Time since last transfer → decay envelope (recent = loud, old = quiet)
- FR5: Mix all oscillators into a single ambient drone via Web Audio API
- FR6: Real-time oscilloscope visualisation (Canvas waveform display)
- FR7: Click any oscillator node to isolate/mute it
- FR8: Volume master control
- FR9: "Record 5s" button captures audio loop via MediaRecorder API
- FR10: Visual: circular layout of oscillator nodes, pulsing with their frequency

## Non-Functional Requirements
- NFR1: Web Audio API — no external audio libraries
- NFR2: Must auto-start audio only after user gesture (browser policy)
- NFR3: Max 24 oscillators (cap trust relations to prevent audio overload)
- NFR4: No backend — all computation client-side

## Out of Scope
- MIDI export
- External speakers/streaming
- Saving recordings on-chain

## Acceptance Criteria
- [ ] Each wallet produces a distinct ambient sound
- [ ] Oscilloscope visualises the combined waveform
- [ ] Individual oscillators can be muted/isolated
- [ ] 5-second recording works