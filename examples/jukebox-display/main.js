/**
 * Circles Jukebox — display main.js
 *
 * Standalone TV webpage for the Gnosis Garden jukebox. Polls the chain for
 * incoming 10 CRC payments to JUKEBOX_ADDRESS, decodes songId from the
 * transfer amount, plays each request in chronological order via the
 * SoundCloud Widget API, and renders a Warp Records-style "now playing" UI.
 *
 * State that survives a reload (so the queue resumes correctly) lives in
 * localStorage under PLAYHEAD_KEY: the txHash of the most recently completed
 * song.
 */

// @ts-nocheck
import { Sdk } from '@aboutcircles/sdk';
import { getAddress } from 'viem';
import songsCatalog from './songs.json';
import {
  RPC_URL,
  JUKEBOX_ADDRESS,
  ACCEPTED_TOKEN_ADDRESS,
  BASE_AMOUNT_WEI,
  SONG_ID_MOD,
  POLL_INTERVAL_MS,
  PLAYHEAD_KEY,
  START_BLOCK,
} from './constants.js';

// ─── DOM refs ───────────────────────────────────────────────
const stageWrap = document.getElementById('stageWrap');
const startGate = document.getElementById('start-gate');
const header = document.getElementById('header');
const main = document.getElementById('main');
const footer = document.getElementById('footer');
const liveBadge = document.getElementById('live-badge');
const liveText = document.getElementById('live-text');
const clockEl = document.getElementById('clock');
const coverWrap = document.getElementById('cover-wrap');
const coverArt = document.getElementById('now-playing-art');
const npTitle = document.getElementById('np-title');
const npArtist = document.getElementById('np-artist');
const npProg = document.getElementById('np-prog');
const npBarFill = document.getElementById('np-bar-fill');
const npTimeElapsed = document.getElementById('np-time-elapsed');
const npTimeTotal = document.getElementById('np-time-total');
const npBy = document.getElementById('np-by');
const npSection = document.getElementById('now-playing-section');
const eq = document.getElementById('eq');
const qList = document.getElementById('q-list');
const qEmpty = document.getElementById('q-empty');
const qCount = document.getElementById('q-count');
const widgetIframe = document.getElementById('sc-widget');

// ─── State ──────────────────────────────────────────────────
let allEntries = [];        // chronologically sorted, decoded
let currentIndex = -1;      // index in allEntries of currently-playing track
let widget = null;
let widgetReady = false;
let isPlaying = false;
let autoplayCheckTimer = null;
const profileCache = new Map();

// ─── SDK + RPC ──────────────────────────────────────────────
let _readSdk = null;
function getReadSdk() {
  if (!_readSdk) _readSdk = new Sdk();
  return _readSdk;
}

// ─── Stage scaler (1920x1080 → fit viewport) ────────────────
function fitStage() {
  if (!stageWrap) return;
  const w = stageWrap.clientWidth || window.innerWidth;
  const h = stageWrap.clientHeight || window.innerHeight;
  if (!w || !h) { requestAnimationFrame(fitStage); return; }
  const s = Math.min(w / 1920, h / 1080) || 1;
  document.getElementById('stage').style.transform = 'scale(' + s + ')';
}
window.addEventListener('resize', fitStage);
window.addEventListener('load', fitStage);
new ResizeObserver(fitStage).observe(stageWrap);
fitStage();

// ─── Helpers ────────────────────────────────────────────────
function songById(id) {
  return songsCatalog.find(s => s.id === id);
}

function shortAddress(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

const AMP = String.fromCharCode(38);
const ESC = {
  [AMP]: AMP + 'amp;',
  [String.fromCharCode(60)]: 'lt;',
  [String.fromCharCode(62)]: 'gt;',
  [String.fromCharCode(34)]: 'quot;',
  [String.fromCharCode(39)]: String.fromCharCode(35, 51, 57) + ';',
};
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ESC[c]);
}

function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, '0');
  return m + ':' + ss;
}

function setLive(connected) {
  if (connected) {
    liveBadge.classList.remove('off');
    liveBadge.classList.add('on');
    liveText.textContent = 'LIVE';
  } else {
    liveBadge.classList.add('off');
    liveBadge.classList.remove('on');
    liveText.textContent = 'CONNECTING';
  }
}

function setStatus(state, text) {
  if (state === 'live') setLive(true);
  else if (state === 'error') setLive(false);
  if (text) liveText.textContent = text;
}

// ─── SoundCloud Widget API setup ────────────────────────────
function initWidget() {
  if (typeof SC === 'undefined') {
    setStatus('error', 'SoundCloud API failed');
    return;
  }
  widget = SC.Widget(widgetIframe);
  widget.bind(SC.Widget.Events.READY, () => {
    widgetReady = true;
    advanceIfIdle();
  });
  widget.bind(SC.Widget.Events.FINISH, () => onSongEnded());
  widget.bind(SC.Widget.Events.ERROR, (e) => {
    console.warn('[display] SC error:', e);
    onSongEnded(); // skip broken track
  });
  widget.bind(SC.Widget.Events.PLAY_PROGRESS, (e) => {
    // e.loadedProgress is 0..1 of total track length
    if (e && Number.isFinite(e.loadedProgress)) {
      npBarFill.style.width = (e.loadedProgress * 100).toFixed(2) + '%';
    }
    if (e && Number.isFinite(e.currentPosition)) {
      npTimeElapsed.textContent = fmtTime(e.currentPosition / 1000);
    }
  });
}

