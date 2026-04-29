# Transfer Sequencer — Tasks

## Phase 1: Scaffold
- [ ] Run `./scripts/new-miniapp.sh transfer-sequencer "Transfer Sequencer"`
- [ ] Install deps
- [ ] Add `sequencer.js` and `audio-engine.js` modules

## Phase 2: Wallet + Data
- [ ] Implement `onWalletChange` handler
- [ ] Fetch last 64 transfers via CirclesRPC (sent + received, chronological)
- [ ] Map transfers to note params (pitch, duration, pan)
- [ ] Handle < 64 transfers (pad with silence)

## Phase 3: Audio Engine
- [ ] Create AudioContext
- [ ] Pentatonic scale lookup table (C3–C6, 15 notes)
- [ ] Note scheduler: schedule notes ahead using Web Audio timing
- [ ] ADSR envelope per note (short attack, decay to sustain level)
- [ ] StereoPanner for direction
- [ ] Loop: restart sequence after last note

## Phase 4: Sequencer Grid
- [ ] 8×8 CSS grid of rounded cells
- [ ] Colour cells from counterparty address hash
- [ ] Playhead animation synced to audio timing
- [ ] Click cell → tooltip with transfer details

## Phase 5: Controls
- [ ] Play/Pause toggle
- [ ] BPM slider (60–180)
- [ ] Download WAV via OfflineAudioContext
- [ ] Volume control

## Phase 6: Polish + Deploy
- [ ] Handle no transfers state
- [ ] Responsive grid sizing
- [ ] Loading states, error handling
- [ ] Build, deploy, register, open PR