/**
 * Circling Soundscapes
 *
 * A living drone soundscape generated from CRC contributions.
 * Each transfer to the soundscape address creates a persistent oscillator voice.
 *
 * Sound parameters are deterministic functions of transaction data:
 *   - Pitch:       from address bytes 0-3  → pentatonic scale index
 *   - Waveform:    txHash bytes 4-6        → sine/triangle/sawtooth blend
 *   - Pan:         from address bytes 6-8  → -0.4 to +0.4
 *   - Vibrato:     txHash byte 8           → subtle pitch wobble
 *   - LFO rate:    txHash bytes 10-12      → slow amplitude breathing
 *   - Amplitude:   CRC value               → log-proportional
 *   - Demurrage:   timestamp               → e^(-0.07 * years_elapsed)
 */

import { onWalletChange, sendTransactions, isMiniappMode } from './miniapp-sdk.js';
import { Sdk } from '@aboutcircles/sdk';
import { TransferBuilder } from '@aboutcircles/sdk-transfers';
import { getAddress } from 'viem';

// ── Constants ──────────────────────────────────────────────────────────────

const SOUNDSCAPE_ADDRESS = '0xC69A3Ac0bF61BCAd06752908F3330CA41c6fA1FD';
const RPC_URL = 'https://rpc.aboutcircles.com/';

const MAX_VOICES = 200;
const MIN_CRC = 10;
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

const TIMBRE_NAMES = ['sine', 'triangle', 'soft-saw'];

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
 * @param {object} t  - transfer object with from, transactionHash, value, timestamp
 * @returns {object}  - all acoustic parameters
 */