function loadAndPlay(soundcloudUrl) {
  if (!widget || !widgetReady) return;
  widget.load(soundcloudUrl, {
    auto_play: true,
    show_comments: false,
    show_user: false,
    show_reposts: false,
    show_teaser: false,
    visual: false,
    buying: false,
    sharing: false,
    download: false,
  });
  isPlaying = true;
  eq.classList.add('eq-on');
  // SC widget needs a user gesture for autoplay after page load — the start
  // gate click is that gesture, so we should be fine.
  clearTimeout(autoplayCheckTimer);
  autoplayCheckTimer = setTimeout(() => {
    if (!isPlaying) {
      // autoplay was blocked; gate would have caught it but show a soft retry
      console.warn('[display] autoplay did not start in 3s');
    }
  }, 3000);
}

// ─── Playhead persistence ───────────────────────────────────
function loadPlayhead() {
  try { return localStorage.getItem(PLAYHEAD_KEY) || null; } catch { return null; }
}
function savePlayhead(txHash) {
  try { if (txHash) localStorage.setItem(PLAYHEAD_KEY, txHash); } catch { /* */ }
}

// ─── Queue fetching (chain indexer) ─────────────────────────
async function circlesQuery(table, columns, filters, order, limit) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'circles_query',
      params: [{
        Namespace: 'CrcV2',
        Table: table,
        Columns: columns,
        Filter: filters.map(f => ({
          Type: 'FilterPredicate',
          FilterType: f.op || 'Equals',
          Column: f.column,
          Value: f.value,
        })),
        Order: order,
        Limit: limit,
      }],
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'circles_query failed');
  const cols = json.result?.columns || [];
  const rows = json.result?.rows || [];
  return rows.map(row => Object.fromEntries(cols.map((c, i) => [c, row[i]])));
}

async function fetchQueueEntries() {
  const rows = await circlesQuery(
    'Erc20WrapperTransfer',
    ['blockNumber', 'timestamp', 'transactionHash', 'logIndex', 'tokenAddress', 'from', 'to', 'amount'],
    [{ column: 'to', value: JUKEBOX_ADDRESS.toLowerCase() }],
    [{ Column: 'blockNumber', SortOrder: 'ASC' }],
    1000,
  );

  const accepted = ACCEPTED_TOKEN_ADDRESS.toLowerCase();
  const entries = [];
  for (const row of rows) {
    if ((row.tokenAddress || '').toLowerCase() !== accepted) continue;
    try {
      const value = BigInt(row.amount);
      const songId = Number(value % SONG_ID_MOD);
      const base = value - (value % SONG_ID_MOD);
      if (base !== BASE_AMOUNT_WEI) continue;
      if (Number(row.blockNumber) < Number(START_BLOCK)) continue;
      const song = songById(songId);
      if (!song) continue;
      entries.push({
        song,
        from: getAddress(row.from),
        txHash: row.transactionHash,
        blockNumber: Number(row.blockNumber),
        logIndex: Number(row.logIndex),
      });
    } catch { /* skip malformed row */ }
  }
  entries.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.logIndex - b.logIndex;
  });
  return entries;
}

// ─── Profile lookup ─────────────────────────────────────────
async function getProfile(address) {
  const key = address.toLowerCase();
  if (profileCache.has(key)) return profileCache.get(key);
  let profile = null;
  try {
    profile = await getReadSdk().rpc.profile.getProfileByAddress(address);
  } catch {
    try {
      profile = await getReadSdk().rpc.profile.getProfileByAddress(address.toLowerCase());
    } catch { /* still null */ }
  }
  profileCache.set(key, profile);
  return profile;
}

// ─── Render: now playing ────────────────────────────────────
function renderIdle() {
  // Cover: idle state (no image, just gradient)
  coverArt.style.display = 'none';
  coverWrap.classList.add('idle');
  coverWrap.style.backgroundImage = '';
  npTitle.textContent = 'Waiting for a request…';
  npTitle.classList.add('idle-title');
  npArtist.textContent = 'The garden is quiet. Queue the next one.';
  npProg.hidden = true;
  npBy.textContent = '';
  npBarFill.style.width = '0%';
  npTimeElapsed.textContent = '0:00';
  npTimeTotal.textContent = '0:00';
  eq.classList.remove('eq-on');
  isPlaying = false;
  // SC widget: stop current track so it isn't looping in the background
  if (widget && widgetReady) {
    try { widget.pause(); } catch { /* */ }
  }
}

