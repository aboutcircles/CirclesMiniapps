/**
 * Circling Soundscapes
 *
 * A living drone soundscape generated from CRC contributions.
 * Each transfer to the soundscape address creates a persistent oscillator voice.
 *
 * Sound parameters are deterministic functions of transaction data:
 *
 *   TX HASH byte 30 → ARCHETYPE (what kind of sound this voice makes):
 *     0–63   drone    sustained additive pad, slowly breathing
 *     64–127 pulse    rhythmic amplitude gate — slow on/off heartbeat
 *     128–191 drop    pitched percussive hit repeating at slow intervals
 *     192–255 shimmer high-register bell/glass attack-decay cycle
 *
 *   TX HASH (dominant — unknowable until the tx is confirmed on-chain):
 *   - Pitch base:        bytes 0-3   → note index in pentatonic scale
 *   - Octave register:   byte 4      → selects low / mid / high band
 *   - Pan:               bytes 5-6   → stereo position -0.45 to +0.45
 *   - Harmonic weights:  bytes 7-17  → 6 partial amplitudes (additive timbre)
 *   - Detune spread:     bytes 18-19 → subtle detuning of upper partials
 *   - Filter character:  bytes 20-21 → lowpass cutoff for warmth
 *   - Vibrato rate:      byte 22     → 0.03–0.4 Hz pitch wobble speed
 *   - Vibrato depth:     byte 23     → 0–0.005 semitone-level wobble depth
 *   - Amp LFO rate:      bytes 24-25 → 0.01–0.12 Hz breathing speed (drone)
 *   - Amp LFO depth:     byte 26     → 10–35% amplitude modulation (drone)
 *   - LFO shape:         byte 27     → sine / triangle crossfade (drone)
 *   - Second osc detune: byte 28     → 0–8 cents detuned unison layer
 *   - Second osc mix:    byte 29     → 0–40% blend of detuned layer
 *   - Archetype:         byte 30     → selects voice archetype (see above)
 *   - Beat period:       bytes 31-32 → 0.5–4 s between pulses (pulse/drop)
 *   - Pulse duty:        byte 33     → 10–80% on-time ratio (pulse)
 *   - Drop decay:        byte 34     → 0.3–2.5 s decay time (drop)
 *   - Drop interval:     bytes 35-36 → 1–8 s between hits (drop)
 *   - Shimmer attack:    byte 37     → 20–400 ms attack (shimmer)
 *   - Shimmer sustain:   bytes 38-39 → 0.5–3 s sustain (shimmer)
 *
 *   FROM ADDRESS (subtle colouring only — same sender stays recognisable
 *                 but each tx still sounds distinct):
 *   - Pitch nudge:  bytes 0-1 → ±2 scale steps offset on top of txHash pitch
 *   - Pan nudge:    bytes 2-3 → ±0.1 stereo nudge on top of txHash pan
 *
 *   CRC VALUE + TIMESTAMP:
 *   - Amplitude:   log-proportional to CRC, decayed at 7% p.a. (demurrage)
 */

import { onWalletChange, sendTransactions, isMiniappMode } from './miniapp-sdk.js';
import { Sdk } from '@aboutcircles/sdk';
import { TransferBuilder } from '@aboutcircles/sdk-transfers';
import { getAddress } from 'viem';

// ── Constants ──────────────────────────────────────────────────────────────

const SOUNDSCAPE_ADDRESS = '0xC69A3Ac0bF61BCAd06752908F3330CA41c6fA1FD';
const RPC_URL = 'https://rpc.aboutcircles.com/';

const MAX_VOICES = 200;
const MIN_CRC = 1;
const DEMURRAGE_RATE = 0.07; // 7% per annum

// Circles Hub V2
const HUB_V2_ADDRESS = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';
const LIFT_ERC20_ADDRESS = '0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5';

// Pentatonic + natural overtone pitches (Hz), anchored at 432 Hz
// Built from: A pentatonic (A, C, D, E, G) across 3 octaves + select overtones
const PITCH_TABLE = [
  216.0, 256.87, 288.0, 324.0, 384.0,   // octave 0
  432.0, 513.74, 576.0, 648.0, 768.0,   // octave 1
  864.0, 1027.5, 1152.0, 1296.0, 1536.0, // octave 2
  // overtone series on A2
  288.0, 360.0, 432.0, 504.0, 576.0, 648.0, 720.0,
];

const NOTE_NAMES = [
  'A2', 'C3', 'D3', 'E3', 'G3',
  'A3', 'C4', 'D4', 'E4', 'G4',
  'A4', 'C5', 'D5', 'E5', 'G5',
  'D3', 'F#3', 'A3', 'B3', 'C4', 'D4', 'E4',
];

// Harmonic partial ratios relative to root (just intonation + mild inharmonicity)
// These are the intervals summed to build each voice's timbre
const PARTIAL_RATIOS = [1, 2, 3, 4, 5, 6];

// Profile cache: address (lowercase) → { name, imageUrl }
const profileCache = new Map();

// ── State ──────────────────────────────────────────────────────────────────

let connectedAddress = null;
let audioCtx = null;
let masterGain = null;
let analyser = null;
let isPlaying = false;
let voices = []; // active AudioNode groups
let transfers = []; // parsed transfer objects
let maxContributed = 0; // max CRC in atto across all transfers (for log-normalisation)
let userMaxFlow = 0n; // max CRC user can send (bigint, atto)
let animFrameId = null;
let profileFetchQueue = new Set(); // addresses awaiting profile fetch
let lastSeenBlock = null; // highest blockNumber seen across all loaded transfers

// ── Solo state ─────────────────────────────────────────────────────────────
let soloTxHash = null;        // txHash of currently soloed voice, or null
let soloVoice = null;         // the live Voice object for the solo preview
let soloTransfer = null;      // the transfer object being soloed

// ── SDK (lazy) ─────────────────────────────────────────────────────────────

let _sdk = null;
function getSdk() {
  if (!_sdk) _sdk = new Sdk(RPC_URL, null);
  return _sdk;
}

// ── DOM helpers ────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function showToast(message, type = 'info', ms = 4000) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function setLoading(text) {
  const el = $('loading-state');
  const textEl = $('loading-text');
  if (text) {
    el.classList.remove('hidden');
    textEl.textContent = text;
  } else {
    el.classList.add('hidden');
  }
}

function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

function isPasskeyAutoConnectError(err) {
  const msg = decodeError(err).toLowerCase();
  return (
    msg.includes('passkey') ||
    msg.includes('auto connect') ||
    (msg.includes('wallet address') && msg.includes('retrieve'))
  );
}

// ── Hex helpers ────────────────────────────────────────────────────────────

/**
 * Read N bytes from a hex string (without 0x) starting at byte offset.
 * Returns a number.
 */
function hexBytes(hex, byteOffset, byteCount) {
  const start = byteOffset * 2;
  const slice = hex.slice(start, start + byteCount * 2).padStart(byteCount * 2, '0');
  return parseInt(slice, 16) || 0;
}

function stripHex(h) {
  return (h || '').replace(/^0x/i, '').toLowerCase();
}

// ── Sound parameter derivation ─────────────────────────────────────────────

/**
 * Deterministically derive all acoustic parameters from a transfer event.
 *
 * Address → pitch + pan only (what the sender "brings").
 * txHash  → all timbral, textural, and modulation parameters
 *           (determined by the network, unknowable until confirmed).
 *
 * @param {object} t  - transfer object
 * @returns {object}  - all acoustic parameters
 */