function deriveParams(t) {
  const fromHex = stripHex(t.from);
  const txHex = stripHex(t.transactionHash);

  // Pitch: first 4 bytes of sender address → index into PITCH_TABLE
  const pitchSeed = hexBytes(fromHex, 0, 4);
  const pitchIdx = pitchSeed % PITCH_TABLE.length;
  const frequency = PITCH_TABLE[pitchIdx];
  const noteName = NOTE_NAMES[pitchIdx] || `${frequency.toFixed(0)}Hz`;

  // Timbre: txHash bytes 4-6 → 0..255 blend value
  const timbreSeed = hexBytes(txHex, 4, 3);
  // 0-85 → sine, 86-170 → triangle, 171-255 → soft-saw
  const timbreIdx = Math.floor(timbreSeed / 86);
  const timbreBlend = (timbreSeed % 86) / 85; // 0..1 within segment
  const timbreName = TIMBRE_NAMES[Math.min(timbreIdx, 2)];

  // Pan: from address bytes 6-8 → -0.4 to +0.4
  const panSeed = hexBytes(fromHex, 6, 2);
  const pan = (panSeed / 65535) * 0.8 - 0.4;

  // Vibrato: txHash byte 8 → rate 0.05-0.8 Hz, depth 0-0.003 (semitone-level)
  const vibratoSeed = hexBytes(txHex, 8, 1);
  const vibratoRate = 0.05 + (vibratoSeed / 255) * 0.75;
  const vibratoDepth = (vibratoSeed / 255) * 0.003;

  // LFO: txHash bytes 10-12 → 0.02-0.15 Hz amplitude breathing
  const lfoSeed = hexBytes(txHex, 10, 2);
  const lfoRate = 0.02 + (lfoSeed / 65535) * 0.13;
  const lfoDepth = 0.15 + (lfoSeed / 65535) * 0.25; // 15-40% modulation depth

  // Amplitude: log-proportional to CRC value, then demurraged
  const valueCrc = Number(BigInt(t.value || '0')) / 1e18;
  const nowSec = Date.now() / 1000;
  const txTimestamp = Number(t.timestamp || t.blockTimestamp || 0);
  const elapsedYears = txTimestamp > 0 ? Math.max(0, (nowSec - txTimestamp) / (365.25 * 24 * 3600)) : 0;
  const demurrageFactor = Math.exp(-DEMURRAGE_RATE * elapsedYears);

  // Log normalisation uses the global maxContributed, applied later
  const rawLogValue = Math.log1p(valueCrc);

  return {
    frequency,
    noteName,
    timbreIdx,
    timbreBlend,
    timbreName,
    pan,
    vibratoRate,
    vibratoDepth,
    lfoRate,
    lfoDepth,
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

/**
 * Build a soft-sawtooth oscillator by summing a few harmonics.
 * Returns an AudioNode (a GainNode that sums the partials).
 */
function createSoftSawNode(ctx, frequency) {
  const sum = ctx.createGain();
  sum.gain.value = 1;
  const harmonics = [1, 0.5, 0.25, 0.12, 0.06];
  harmonics.forEach((amp, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency * (i + 1);
    const g = ctx.createGain();
    g.gain.value = amp;
    osc.connect(g);
    g.connect(sum);
    osc.start();
    sum._oscs = sum._oscs || [];
    sum._oscs.push(osc);
  });
  return sum;
}

/**
 * Create a single voice from a transfer + its derived params.
 * Returns a group object with .disconnect() and .gainNode.
 */
function createVoice(transfer, params, amplitude) {
  const ctx = ensureAudioContext();

  // Main oscillator (or soft-saw composite)
  let sourceNode;
  let extraOscs = [];

  if (params.timbreIdx === 2) {
    // Soft sawtooth: sum of harmonics
    sourceNode = createSoftSawNode(ctx, params.frequency);
    extraOscs = sourceNode._oscs || [];
  } else {
    const osc = ctx.createOscillator();
    osc.type = params.timbreIdx === 0 ? 'sine' : 'triangle';
    osc.frequency.value = params.frequency;
    osc.start();
    sourceNode = osc;
    extraOscs = [osc];
  }

  // Vibrato LFO → frequency modulation
  const vibratoLFO = ctx.createOscillator();
  vibratoLFO.type = 'sine';
  vibratoLFO.frequency.value = params.vibratoRate;
  const vibratoGain = ctx.createGain();
  vibratoGain.gain.value = params.frequency * params.vibratoDepth;

  // Connect vibrato to main osc frequency (only if it's a single OscillatorNode)
  if (params.timbreIdx !== 2 && sourceNode.frequency) {
    vibratoLFO.connect(vibratoGain);
    vibratoGain.connect(sourceNode.frequency);
  }
  vibratoLFO.start();

  // Amplitude LFO
  const ampLFO = ctx.createOscillator();
  ampLFO.type = 'sine';
  ampLFO.frequency.value = params.lfoRate;
  const ampLFOGain = ctx.createGain();
  ampLFOGain.gain.value = amplitude * params.lfoDepth;

  // Voice gain node
  const voiceGain = ctx.createGain();
  const baseAmp = amplitude * (1 - params.lfoDepth * 0.5);
  voiceGain.gain.value = baseAmp;

  // Connect amplitude LFO to gain
  ampLFO.connect(ampLFOGain);
  ampLFOGain.connect(voiceGain.gain);
  ampLFO.start();

  // Panner
  const panner = ctx.createStereoPanner();
  panner.pan.value = params.pan;

  // Chain: source → voiceGain → panner → master
  sourceNode.connect(voiceGain);
  voiceGain.connect(panner);
  panner.connect(masterGain);

  return {
    gainNode: voiceGain,
    disconnect() {
      try {
        extraOscs.forEach(o => { try { o.stop(); } catch {} });
        vibratoLFO.stop();
        ampLFO.stop();
        sourceNode.disconnect();
        voiceGain.disconnect();
        panner.disconnect();
        vibratoGain.disconnect();
        ampLFOGain.disconnect();
      } catch {}
    },
  };
}

// ── Soundscape management ──────────────────────────────────────────────────

function stopAllVoices() {
  voices.forEach(v => v.disconnect());
  voices = [];
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
      voices.push(voice);
    });
  }

  updateVoiceCount(active.filter(({ amplitude }) => amplitude >= 0.001).length);
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

// ── Data fetching ──────────────────────────────────────────────────────────

/**
 * Fetch all CrcV2_TransferSingle events to SOUNDSCAPE_ADDRESS.
 * Paginates through all results.
 */