function renderNowPlaying(entry) {
  // Cover: real artwork from songs.json
  if (entry.song.artworkUrl) {
    coverArt.src = entry.song.artworkUrl;
    coverArt.style.display = 'block';
    coverWrap.classList.remove('idle');
    coverWrap.style.backgroundImage = `url(${entry.song.artworkUrl})`;
  } else {
    coverArt.style.display = 'none';
    coverWrap.classList.add('idle');
    coverWrap.style.backgroundImage = '';
  }
  npTitle.textContent = entry.song.title;
  npTitle.classList.remove('idle-title');
  npArtist.textContent = entry.song.artist;
  npProg.hidden = false;
  npBarFill.style.width = '0%';
  npTimeElapsed.textContent = '0:00';
  // Total time: SC widget exposes it after load, but we don't have it before
  // play starts. Leave as 0:00 until PLAY_PROGRESS fires.
  npBy.textContent = 'queued by ' + shortAddress(entry.from);
  // Profile resolution is async — overwrite once it arrives
  getProfile(entry.from).then((profile) => {
    const name = profile?.name || profile?.registeredName || shortAddress(entry.from);
    npBy.textContent = 'queued by ' + name;
  });
}

// ─── Render: queue ──────────────────────────────────────────
function renderQueue() {
  const upcoming = allEntries.slice(currentIndex + 1);
  qCount.textContent = upcoming.length + ' in queue';
  if (upcoming.length === 0) {
    qList.innerHTML = '<div class="q-empty">No one in line yet. Be the first.</div>';
    return;
  }
  // Cap the visible list; design shows 6 rows max comfortably
  const visible = upcoming.slice(0, 6);
  qList.innerHTML = '';
  visible.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'q-row';
    row.innerHTML = `
      <span class="q-idx">${String(i + 1).padStart(2, '0')}</span>
      <img class="q-thumb" src="${escapeHtml(entry.song.artworkUrl || '')}" alt="" onerror="this.style.background='var(--bg-1)'" />
      <div class="q-meta">
        <div class="q-title">${escapeHtml(entry.song.title)}</div>
        <div class="q-artist">${escapeHtml(entry.song.artist)}</div>
      </div>
      <div class="q-side">
        <span class="q-crc">10 CRC</span>
        <span class="q-by" data-addr="${escapeHtml(entry.from)}">${escapeHtml(shortAddress(entry.from))}</span>
      </div>
    `;
    qList.appendChild(row);
    // Async profile resolve
    getProfile(entry.from).then((profile) => {
      const name = profile?.name || profile?.registeredName || shortAddress(entry.from);
      const byEl = row.querySelector('.q-by');
      if (byEl) byEl.textContent = name;
    });
  });
}

// ─── Playback orchestration ─────────────────────────────────
async function refreshFromChain() {
  try {
    const entries = await fetchQueueEntries();
    allEntries = entries;

    // On first load, align currentIndex with the saved playhead.
    if (currentIndex === -1) {
      const saved = loadPlayhead();
      if (saved) {
        const i = entries.findIndex(e => e.txHash.toLowerCase() === saved.toLowerCase());
        currentIndex = i >= 0 ? i : -1;
      }
    }

    setLive(true);
    renderQueue();
    advanceIfIdle();
  } catch (err) {
    console.error('[display] refresh failed:', err);
    setLive(false);
  }
}

function advanceIfIdle() {
  if (!widgetReady || isPlaying) return;
  const next = currentIndex + 1;
  if (next < allEntries.length) {
    playEntry(next);
  } else {
    renderIdle();
  }
}

function onSongEnded() {
  isPlaying = false;
  eq.classList.remove('eq-on');
  if (currentIndex >= 0 && currentIndex < allEntries.length) {
    savePlayhead(allEntries[currentIndex].txHash);
  }
  renderQueue();
  if (currentIndex + 1 < allEntries.length) {
    playEntry(currentIndex + 1);
  } else {
    currentIndex = allEntries.length - 1;
    renderIdle();
    renderQueue();
  }
}

function playEntry(index) {
  currentIndex = index;
  const entry = allEntries[index];
  if (!entry) return;
  savePlayhead(entry.txHash);
  renderNowPlaying(entry);
  renderQueue();
  loadAndPlay(entry.song.soundcloudUrl);
}

// ─── Clock (updates every 20s) ──────────────────────────────
function tickClock() {
  const d = new Date();
  clockEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
tickClock();
setInterval(tickClock, 20_000);

// ─── Start gate: prime audio, reveal stage ──────────────────
function dismissGate() {
  startGate.classList.add('hidden');
  // Reveal the main UI
  header.hidden = false;
  main.hidden = false;
  footer.hidden = false;
  // After fade, remove from tab order
  setTimeout(() => { startGate.style.display = 'none'; }, 500);
}

startGate.addEventListener('click', () => {
  // The click is the user gesture that unlocks autoplay for the SC widget.
  // Load a no-op track first (or just call widget.play() if anything's loaded)
  // to register the gesture, then kick off the queue.
  if (widget && widgetReady) {
    try { widget.play(); } catch { /* nothing loaded yet, that's fine */ }
  }
  dismissGate();
  // First refresh kicks off the chain polling
  refreshFromChain();
  setInterval(refreshFromChain, POLL_INTERVAL_MS);
});

// ─── Boot ───────────────────────────────────────────────────
// Init the widget immediately so it's ready when the gate is dismissed.
initWidget();
renderIdle();