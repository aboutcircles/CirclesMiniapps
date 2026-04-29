# Wallet Waveform — Tasks

## Phase 1: Scaffold
- [ ] Run `./scripts/new-miniapp.sh wallet-waveform "Wallet Waveform"`
- [ ] Install deps
- [ ] Add `audio-engine.js` and `oscilloscope.js` modules

## Phase 2: Wallet + Data
- [ ] Implement `onWalletChange` handler
- [ ] Fetch trust relations via `sdk.data.getTrustRelations()`
- [ ] Fetch balances per trusted contact
- [ ] Fetch last transfer timestamps per contact via CirclesRPC
- [ ] Cap at 24 contacts (sort by balance, take top 24)

## Phase 3: Audio Engine
- [ ] Create AudioContext with master GainNode
- [ ] Map each contact → OscillatorNode (freq from keccak256, gain from balance)
- [ ] Apply decay envelope from transfer recency
- [ ] Connect all through AnalyserNode for visualisation
- [ ] Connect to MediaStreamDestination for recording
- [ ] Handle browser autoplay policy (require user gesture)

## Phase 4: Oscilloscope
- [ ] Canvas element for waveform display
- [ ] Read AnalyserNode time-domain data each frame
- [ ] Render waveform in brand blue with glow effect
- [ ] Circular layout of oscillator nodes around scope
- [ ] Each node pulses at its frequency, shows contact name

## Phase 5: Interaction
- [ ] Click oscillator node to toggle mute/isolate
- [ ] Master volume slider
- [ ] "Record 5s" button using MediaRecorder API
- [ ] Download recorded audio as .webm

## Phase 6: Polish + Deploy
- [ ] Handle empty trust graph gracefully
- [ ] Loading states, error handling
- [ ] Responsive layout
- [ ] Build, deploy, register, open PR