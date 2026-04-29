# Transfer Sequencer — Requirements

## User Story
As a Circles user, I want to hear and watch my transfer history as an evolving musical loop, so I can experience the rhythm and patterns of my economic activity as a shareable audiovisual composition.

## Functional Requirements
- FR1: On connect, fetch last 64 CRC transfers via CirclesRPC
- FR2: Map each transfer to a musical note — keccak256(txHash) → pitch (pentatonic scale, always consonant)
- FR3: Transfer amount → note duration (small = staccato, large = sustained)
- FR4: Direction (sent/received) → stereo panning (left/right)
- FR5: Time gap between transfers → rest duration between notes
- FR6: Play sequence as looping melody via Web Audio API
- FR7: Step sequencer UI — grid of 64 steps, lit cells show active notes
- FR8: Real-time playhead sweeps across the grid
- FR9: Click a step to preview its transfer details (address, amount, date)
- FR10: Download audio loop as .wav via OfflineAudioContext
- FR11: BPM control (60–180, default 120)

## Non-Functional Requirements
- NFR1: Web Audio API only — no external audio libs
- NFR2: Pentatonic scale ensures always-pleasant sound
- NFR3: No backend — all client-side
- NFR4: Audio starts only after user gesture

## Out of Scope
- On-chain audio storage
- Multi-user jamming
- MIDI export

## Acceptance Criteria
- [ ] Transfers render as a recognisable melody
- [ ] Sequencer grid visualises the pattern
- [ ] Loop plays seamlessly
- [ ] WAV download works