async function fetchAllTransfers() {
  const sdk = getSdk();
  const allEvents = [];
  let cursor = null;
  const limit = 1000;
  let page = 0;

  do {
    page++;
    setLoading(`Loading transfers… (page ${page})`);

    const params = [
      null,           // address: not filtering at top level
      null,           // fromBlock
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
      limit,
      cursor,
    ];

    let response;
    try {
      response = await sdk.circlesRpc.call('circles_events', params);
    } catch (err) {
      console.error('circles_events error:', err);
      break;
    }

    const result = response?.result;
    if (!result) break;

    const cols = result.columns || [];
    const rows = result.rows || [];

    rows.forEach(row => {
      const obj = Object.fromEntries(cols.map((col, i) => [col, row[i]]));
      allEvents.push(obj);
    });

    cursor = result.nextCursor || result.cursor || null;
    if (rows.length < limit) cursor = null; // no more pages
  } while (cursor);

  return allEvents;
}

/**
 * Parse raw event objects into transfer objects with normalised fields.
 */
function parseTransfers(events) {
  return events
    .filter(e => e.from && e.value && BigInt(e.value || '0') > 0n)
    .map(e => ({
      from: e.from,
      to: e.to || SOUNDSCAPE_ADDRESS,
      value: e.value,
      transactionHash: e.transactionHash || e.txHash || '0x' + '00'.repeat(32),
      timestamp: Number(e.timestamp || e.blockTimestamp || e.blockNumber || 0),
      blockNumber: e.blockNumber,
    }));
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

  const ampPercent = Math.round(amplitude * 200); // out of 100 effective
  const barWidth = Math.min(100, Math.max(2, ampPercent));

  const yearsAgo = params.elapsedYears.toFixed(1);

  row.innerHTML = `
    <div class="voice-row-top">
      <span class="voice-addr">${formatAddress(transfer.from)}</span>
      <span class="voice-value">${params.valueCrc.toFixed(2)} CRC</span>
      <span class="voice-note badge-small">${params.noteName}</span>
      <span class="voice-timbre badge-small">${params.timbreName}</span>
    </div>
    <div class="voice-row-bottom">
      <div class="amp-bar-bg">
        <div class="amp-bar-fill" style="width:${barWidth}%"></div>
      </div>
      <span class="voice-age">${yearsAgo > 0 ? yearsAgo + 'y ago' : 'recent'}</span>
    </div>
  `;
  return row;
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
    const config = {
      circlesRpcUrl: RPC_URL,
      v2HubAddress: HUB_V2_ADDRESS,
      liftERC20Address: LIFT_ERC20_ADDRESS,
    };
    const builder = new TransferBuilder(config);
    const maxFlow = await builder.pathfinder.findMaxFlow({
      from: fromAddress,
      to: SOUNDSCAPE_ADDRESS,
      targetFlow: BigInt('9999999999999999999999999999999999999'),
      useWrappedBalances: false,
    });
    return BigInt(maxFlow);
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
  $('preview-timbre').textContent = 'sine / triangle / soft-saw';
  $('preview-pan').textContent = panLabel;
  $('voice-preview').classList.remove('hidden');
}

async function updateSliderMax() {
  if (!connectedAddress) return;
  const slider = $('amount-slider');
  const maxLabel = $('slider-max-label');

  const maxFlowWei = await fetchMaxFlow(connectedAddress);
  userMaxFlow = maxFlowWei;
  const maxFlowCrc = Number(maxFlowWei) / 1e18;

  if (maxFlowCrc < MIN_CRC) {
    maxLabel.textContent = 'no path found';
    slider.max = MIN_CRC;
    slider.disabled = true;
    $('btn-send').disabled = true;
    setModalStatus(`No transfer path found to soundscape. You need at least ${MIN_CRC} CRC reachable.`, 'error');
    return;
  }

  const displayMax = Math.floor(maxFlowCrc * 100) / 100;
  slider.max = Math.floor(maxFlowCrc);
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

    renderVoiceHistory();
    setLoading(null);
    $('btn-play').disabled = false;

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

async function initializeApp(address) {
  $('contribute-row').classList.remove('hidden');
  $('disconnected-hint').classList.add('hidden');

  // Load max flow in background (don't block UI)
  updateSliderMax();

  // Update modal preview
  updateModalPreview();
}

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

// Load the soundscape immediately (no wallet needed to listen)
loadSoundscape();