function deriveParams(t) {
  const fromHex = stripHex(t.from);
  const txHex   = stripHex(t.transactionHash);

  // ── TX HASH (dominant — changes every transaction) ────────────────────

  // Pitch base: bytes 0-3 → index into the full pentatonic+overtone table
  const txPitchSeed = hexBytes(txHex, 0, 4);
  const txPitchBase = txPitchSeed % PITCH_TABLE.length;

  // Octave register: byte 4 → shifts the chosen note into low/mid/high band
  // The table has 3 natural octave groups (indices 0-4, 5-9, 10-14) plus
  // overtones (15-21). We pick one of 4 register offsets and clamp into table.
  const octaveSeed  = hexBytes(txHex, 4, 1);
  const octaveShift = [0, 5, 10, 5][octaveSeed % 4]; // lo, mid, hi, mid-bias
  const pitchIdx    = (txPitchBase + octaveShift) % PITCH_TABLE.length;
  const txFrequency = PITCH_TABLE[pitchIdx];

  // Pan: bytes 5-6 → -0.45 to +0.45 (fully per-transaction)
  const txPanSeed = hexBytes(txHex, 5, 2);
  const txPan     = (txPanSeed / 65535) * 0.9 - 0.45;

  // Harmonic partial weights: bytes 7-17, two bytes per partial (skipping byte 6)
  // Partial 0 (fundamental) is always 1.0; upper partials shaped toward pad timbres
  const partialWeights = PARTIAL_RATIOS.map((_, i) => {
    if (i === 0) return 1.0;
    const raw = hexBytes(txHex, 7 + i * 2, 2) / 65535;
    return Math.pow(raw, 1.5 + i * 0.4) * (1.0 - i * 0.12);
  });

  // Detune spread: bytes 18-19 → 0–12 cents spread across partials
  const detuneSeed   = hexBytes(txHex, 18, 2);
  const detuneSpread = (detuneSeed / 65535) * 12;

  // Lowpass filter cutoff: bytes 20-21 → 300–6000 Hz (squared for warmth bias)
  const filterSeed = hexBytes(txHex, 20, 2);
  const filterFreq = 300 + Math.pow(filterSeed / 65535, 2) * 5700;

  // Vibrato rate: byte 22 → 0.03–0.4 Hz
  const vibratoRateSeed = hexBytes(txHex, 22, 1);
  const vibratoRate     = 0.03 + (vibratoRateSeed / 255) * 0.37;

  // Vibrato depth: byte 23 → 0–0.005
  const vibratoDepthSeed = hexBytes(txHex, 23, 1);
  const vibratoDepth     = (vibratoDepthSeed / 255) * 0.005;

  // Amp LFO rate: bytes 24-25 → 0.01–0.12 Hz
  const lfoRateSeed = hexBytes(txHex, 24, 2);
  const lfoRate     = 0.01 + (lfoRateSeed / 65535) * 0.11;

  // Amp LFO depth: byte 26 → 10–35%
  const lfoDepthSeed = hexBytes(txHex, 26, 1);
  const lfoDepth     = 0.10 + (lfoDepthSeed / 255) * 0.25;

  // LFO shape: byte 27 → 0=sine, 1=triangle
  const lfoShapeSeed = hexBytes(txHex, 27, 1);
  const lfoShape     = lfoShapeSeed / 255;

  // Unison detune: byte 28 → 0–8 cents
  const unisonDetuneSeed = hexBytes(txHex, 28, 1);
  const unisonDetune     = (unisonDetuneSeed / 255) * 8;

  // Unison mix: byte 29 → 0–40%
  const unisonMixSeed = hexBytes(txHex, 29, 1);
  const unisonMix     = (unisonMixSeed / 255) * 0.40;

  // ── FROM ADDRESS (subtle colouring — same sender stays recognisable) ──

  // Pitch nudge: address bytes 0-1 → offset ±2 scale steps around txHash pitch
  // Maps 0-255 → -2..+2 in integer steps (5 possible values)
  const addrPitchByte  = hexBytes(fromHex, 0, 1);
  const pitchNudge     = (addrPitchByte % 5) - 2; // -2, -1, 0, +1, +2
  const finalPitchIdx  = ((pitchIdx + pitchNudge) % PITCH_TABLE.length + PITCH_TABLE.length) % PITCH_TABLE.length;
  const frequency      = PITCH_TABLE[finalPitchIdx];
  const noteName       = NOTE_NAMES[finalPitchIdx] || `${frequency.toFixed(0)}Hz`;

  // Pan nudge: address bytes 2-3 → ±0.1 on top of txHash pan, clamped to ±0.5
  const addrPanByte = hexBytes(fromHex, 2, 1);
  const panNudge    = (addrPanByte / 255) * 0.2 - 0.1;
  const pan         = Math.max(-0.5, Math.min(0.5, txPan + panNudge));

  // ── ARCHETYPE + RHYTHM PARAMS ─────────────────────────────────────────

  // Archetype: XOR bytes 30, 13, 25 together for better distribution
  // (single bytes can cluster; mixing three spread-out bytes gives uniform spread)
  const archetypeSeed = (hexBytes(txHex, 30, 1) ^ hexBytes(txHex, 13, 1) ^ hexBytes(txHex, 25, 1)) & 0xff;
  const archetype = archetypeSeed < 64 ? 'drone'
    : archetypeSeed < 128 ? 'pulse'
    : archetypeSeed < 192 ? 'drop'
    : 'shimmer';

  // Beat period: XOR bytes 31-32 with bytes 6-7 → 0.75–5 s
  // Minimum raised to 0.75s so even short periods feel musical not frantic
  const beatPeriodSeed = (hexBytes(txHex, 31, 2) ^ hexBytes(txHex, 6, 2)) & 0xffff;
  const beatPeriod     = 0.75 + (beatPeriodSeed / 65535) * 4.25;

  // Pulse duty cycle: byte 33 XOR byte 11 → 0.15–0.75
  const pulseDutySeed = (hexBytes(txHex, 33, 1) ^ hexBytes(txHex, 11, 1)) & 0xff;
  const pulseDuty     = 0.15 + (pulseDutySeed / 255) * 0.60;

  // Drop decay: byte 34 XOR byte 9 → 0.4–3.0 s
  const dropDecaySeed = (hexBytes(txHex, 34, 1) ^ hexBytes(txHex, 9, 1)) & 0xff;
  const dropDecay     = 0.4 + (dropDecaySeed / 255) * 2.6;

  // Drop interval: bytes 35-36 XOR bytes 2-3 → 1.5–9 s
  const dropIntervalSeed = (hexBytes(txHex, 35, 2) ^ hexBytes(txHex, 2, 2)) & 0xffff;
  const dropInterval     = 1.5 + (dropIntervalSeed / 65535) * 7.5;

  // Shimmer attack: byte 37 XOR byte 15 → 0.05–0.6 s
  // Minimum raised so even fast shimmers have an audible swell
  const shimmerAttackSeed = (hexBytes(txHex, 37, 1) ^ hexBytes(txHex, 15, 1)) & 0xff;
  const shimmerAttack     = 0.05 + (shimmerAttackSeed / 255) * 0.55;

  // Shimmer sustain: bytes 38-39 XOR bytes 16-17 → 1.0–5 s
  const shimmerSustainSeed = (hexBytes(txHex, 38, 2) ^ hexBytes(txHex, 16, 2)) & 0xffff;
  const shimmerSustain     = 1.0 + (shimmerSustainSeed / 65535) * 4.0;

  // ── BREAKDOWN (human-readable per-parameter explanation) ─────────────
  // Stored on params so the UI detail panel can display it without re-deriving.
  const breakdown = [
    { label: 'Archetype',      value: archetype,                         bytes: 'tx[30]⊕[13]⊕[25]' },
    { label: 'Note',           value: noteName,                          bytes: 'tx[0–3] + octave tx[4]' },
    { label: 'Pan',            value: pan >= 0 ? `R ${(pan*100).toFixed(0)}%` : `L ${(Math.abs(pan)*100).toFixed(0)}%`, bytes: 'tx[5–6] + addr[2]' },
    { label: 'Filter',         value: `${Math.round(filterFreq)} Hz`,    bytes: 'tx[20–21]' },
    { label: 'Vibrato rate',   value: `${vibratoRate.toFixed(2)} Hz`,    bytes: 'tx[22]' },
    { label: 'Vibrato depth',  value: `${(vibratoDepth*1000).toFixed(1)}‰`, bytes: 'tx[23]' },
    { label: 'Breathe rate',   value: `${lfoRate.toFixed(3)} Hz`,        bytes: 'tx[24–25]' },
    { label: 'Breathe depth',  value: `${(lfoDepth*100).toFixed(0)}%`,   bytes: 'tx[26]' },
    { label: 'Unison detune',  value: `${unisonDetune.toFixed(1)} ¢`,    bytes: 'tx[28]' },
    { label: 'Unison mix',     value: `${(unisonMix*100).toFixed(0)}%`,  bytes: 'tx[29]' },
    ...(archetype === 'pulse' ? [
      { label: 'Beat period',  value: `${beatPeriod.toFixed(2)} s`,      bytes: 'tx[31–32]⊕[6–7]' },
      { label: 'Duty cycle',   value: `${(pulseDuty*100).toFixed(0)}%`,  bytes: 'tx[33]⊕[11]' },
    ] : []),
    ...(archetype === 'drop' ? [
      { label: 'Decay',        value: `${dropDecay.toFixed(2)} s`,       bytes: 'tx[34]⊕[9]' },
      { label: 'Interval',     value: `${dropInterval.toFixed(2)} s`,    bytes: 'tx[35–36]⊕[2–3]' },
    ] : []),
    ...(archetype === 'shimmer' ? [
      { label: 'Attack',       value: `${shimmerAttack.toFixed(2)} s`,   bytes: 'tx[37]⊕[15]' },
      { label: 'Sustain',      value: `${shimmerSustain.toFixed(2)} s`,  bytes: 'tx[38–39]⊕[16–17]' },
    ] : []),
    { label: 'Partials',       value: partialWeights.slice(1).map((w,i) => `${i+2}×:${(w*100).toFixed(0)}%`).join('  '), bytes: 'tx[7–17]' },
  ];

  // Timbre label: archetype takes precedence, then harmonic character
  const dominantPartials = partialWeights.slice(1).filter(w => w > 0.25).length;
  const timbreDetail = dominantPartials === 0 ? 'pure'
    : dominantPartials <= 1 ? 'flute'
    : dominantPartials <= 2 ? 'pad'
    : dominantPartials <= 3 ? 'organ'
    : 'bell';
  const timbreName = archetype; // shown as badge; timbreDetail available for tooltip

  // ── AMPLITUDE (value + time) ──────────────────────────────────────────
  const valueCrc    = Number(BigInt(t.value || '0')) / 1e18;
  const nowSec      = Date.now() / 1000;
  const txTimestamp = Number(t.timestamp || t.blockTimestamp || 0);
  const elapsedYears   = txTimestamp > 0
    ? Math.max(0, (nowSec - txTimestamp) / (365.25 * 24 * 3600))
    : 0;
  const demurrageFactor = Math.exp(-DEMURRAGE_RATE * elapsedYears);
  const rawLogValue     = Math.log1p(valueCrc);

  return {
    frequency,
    noteName,
    pan,
    partialWeights,
    detuneSpread,
    filterFreq,
    vibratoRate,
    vibratoDepth,
    lfoRate,
    lfoDepth,
    lfoShape,
    unisonDetune,
    unisonMix,
    archetype,
    beatPeriod,
    pulseDuty,
    dropDecay,
    dropInterval,
    shimmerAttack,
    shimmerSustain,
    timbreName,
    timbreDetail,
    breakdown,
    valueCrc,
    rawLogValue,
    demurrageFactor,
    elapsedYears,
  };
}

/**
 * Compute the final amplitude for a transfer given global max log value.
 */
function computeAmplitude(params, maxLogValue) {
  if (maxLogValue <= 0) return 0;
  const normalised = Math.min(1, params.rawLogValue / maxLogValue);
  // Curve: square-root gives more separation at the low end
  return Math.sqrt(normalised) * params.demurrageFactor * 0.5;
}

// ── Web Audio synthesis ────────────────────────────────────────────────────

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.7;

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;

    masterGain.connect(analyser);
    analyser.connect(audioCtx.destination);
  }
  return audioCtx;
}

// ── Shared synth helpers ───────────────────────────────────────────────────

/**
 * Build the additive partial bank + unison layer + lowpass filter.
 * Returns { filterNode, oscsToStop, cleanupNodes }.
 * This is the tonal core shared by all four archetypes.
 */
function buildToneCore(ctx, params) {
  const oscsToStop = [];
  const cleanupNodes = [];

  const partialSum = ctx.createGain();
  partialSum.gain.value = 1.0;
  cleanupNodes.push(partialSum);

  PARTIAL_RATIOS.forEach((ratio, i) => {
    const weight = params.partialWeights[i];
    if (weight < 0.001) return;
    const detuneCents = i === 0 ? 0 : (((i * 7) % 13) / 13 - 0.5) * params.detuneSpread;
    const detunedFreq = params.frequency * ratio * Math.pow(2, detuneCents / 1200);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = detunedFreq;
    osc.start();
    oscsToStop.push(osc);
    const g = ctx.createGain();
    g.gain.value = weight;
    cleanupNodes.push(g);
    osc.connect(g);
    g.connect(partialSum);
  });

  const unisonSum = ctx.createGain();
  unisonSum.gain.value = params.unisonMix;
  cleanupNodes.push(unisonSum);

  if (params.unisonDetune > 0.5 && params.unisonMix > 0.02) {
    const unisonFreqFactor = Math.pow(2, params.unisonDetune / 1200);
    PARTIAL_RATIOS.forEach((ratio, i) => {
      const weight = params.partialWeights[i];
      if (weight < 0.001) return;
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = params.frequency * ratio * unisonFreqFactor;
      osc.start();
      oscsToStop.push(osc);
      const g = ctx.createGain();
      g.gain.value = weight;
      cleanupNodes.push(g);
      osc.connect(g);
      g.connect(unisonSum);
    });
  }

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = params.filterFreq;
  filter.Q.value = 0.7;
  cleanupNodes.push(filter);

  partialSum.connect(filter);
  unisonSum.connect(filter);

  // Vibrato → filter frequency modulation
  const vibratoLFO = ctx.createOscillator();
  vibratoLFO.type = 'sine';
  vibratoLFO.frequency.value = params.vibratoRate;
  vibratoLFO.start();
  oscsToStop.push(vibratoLFO);
  const vibratoFilterGain = ctx.createGain();
  vibratoFilterGain.gain.value = params.filterFreq * params.vibratoDepth * 0.5;
  cleanupNodes.push(vibratoFilterGain);
  vibratoLFO.connect(vibratoFilterGain);
  vibratoFilterGain.connect(filter.frequency);

  return { filterNode: filter, oscsToStop, cleanupNodes };
}

/**
 * Wrap a filter node in a panner → soloGate → master, returning the standard voice object.
 *
 * soloGate is a dedicated gain node inserted AFTER the panner.
 * Solo mutes/unmutes by ramping soloGate, leaving the voice's own
 * internal gain scheduling (pulse/drop/shimmer envelopes) completely untouched.
 */
function wrapVoice(ctx, filterNode, voiceGain, panner, oscsToStop, cleanupNodes) {
  // soloGate sits between panner and masterGain — it is the solo control point
  const soloGate = ctx.createGain();
  soloGate.gain.value = 1.0;

  filterNode.connect(voiceGain);
  voiceGain.connect(panner);
  panner.connect(soloGate);
  soloGate.connect(masterGain);

  return {
    gainNode: voiceGain,
    soloGate,
    panner,
    baseAmp: voiceGain.gain.value,
    disconnect() {
      try {
        oscsToStop.forEach(o => { try { o.stop(); } catch {} });
        cleanupNodes.forEach(n => { try { n.disconnect(); } catch {} });
        voiceGain.disconnect();
        panner.disconnect();
        soloGate.disconnect();
      } catch {}
    },
  };
}

// ── Archetype: DRONE ──────────────────────────────────────────────────────
// Sustained pad with slow breathing LFO. The classic drone voice.

function createDroneVoice(params, amplitude) {
  const ctx = ensureAudioContext();
  const { filterNode, oscsToStop, cleanupNodes } = buildToneCore(ctx, params);

  const baseAmp  = amplitude * (1 - params.lfoDepth * 0.5);
  const voiceGain = ctx.createGain();
  voiceGain.gain.value = baseAmp;
  cleanupNodes.push(voiceGain);

  // Primary breathing LFO
  const ampLFO = ctx.createOscillator();
  ampLFO.type = 'sine';
  ampLFO.frequency.value = params.lfoRate;
  ampLFO.start();
  oscsToStop.push(ampLFO);
  const ampLFOGain = ctx.createGain();
  ampLFOGain.gain.value = amplitude * params.lfoDepth * (1 - params.lfoShape * 0.5);
  cleanupNodes.push(ampLFOGain);
  ampLFO.connect(ampLFOGain);
  ampLFOGain.connect(voiceGain.gain);

  // Secondary LFO (triangle, golden-ratio offset) blended by lfoShape
  if (params.lfoShape > 0.1) {
    const ampLFO2 = ctx.createOscillator();
    ampLFO2.type = 'triangle';
    ampLFO2.frequency.value = params.lfoRate * 1.618;
    ampLFO2.start();
    oscsToStop.push(ampLFO2);
    const ampLFO2Gain = ctx.createGain();
    ampLFO2Gain.gain.value = amplitude * params.lfoDepth * params.lfoShape * 0.4;
    cleanupNodes.push(ampLFO2Gain);
    ampLFO2.connect(ampLFO2Gain);
    ampLFO2Gain.connect(voiceGain.gain);
  }

  const panner = ctx.createStereoPanner();
  panner.pan.value = params.pan;
  return wrapVoice(ctx, filterNode, voiceGain, panner, oscsToStop, cleanupNodes);
}

// ── Archetype: PULSE ──────────────────────────────────────────────────────
// Rhythmic amplitude gate — the tone plays, then silences, then plays again.
// Uses scheduled AudioParam automation in a recurring setTimeout loop.

function createPulseVoice(params, amplitude) {
  const ctx = ensureAudioContext();
  const { filterNode, oscsToStop, cleanupNodes } = buildToneCore(ctx, params);

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0;
  cleanupNodes.push(voiceGain);

  const panner = ctx.createStereoPanner();
  panner.pan.value = params.pan;

  const voice = wrapVoice(ctx, filterNode, voiceGain, panner, oscsToStop, cleanupNodes);

  // onTime and offTime in seconds
  const onTime  = params.beatPeriod * params.pulseDuty;
  const offTime = params.beatPeriod * (1 - params.pulseDuty);

  let stopped = false;
  let timeoutId = null;

  function scheduleOn() {
    if (stopped) return;
    const now = ctx.currentTime;
    voiceGain.gain.cancelScheduledValues(now);
    voiceGain.gain.setValueAtTime(0, now);
    // Short attack (5% of onTime, min 10ms) then hold
    const attack = Math.max(0.01, onTime * 0.05);
    voiceGain.gain.linearRampToValueAtTime(amplitude, now + attack);
    timeoutId = setTimeout(scheduleOff, onTime * 1000);
  }

  function scheduleOff() {
    if (stopped) return;
    const now = ctx.currentTime;
    voiceGain.gain.cancelScheduledValues(now);
    voiceGain.gain.setValueAtTime(voiceGain.gain.value, now);
    // Short release (8% of offTime, min 20ms)
    const release = Math.max(0.02, offTime * 0.08);
    voiceGain.gain.linearRampToValueAtTime(0, now + release);
    timeoutId = setTimeout(scheduleOn, offTime * 1000);
  }

  // Stagger start by a random offset within the period so not all pulses fire together
  const startOffset = params.beatPeriod * ((hexBytes(stripHex(params._txHex || ''), 31, 1) / 255));
  timeoutId = setTimeout(scheduleOn, startOffset * 1000);

  // Wrap disconnect to also stop the scheduler
  const origDisconnect = voice.disconnect.bind(voice);
  voice.disconnect = () => {
    stopped = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
    origDisconnect();
  };

  return voice;
}

// ── Archetype: DROP ───────────────────────────────────────────────────────
// Pitched percussive hit: fast attack, exponential decay, then silence,
// then repeats at a slow irregular interval.

function createDropVoice(params, amplitude) {
  const ctx = ensureAudioContext();
  const { filterNode, oscsToStop, cleanupNodes } = buildToneCore(ctx, params);

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0;
  cleanupNodes.push(voiceGain);

  const panner = ctx.createStereoPanner();
  panner.pan.value = params.pan;

  const voice = wrapVoice(ctx, filterNode, voiceGain, panner, oscsToStop, cleanupNodes);

  let stopped = false;
  let timeoutId = null;

  function scheduleHit() {
    if (stopped) return;
    const now = ctx.currentTime;
    const attack = 0.008; // very fast percussive attack
    voiceGain.gain.cancelScheduledValues(now);
    voiceGain.gain.setValueAtTime(0, now);
    voiceGain.gain.linearRampToValueAtTime(amplitude, now + attack);
    // Exponential decay to near-zero over dropDecay seconds
    voiceGain.gain.setTargetAtTime(0.0001, now + attack, params.dropDecay / 4);
    // Schedule next hit
    timeoutId = setTimeout(scheduleHit, params.dropInterval * 1000);
  }

  // Stagger first hit
  const initDelay = params.dropInterval * (hexBytes(stripHex(params._txHex || ''), 35, 1) / 255);
  timeoutId = setTimeout(scheduleHit, initDelay * 1000);

  const origDisconnect = voice.disconnect.bind(voice);
  voice.disconnect = () => {
    stopped = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
    origDisconnect();
  };

  return voice;
}

// ── Archetype: SHIMMER ────────────────────────────────────────────────────
// Bell/glass-like: slow attack to peak, long sustain, then fade,
// cycling continuously. Pitched in the upper register.

function createShimmerVoice(params, amplitude) {
  const ctx = ensureAudioContext();

  // Shimmer uses higher partials more heavily — shift partialWeights upward
  const shimmerParams = {
    ...params,
    // Boost upper harmonics for a glassy bell character
    partialWeights: params.partialWeights.map((w, i) =>
      i === 0 ? w * 0.6 : w * (1 + i * 0.3)
    ),
    // Brighter filter for shimmer
    filterFreq: Math.min(params.filterFreq * 2.5, 8000),
  };

  const { filterNode, oscsToStop, cleanupNodes } = buildToneCore(ctx, shimmerParams);

  const voiceGain = ctx.createGain();
  voiceGain.gain.value = 0;
  cleanupNodes.push(voiceGain);

  const panner = ctx.createStereoPanner();
  panner.pan.value = params.pan;

  const voice = wrapVoice(ctx, filterNode, voiceGain, panner, oscsToStop, cleanupNodes);

  let stopped = false;
  let timeoutId = null;

  const cycleDuration = params.shimmerAttack + params.shimmerSustain;

  function scheduleCycle() {
    if (stopped) return;
    const now = ctx.currentTime;
    voiceGain.gain.cancelScheduledValues(now);
    voiceGain.gain.setValueAtTime(0, now);
    // Slow swell up
    voiceGain.gain.linearRampToValueAtTime(amplitude, now + params.shimmerAttack);
    // Hold then gentle fade over sustain period
    voiceGain.gain.setTargetAtTime(0.0001, now + params.shimmerAttack, params.shimmerSustain / 3);
    // Reschedule after full cycle
    timeoutId = setTimeout(scheduleCycle, cycleDuration * 1000 * 1.15);
  }

  // Stagger start
  const initDelay = cycleDuration * (hexBytes(stripHex(params._txHex || ''), 38, 1) / 255);
  timeoutId = setTimeout(scheduleCycle, initDelay * 1000);

  const origDisconnect = voice.disconnect.bind(voice);
  voice.disconnect = () => {
    stopped = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
    origDisconnect();
  };

  return voice;
}

/**
 * Dispatch to the correct archetype creator.
 * All four share the same params/amplitude interface.
 */
function createVoice(transfer, params, amplitude) {
  // Stash txHex on params so pulse/drop/shimmer can use it for stagger offsets
  params._txHex = stripHex(transfer.transactionHash);

  switch (params.archetype) {
    case 'pulse':   return createPulseVoice(params, amplitude);
    case 'drop':    return createDropVoice(params, amplitude);
    case 'shimmer': return createShimmerVoice(params, amplitude);
    default:        return createDroneVoice(params, amplitude);
  }
}

// ── Soundscape management ──────────────────────────────────────────────────

function stopAllVoices() {
  voices.forEach(v => v.disconnect());
  voices = [];
}

/**
 * Smoothly ramp a gain node to a target value over `ms` milliseconds.
 */
function rampGain(gainNode, target, ms = 300) {
  const now = audioCtx.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(target, now + ms / 1000);
}

/**
 * Enter solo mode for a given transfer.
 *
 * We mute/unmute via soloGate — a dedicated gain node inserted between
 * each voice's panner and masterGain. This leaves each voice's own internal
 * gain scheduling (pulse on/off, drop envelope, shimmer swell) completely
 * untouched, so the archetype behaviour keeps running correctly under the gate.
 */
function enterSolo(transfer) {
  ensureAudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();

  soloTxHash = transfer.transactionHash;
  soloTransfer = transfer;

  const maxLogValue = Math.log1p(maxContributed);
  const params = deriveParams(transfer);
  const amplitude = computeAmplitude(params, maxLogValue);

  if (isPlaying) {
    // Gate all voices: close everyone's soloGate, open only the matched one
    voices.forEach(v => {
      if (v.txHash === transfer.transactionHash) {
        rampGain(v.soloGate, 1.0, 250);
      } else {
        rampGain(v.soloGate, 0.0, 250);
      }
    });
    soloVoice = null;
  } else {
    // Not playing — spin up a one-off voice just for the preview
    soloVoice = createVoice(transfer, params, amplitude);
    soloVoice.txHash = transfer.transactionHash;
  }
}

/**
 * Exit solo mode, reopening all soloGates to full.
 */
function exitSolo() {
  soloTxHash = null;
  soloTransfer = null;

  if (soloVoice) {
    soloVoice.disconnect();
    soloVoice = null;
  }

  if (isPlaying) {
    // Restore all gated voices
    voices.forEach(v => {
      rampGain(v.soloGate, 1.0, 300);
    });
  }
}

/**
 * Rebuild the soundscape from the current transfers list.
 * Keeps only top MAX_VOICES by current amplitude.
 */
function rebuildSoundscape() {
  stopAllVoices();

  if (transfers.length === 0) {
    updateVoiceCount(0);
    return;
  }

  // Compute params and current amplitude for each transfer
  const maxLogValue = Math.log1p(maxContributed);
  const withParams = transfers.map(t => {
    const params = deriveParams(t);
    const amplitude = computeAmplitude(params, maxLogValue);
    return { t, params, amplitude };
  });

  // Sort by amplitude descending, keep top MAX_VOICES
  withParams.sort((a, b) => b.amplitude - a.amplitude);
  const active = withParams.slice(0, MAX_VOICES);

  if (isPlaying) {
    active.forEach(({ t, params, amplitude }) => {
      if (amplitude < 0.001) return; // inaudibly quiet, skip
      const voice = createVoice(t, params, amplitude);
      voice.txHash = t.transactionHash;
      // If we're rebuilding while a solo is active, immediately gate new voices
      if (soloTxHash && voice.txHash !== soloTxHash) {
        voice.soloGate.gain.value = 0;
      }
      voices.push(voice);
    });
  }

  updateVoiceCount(active.filter(({ amplitude }) => amplitude >= 0.001).length);
}

/**
 * Compute and display the voice count without starting audio.
 * Called after data loads so the counter is accurate before the user presses Play.
 */
function updateVoiceCountFromTransfers() {
  if (transfers.length === 0) {
    updateVoiceCount(0);
    return;
  }
  const maxLogValue = Math.log1p(maxContributed);
  const count = transfers.reduce((n, t) => {
    const params = deriveParams(t);
    const amplitude = computeAmplitude(params, maxLogValue);
    return amplitude >= 0.001 ? n + 1 : n;
  }, 0);
  updateVoiceCount(Math.min(count, MAX_VOICES));
}

function updateVoiceCount(n) {
  $('voice-count').textContent = n;
}

// ── Visualiser ─────────────────────────────────────────────────────────────

function startVisualiser() {
  if (!analyser) return;
  const canvas = $('visualiser');
  const ctx2d = canvas.getContext('2d');
  const bufLen = analyser.frequencyBinCount;
  const dataArr = new Uint8Array(bufLen);

  function draw() {
    animFrameId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArr);

    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const barW = (canvas.width / bufLen) * 2;
    let x = 0;
    for (let i = 0; i < bufLen; i++) {
      const barH = (dataArr[i] / 255) * canvas.height;
      const hue = 220 + (i / bufLen) * 60; // blue → purple
      const alpha = 0.4 + (dataArr[i] / 255) * 0.6;
      ctx2d.fillStyle = `hsla(${hue}, 70%, 60%, ${alpha})`;
      ctx2d.fillRect(x, canvas.height - barH, barW, barH);
      x += barW + 1;
    }
  }
  draw();
}

function stopVisualiser() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  const canvas = $('visualiser');
  const ctx2d = canvas.getContext('2d');
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
}

// ── Profile loading ────────────────────────────────────────────────────────

/**
 * Fetch a profile for a single address via circles_getProfileByAddress.
 * Returns { name, imageUrl } or null. Results are cached.
 */
async function fetchProfile(address) {
  const key = address.toLowerCase();
  if (profileCache.has(key)) return profileCache.get(key);
  try {
    const result = await rpcCall('circles_getProfileByAddress', [key]);
    const profile = result
      ? { name: result.name || null, imageUrl: result.previewImageUrl || null }
      : null;
    profileCache.set(key, profile);
    return profile;
  } catch {
    profileCache.set(key, null);
    return null;
  }
}

/**
 * Batch-fetch profiles for all unique contributor addresses.
 * Fires requests in parallel (max 10 at a time) and re-renders history when done.
 */
async function loadProfilesForTransfers() {
  const addresses = [...new Set(transfers.map(t => t.from.toLowerCase()))];
  const unfetched = addresses.filter(a => !profileCache.has(a));
  if (unfetched.length === 0) return;

  // Fetch in chunks of 10 to avoid overwhelming the RPC
  const CHUNK = 10;
  for (let i = 0; i < unfetched.length; i += CHUNK) {
    const chunk = unfetched.slice(i, i + CHUNK);
    await Promise.all(chunk.map(fetchProfile));
  }
  // Re-render history rows with names now populated
  renderVoiceHistory();
}

// ── Data fetching ──────────────────────────────────────────────────────────

/**
 * Low-level RPC fetch — bypasses the SDK client to avoid envelope handling surprises.
 * Returns the parsed result field directly.
 */
async function rpcCall(method, params) {
  const resp = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

/**
 * Fetch all CrcV2_TransferSingle events to SOUNDSCAPE_ADDRESS via direct fetch.
 * Uses circles_events_paginated which returns { events: [...], hasMore, nextCursor }.
 */
/**
 * Core paginated fetch. fromBlock is optional — if provided, only fetches
 * events from that block onward (used for incremental refresh).
 */
async function fetchTransfersSince(fromBlock = null, loadingLabel = 'Loading transfers…') {
  const allEvents = [];
  let cursor = null;
  let page = 0;

  do {
    page++;
    setLoading(page === 1 ? loadingLabel : `${loadingLabel} (page ${page})`);

    const params = [
      SOUNDSCAPE_ADDRESS.toLowerCase(),
      fromBlock,      // null = from genesis; number = incremental
      null,           // toBlock
      ['CrcV2_TransferSingle'],
      [
        {
          Type: 'FilterPredicate',
          FilterType: 'Equals',
          Column: 'to',
          Value: SOUNDSCAPE_ADDRESS.toLowerCase(),
        }
      ],
      true,           // sortAscending
      1000,
      cursor,
    ];

    let result;
    try {
      result = await rpcCall('circles_events_paginated', params);
    } catch (err) {
      console.error('circles_events_paginated error:', err);
      break;
    }

    const items = result?.events || [];
    items.forEach(item => {
      const v = item?.values || item;
      if (v) allEvents.push(v);
    });

    cursor = result?.nextCursor || null;
    if (!result?.hasMore) cursor = null;
  } while (cursor);

  return allEvents;
}

async function fetchAllTransfers() {
  return fetchTransfersSince(null, 'Loading transfers…');
}

/**
 * Parse raw event values objects into normalised transfer objects.
 * Handles hex-encoded fields (blockNumber, timestamp, value) from circles_events.
 */
function parseTransfers(events) {
  return events
    .filter(e => e.from && e.value)
    .map(e => {
      // Timestamps and values may be hex strings (0x...) or decimal strings
      const parseHexOrDec = (v) => {
        if (!v) return 0;
        if (typeof v === 'number') return v;
        const s = String(v);
        return s.startsWith('0x') ? parseInt(s, 16) : Number(s);
      };
      const parseHexOrDecBigInt = (v) => {
        if (!v) return 0n;
        const s = String(v);
        return s.startsWith('0x') ? BigInt(s) : BigInt(s);
      };

      const value = parseHexOrDecBigInt(e.value);
      if (value === 0n) return null;

      // Use the sender of the original transfer (the user who contributed),
      // not the operator field. e.from is the immediate token sender in the
      // flow matrix; e.operator is the Safe that signed — use operator as
      // the "contributor identity" if available, else from.
      const contributor = e.operator && e.operator !== '0x0000000000000000000000000000000000000000'
        ? e.operator
        : e.from;

      return {
        from: contributor,
        to: e.to || SOUNDSCAPE_ADDRESS,
        value: value.toString(),
        transactionHash: e.transactionHash || e.txHash || ('0x' + '00'.repeat(32)),
        timestamp: parseHexOrDec(e.timestamp || e.blockTimestamp),
        blockNumber: parseHexOrDec(e.blockNumber),
      };
    })
    .filter(Boolean);
}

// ── Voice history UI ───────────────────────────────────────────────────────

function formatAddress(addr) {
  if (!addr) return '???';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function buildVoiceRow(transfer, params, amplitude) {
  const row = document.createElement('div');
  row.className = 'voice-row';
  row.dataset.txHash = transfer.transactionHash;

  const ampPercent = Math.round(amplitude * 200);
  const barWidth = Math.min(100, Math.max(2, ampPercent));
  const yearsAgo = Number(params.elapsedYears.toFixed(1));

  // Look up cached profile
  const profile = profileCache.get(transfer.from.toLowerCase());
  const displayName = profile?.name
    ? profile.name
    : formatAddress(transfer.from);
  const avatarHtml = profile?.imageUrl
    ? `<img class="voice-avatar" src="${profile.imageUrl}" alt="" loading="lazy" />`
    : `<span class="voice-avatar-placeholder">${displayName.slice(0, 2).toUpperCase()}</span>`;

  // Build breakdown rows HTML
  const breakdownRowsHtml = params.breakdown.map(item => `
    <div class="breakdown-row">
      <span class="breakdown-label">${item.label}</span>
      <span class="breakdown-value">${item.value}</span>
      <span class="breakdown-bytes">${item.bytes}</span>
    </div>
  `).join('');

  const txShort = transfer.transactionHash.slice(0, 10) + '…' + transfer.transactionHash.slice(-6);

  row.innerHTML = `
    <div class="voice-row-top">
      <div class="voice-who">
        ${avatarHtml}
        <span class="voice-name">${displayName}</span>
      </div>
      <span class="voice-value">${params.valueCrc.toFixed(2)} CRC</span>
      <span class="voice-note badge-small">${params.noteName}</span>
      <span class="voice-timbre badge-small badge-${params.archetype}">${params.timbreName}</span>
      <button class="btn-solo" title="Listen to this voice" aria-label="Solo this voice">
        <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
      </button>
      <button class="btn-expand" title="Show sound breakdown" aria-label="Expand breakdown" aria-expanded="false">
        <svg class="expand-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" width="12" height="12"><path d="m6 9 6 6 6-6"/></svg>
      </button>
    </div>
    <div class="voice-row-bottom">
      <div class="amp-bar-bg">
        <div class="amp-bar-fill" style="width:${barWidth}%"></div>
      </div>
      <span class="voice-age">${yearsAgo > 0 ? yearsAgo + 'y ago' : 'recent'}</span>
    </div>
    <div class="voice-breakdown hidden">
      <div class="breakdown-header">
        <span class="breakdown-tx" title="${transfer.transactionHash}">tx ${txShort}</span>
        <span class="breakdown-caption">Sound parameters derived from transaction hash</span>
      </div>
      <div class="breakdown-grid">
        ${breakdownRowsHtml}
      </div>
    </div>
  `;

  // Solo button
  const soloBtn = row.querySelector('.btn-solo');
  soloBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (soloTxHash === transfer.transactionHash) {
      exitSolo();
      updateSoloUI(null);
    } else {
      if (soloTxHash) exitSolo();
      enterSolo(transfer);
      updateSoloUI(transfer.transactionHash);
    }
  });

  // Expand/collapse breakdown
  const expandBtn = row.querySelector('.btn-expand');
  const breakdown = row.querySelector('.voice-breakdown');
  expandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !breakdown.classList.contains('hidden');
    breakdown.classList.toggle('hidden', open);
    expandBtn.setAttribute('aria-expanded', String(!open));
    expandBtn.classList.toggle('expanded', !open);
  });

  return row;
}

/**
 * Update the visual solo state across all rows.
 * Highlights the active solo row; dims others; shows solo banner.
 */
function updateSoloUI(activeTxHash) {
  const rows = document.querySelectorAll('.voice-row');
  rows.forEach(row => {
    const isActive = row.dataset.txHash === activeTxHash;
    row.classList.toggle('solo-active', isActive && activeTxHash !== null);
    row.classList.toggle('solo-dimmed', !isActive && activeTxHash !== null);
    const btn = row.querySelector('.btn-solo');
    if (btn) btn.classList.toggle('soloing', isActive && activeTxHash !== null);
  });

  // Show/hide solo banner
  let banner = $('solo-banner');
  if (activeTxHash && !banner) {
    banner = document.createElement('div');
    banner.id = 'solo-banner';
    banner.className = 'solo-banner';
    banner.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
      <span>Listening to one voice</span>
      <button id="solo-exit-btn" class="solo-exit-btn">Back to all</button>
    `;
    document.querySelector('.player-card').appendChild(banner);
    $('solo-exit-btn').addEventListener('click', () => {
      exitSolo();
      updateSoloUI(null);
    });
  } else if (!activeTxHash && banner) {
    banner.remove();
  }
}

/**
 * Prepend new voice rows to the top of the history list without wiping existing rows.
 * New transfers are sorted by amplitude desc and inserted before existing rows.
 */
function prependVoiceRows(newTransfers) {
  const list = $('voice-list');
  const empty = $('voice-empty');
  empty.classList.add('hidden');

  const maxLogValue = Math.log1p(maxContributed);

  const sorted = newTransfers
    .map(t => {
      const params = deriveParams(t);
      const amplitude = computeAmplitude(params, maxLogValue);
      return { t, params, amplitude };
    })
    .sort((a, b) => b.amplitude - a.amplitude);

  // Insert before the first existing voice-row (or at end if none yet)
  const firstExisting = list.querySelector('.voice-row');
  sorted.forEach(({ t, params, amplitude }) => {
    const row = buildVoiceRow(t, params, amplitude);
    row.classList.add('voice-row-new'); // flash animation
    if (firstExisting) {
      list.insertBefore(row, firstExisting);
    } else {
      list.appendChild(row);
    }
    // Remove highlight class after animation completes
    setTimeout(() => row.classList.remove('voice-row-new'), 1800);
  });
}

function renderVoiceHistory() {
  const list = $('voice-list');
  const empty = $('voice-empty');

  // Remove all rows (but keep empty placeholder)
  list.querySelectorAll('.voice-row').forEach(el => el.remove());

  if (transfers.length === 0) {
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  const maxLogValue = Math.log1p(maxContributed);

  // Sort by amplitude desc for display
  const sorted = transfers
    .map(t => {
      const params = deriveParams(t);
      const amplitude = computeAmplitude(params, maxLogValue);
      return { t, params, amplitude };
    })
    .sort((a, b) => b.amplitude - a.amplitude)
    .slice(0, MAX_VOICES);

  sorted.forEach(({ t, params, amplitude }) => {
    list.appendChild(buildVoiceRow(t, params, amplitude));
  });
}

// ── Pathfinder / transfer ──────────────────────────────────────────────────

/**
 * Query maximum transferable flow from user to SOUNDSCAPE_ADDRESS.
 * Uses TransferBuilder's internal pathfinder (circlesV2_findPath via RPC).
 */
async function fetchMaxFlow(fromAddress) {
  try {
    const MAX_TARGET = '115792089237316195423570985008687907853269984665640564039457584007913129639935';
    // Use raw fetch — bypasses SDK client which may not handle circlesV2_findPath reliably
    const result = await rpcCall('circlesV2_findPath', [{
      Source: fromAddress.toLowerCase(),
      Sink: SOUNDSCAPE_ADDRESS.toLowerCase(),
      TargetFlow: MAX_TARGET,
      WithWrap: false,
      QuantizedMode: false,
    }]);
    const maxFlowStr = result?.maxFlow || '0';
    return BigInt(maxFlowStr);
  } catch (err) {
    console.warn('fetchMaxFlow error:', err);
    return 0n;
  }
}

/**
 * Use TransferBuilder to construct and send a CRC transfer via pathfinder.
 */
async function sendCrcTransfer(fromAddress, amountCrc) {
  const amountWei = BigInt(Math.round(amountCrc * 1e18)).toString();

  const config = {
    circlesRpcUrl: RPC_URL,
    v2HubAddress: HUB_V2_ADDRESS,
    liftERC20Address: LIFT_ERC20_ADDRESS,
  };

  const builder = new TransferBuilder(config);

  let transactions;
  try {
    transactions = await builder.constructAdvancedTransfer(
      fromAddress,
      SOUNDSCAPE_ADDRESS,
      BigInt(amountWei),
      { useWrappedBalances: false },
      false
    );
  } catch (err) {
    console.error('constructAdvancedTransfer error:', err);
    throw err;
  }

  if (!transactions || transactions.length === 0) {
    throw new Error('No transfer path found — you may not have enough CRC or a trust path to the soundscape address.');
  }

  // Format for sendTransactions (hex values)
  const formatted = transactions.map(tx => ({
    to: tx.to,
    data: tx.data || '0x',
    value: tx.value ? `0x${BigInt(tx.value).toString(16)}` : '0x0',
  }));

  const hashes = await sendTransactions(formatted);
  return hashes;
}

// ── Modal ──────────────────────────────────────────────────────────────────

function openModal() {
  $('modal-overlay').classList.remove('hidden');
  $('modal-status').classList.add('hidden');
  $('modal-status').textContent = '';
  $('btn-send').disabled = false;
  $('send-label').textContent = 'Contribute';
  $('send-spinner').classList.add('hidden');
  updateModalPreview();
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('modal-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

function updateModalPreview() {
  if (!connectedAddress) return;

  const fromHex = stripHex(connectedAddress);
  const pitchSeed = hexBytes(fromHex, 0, 4);
  const pitchIdx = pitchSeed % PITCH_TABLE.length;
  const noteName = NOTE_NAMES[pitchIdx];

  const panSeed = hexBytes(fromHex, 6, 2);
  const pan = (panSeed / 65535) * 0.8 - 0.4;
  const panLabel = pan < -0.1 ? `L${Math.abs(pan * 100).toFixed(0)}` : pan > 0.1 ? `R${(pan * 100).toFixed(0)}` : 'C';

  // Timbre is from txHash which we don't know yet, so show "varies"
  $('preview-note').textContent = noteName;
  $('preview-timbre').textContent = 'varies per transaction';
  $('preview-pan').textContent = panLabel;
  $('voice-preview').classList.remove('hidden');
}

async function updateSliderMax() {
  if (!connectedAddress) return;
  const slider = $('amount-slider');
  const maxLabel = $('slider-max-label');

  const maxFlowWei = await fetchMaxFlow(connectedAddress);
  userMaxFlow = maxFlowWei;

  // Use BigInt arithmetic throughout — avoid Number() on large wei values
  const ONE_CRC = BigInt(1e18);
  const maxFlowWhole = Number(maxFlowWei / ONE_CRC);           // whole CRC, safe
  const maxFlowFrac  = Number(maxFlowWei % ONE_CRC) / 1e18;   // fractional part
  const maxFlowCrc   = maxFlowWhole + maxFlowFrac;

  // Always set slider min first so the range is valid before setting max/value
  slider.min = MIN_CRC;

  if (maxFlowCrc < MIN_CRC) {
    maxLabel.textContent = 'no path found';
    slider.max = MIN_CRC;
    slider.value = MIN_CRC;
    slider.disabled = true;
    $('btn-send').disabled = true;
    $('amount-display').textContent = MIN_CRC;
    setModalStatus(`No transfer path found to soundscape. You need at least ${MIN_CRC} CRC reachable.`, 'error');
    return;
  }

  const displayMax = Math.floor(maxFlowCrc * 100) / 100;
  slider.max = maxFlowWhole;
  // Clamp current slider value into the valid range
  const currentVal = Number(slider.value);
  if (currentVal < MIN_CRC || currentVal > maxFlowWhole) {
    slider.value = MIN_CRC;
    $('amount-display').textContent = MIN_CRC;
  }
  slider.disabled = false;
  $('btn-send').disabled = false;
  maxLabel.textContent = `${displayMax.toFixed(2)} CRC`;
  $('amount-display').textContent = slider.value;
}

function setModalStatus(msg, type = 'info') {
  const el = $('modal-status');
  el.textContent = msg;
  el.className = `modal-status ${type}`;
  el.classList.remove('hidden');
}

// ── Play / Pause ───────────────────────────────────────────────────────────

async function play() {
  ensureAudioContext();

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  isPlaying = true;
  rebuildSoundscape();
  startVisualiser();

  $('icon-play').classList.add('hidden');
  $('icon-pause').classList.remove('hidden');
  $('play-label').textContent = 'Pause';
  $('btn-play').classList.add('playing');
}

function pause() {
  isPlaying = false;
  stopAllVoices();
  stopVisualiser();

  $('icon-play').classList.remove('hidden');
  $('icon-pause').classList.add('hidden');
  $('play-label').textContent = 'Play';
  $('btn-play').classList.remove('playing');
}

// ── Initialisation ─────────────────────────────────────────────────────────

/**
 * Track the highest block number seen across all loaded transfers.
 * Called whenever new transfers are merged in.
 */
function updateLastSeenBlock(newTransfers) {
  for (const t of newTransfers) {
    if (t.blockNumber && (lastSeenBlock === null || t.blockNumber > lastSeenBlock)) {
      lastSeenBlock = t.blockNumber;
    }
  }
}

async function loadSoundscape() {
  setLoading('Fetching contributions…');
  $('btn-play').disabled = true;

  try {
    const events = await fetchAllTransfers();
    transfers = parseTransfers(events);

    // Compute global max contributed (in CRC, float)
    maxContributed = 0;
    transfers.forEach(t => {
      const crc = Number(BigInt(t.value || '0')) / 1e18;
      if (crc > maxContributed) maxContributed = crc;
    });

    updateLastSeenBlock(transfers);
    renderVoiceHistory();
    updateVoiceCountFromTransfers();
    setLoading(null);
    $('btn-play').disabled = false;
    // Load profiles in background — re-renders history when done
    loadProfilesForTransfers();

    if (transfers.length > 0) {
      showToast(`Loaded ${transfers.length} contribution${transfers.length !== 1 ? 's' : ''}`, 'success');
    }
  } catch (err) {
    console.error('loadSoundscape error:', err);
    setLoading(null);
    showToast(`Failed to load soundscape: ${decodeError(err)}`, 'error');
    $('btn-play').disabled = false;
  }
}

/**
 * Incremental refresh: only fetch blocks after lastSeenBlock.
 * New transfers are merged into the existing list; existing voices are untouched.
 */
async function refreshSoundscape() {
  const btn = $('btn-refresh');
  const icon = $('refresh-icon');
  const label = $('refresh-label');

  btn.disabled = true;
  icon.classList.add('spin');
  label.textContent = 'Checking…';

  try {
    // Fetch only from the block after the last one we've seen
    const fromBlock = lastSeenBlock !== null ? lastSeenBlock + 1 : null;
    const events = await fetchTransfersSince(fromBlock, 'Checking for new voices…');
    const newTransfers = parseTransfers(events);

    // Deduplicate against existing transfers by txHash
    const existingHashes = new Set(transfers.map(t => t.transactionHash));
    const trulyNew = newTransfers.filter(t => !existingHashes.has(t.transactionHash));

    setLoading(null);

    if (trulyNew.length === 0) {
      showToast('No new contributions yet', 'info', 2500);
    } else {
      // Merge new transfers in, update max, track block
      transfers = [...transfers, ...trulyNew];
      trulyNew.forEach(t => {
        const crc = Number(BigInt(t.value || '0')) / 1e18;
        if (crc > maxContributed) maxContributed = crc;
      });
      updateLastSeenBlock(trulyNew);

      // Prepend new rows to the history list without wiping existing rows
      prependVoiceRows(trulyNew);
      updateVoiceCountFromTransfers();

      // Add new voices to the running soundscape without stopping existing ones
      if (isPlaying) {
        const maxLogValue = Math.log1p(maxContributed);
        trulyNew.forEach(t => {
          const params = deriveParams(t);
          const amplitude = computeAmplitude(params, maxLogValue);
          if (amplitude < 0.001) return;
          const voice = createVoice(t, params, amplitude);
          voice.txHash = t.transactionHash;
          if (soloTxHash && voice.txHash !== soloTxHash) {
            voice.soloGate.gain.value = 0;
          }
          voices.push(voice);
        });
      }

      // Load profiles for new contributors in background
      loadProfilesForTransfers();

      showToast(`${trulyNew.length} new voice${trulyNew.length !== 1 ? 's' : ''} added!`, 'success');
    }
  } catch (err) {
    console.error('refreshSoundscape error:', err);
    setLoading(null);
    showToast(`Refresh failed: ${decodeError(err)}`, 'error');
  } finally {
    btn.disabled = false;
    icon.classList.remove('spin');
    label.textContent = 'Refresh';
  }
}

async function initializeApp(address) {
  $('contribute-row').classList.remove('hidden');
  $('disconnected-hint').classList.add('hidden');

  // Load max flow in background (don't block UI)
  updateSliderMax();

  // Update modal preview
  updateModalPreview();
}

// ── Keyboard shortcut: Escape exits solo ──────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && soloTxHash) {
    exitSolo();
    updateSoloUI(null);
  }
});

// ── Event wiring ───────────────────────────────────────────────────────────

// Play / Pause
$('btn-play').addEventListener('click', async () => {
  if (!isPlaying) {
    await play();
  } else {
    pause();
  }
});

// Volume slider
$('volume-slider').addEventListener('input', () => {
  const val = Number($('volume-slider').value) / 100;
  if (masterGain) masterGain.gain.value = val;
});

// Contribute button
$('btn-contribute').addEventListener('click', async () => {
  if (!connectedAddress) {
    showToast('Connect your wallet first', 'error');
    return;
  }
  openModal();
  await updateSliderMax();
});

// Modal close
$('modal-close').addEventListener('click', closeModal);
$('btn-cancel').addEventListener('click', closeModal);
$('modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('modal-overlay')) closeModal();
});

// Amount slider live update
$('amount-slider').addEventListener('input', () => {
  const slider = $('amount-slider');
  $('amount-display').textContent = slider.value;
  const pct = ((Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min))) * 100;
  slider.style.background = `linear-gradient(to right, var(--accent-mid) ${pct}%, var(--line) ${pct}%)`;
});

// Send contribution
$('btn-send').addEventListener('click', async () => {
  if (!connectedAddress) return;

  const amount = Number($('amount-slider').value);
  if (amount < MIN_CRC) {
    setModalStatus(`Minimum contribution is ${MIN_CRC} CRC`, 'error');
    return;
  }

  const maxCrc = Number(userMaxFlow) / 1e18;
  if (amount > maxCrc + 0.01) {
    setModalStatus(`Amount exceeds your maximum transferable balance (${maxCrc.toFixed(2)} CRC)`, 'error');
    return;
  }

  $('btn-send').disabled = true;
  $('send-label').textContent = 'Finding path…';
  $('send-spinner').classList.remove('hidden');
  setModalStatus('Finding transfer path through the trust network…', 'info');

  try {
    $('send-label').textContent = 'Sending…';
    const hashes = await sendCrcTransfer(connectedAddress, amount);

    setModalStatus(`Transaction sent! Hash: ${hashes[0]?.slice(0, 16)}…`, 'success');
    showToast('Voice added to the soundscape! 🎵', 'success', 6000);

    // Close modal after a moment, then reload
    setTimeout(async () => {
      closeModal();
      await loadSoundscape();
      if (isPlaying) rebuildSoundscape();
    }, 2000);
  } catch (err) {
    if (isPasskeyAutoConnectError(err)) {
      setModalStatus('Passkey auto-connect failed. Re-open wallet connect and choose your wallet again.', 'error');
    } else {
      setModalStatus(`Failed: ${decodeError(err)}`, 'error');
    }
    $('btn-send').disabled = false;
    $('send-label').textContent = 'Contribute';
    $('send-spinner').classList.add('hidden');
  }
});

// ── Wallet connection ──────────────────────────────────────────────────────

onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    $('wallet-status').textContent = 'Not connected';
    $('contribute-row').classList.add('hidden');
    $('disconnected-hint').classList.remove('hidden');
    return;
  }

  try {
    connectedAddress = getAddress(address);
  } catch {
    connectedAddress = address;
  }

  $('wallet-status').textContent = `${connectedAddress.slice(0, 6)}…${connectedAddress.slice(-4)}`;
  await initializeApp(connectedAddress);
});

// ── Standalone mode banner ─────────────────────────────────────────────────

if (!isMiniappMode()) {
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div class="dev-banner">⚠ Running in standalone mode — wallet operations require the Circles host at <a href="https://circles.gnosis.io/miniapps" target="_blank">circles.gnosis.io/miniapps</a></div>'
  );
}

// ── Boot ───────────────────────────────────────────────────────────────────

// Refresh button
$('btn-refresh').addEventListener('click', () => {
  refreshSoundscape();
});

// Load the soundscape immediately (no wallet needed to listen)
loadSoundscape();