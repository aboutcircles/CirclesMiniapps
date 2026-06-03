/**
 * Circles Jukebox — display main.js
 *
 * Standalone webpage you open on a laptop wired to the venue's TV and
 * speakers. Polls the chain for incoming 10 CRC payments to JUKEBOX_ADDRESS,
 * decodes the songId from each transfer amount, plays each request in
 * chronological order via the SoundCloud Widget API, and renders the
 * "now playing" + "up next" UI.
 *
 * State that survives a reload (so the queue resumes correctly) lives in
 * localStorage under PLAYHEAD_KEY: the txHash of the most recently completed
 * song. On boot the display advances past anything already played.
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
} from './constants.js';

// ─── DOM refs ───────────────────────────────────────────────
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const nowArt = document.getElementById('now-playing-art');
const nowTitle = document.getElementById('now-playing-title');
const nowArtist = document.getElementById('now-playing-artist');
const nowAttribution = document.getElementById('now-playing-attribution');
const upNextList = document.getElementById('up-next-list');
const widgetIframe = document.getElementById('sc-widget');

// ─── State ──────────────────────────────────────────────────
let allEntries = []; // chronologically sorted
let currentIndex = -1;
let widget = null;
let widgetReady = false;
let isPlaying = false; // guard so poll doesn't interrupt a playing song
const profileCache = new Map();

// ─── SDK + RPC ──────────────────────────────────────────────
let _readSdk = null;
function getReadSdk() {
  if (!_readSdk) _readSdk = new Sdk();
  return _readSdk;
}

// ─── Helpers ────────────────────────────────────────────────
function songById(id) {
  return songsCatalog.find(s => s.id === id);
}

function shortAddress(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function setStatus(state, text) {
  statusDot.classList.remove('live', 'error');
  if (state === 'live') statusDot.classList.add('live');
  if (state === 'error') statusDot.classList.add('error');
  statusText.textContent = text;
}

// ─── SoundCloud Widget API setup ────────────────────────────
function initWidget() {
  if (typeof SC === 'undefined') {
    setStatus('error', 'SoundCloud Widget API failed to load');
    return;
  }
  widget = SC.Widget(widgetIframe);
  widget.bind(SC.Widget.Events.READY, () => {
    widgetReady = true;
    // Once the widget is ready, try to start the queue.
    advanceIfIdle();
  });
  widget.bind(SC.Widget.Events.FINISH, () => {
    onSongEnded();
  });
  widget.bind(SC.Widget.Events.ERROR, (e) => {
    console.warn('[display] SoundCloud widget error:', e);
    // Skip ahead so a broken song doesn't lock the queue.
    onSongEnded();
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
  });
}

// ─── Playhead persistence ───────────────────────────────────
function loadPlayhead() {
  try {
    return localStorage.getItem(PLAYHEAD_KEY) || null;
  } catch {
    return null;
  }
}

function savePlayhead(txHash) {
  try {
    if (txHash) localStorage.setItem(PLAYHEAD_KEY, txHash);
  } catch { /* ignore */ }
}

// ─── Queue fetching ─────────────────────────────────────────
// Reads the Circles indexer (no block-range limit, unlike raw eth_getLogs
// which every public Gnosis RPC rejects over millions of blocks). The
// `amount` column is the raw on-chain uint256, so the songId-in-low-bits
// decode is exact.
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
  if (json.error) {
    throw new Error(json.error.message || 'circles_query failed');
  }
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
      const song = songById(songId);
      if (!song) continue;
      entries.push({
        song,
        from: getAddress(row.from),
        txHash: row.transactionHash,
        blockNumber: Number(row.blockNumber),
        logIndex: Number(row.logIndex),
      });
    } catch {
      /* skip malformed row */
    }
  }

  entries.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.logIndex - b.logIndex;
  });
  return entries;
}

// ─── Profile lookup with caching ────────────────────────────
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

// ─── Playback orchestration ─────────────────────────────────
async function refreshFromChain() {
  try {
    const entries = await fetchQueueEntries();
    allEntries = entries;
        const played = currentIndex + 1;
        const remaining = entries.length - played;
        setStatus('live', remaining > 0 ? `${remaining} queued` : 'Queue empty');

    // On first load, align currentIndex with the saved playhead.
    if (currentIndex === -1) {
      const saved = loadPlayhead();
      if (saved) {
        const i = entries.findIndex(e => e.txHash.toLowerCase() === saved.toLowerCase());
        // currentIndex points to the most recently *played* entry; we advance
        // to the next one in advanceIfIdle().
        currentIndex = i >= 0 ? i : -1;
      }
    }

    renderUpNext();
    advanceIfIdle();
  } catch (err) {
    console.error('[display] refresh failed:', err);
    setStatus('error', 'RPC unavailable');
  }
}

function advanceIfIdle() {
  if (!widgetReady || isPlaying) return;
  const next = currentIndex + 1;
  if (next < allEntries.length) {
    playEntry(next);
  }
}

function onSongEnded() {
  isPlaying = false;
  if (currentIndex >= 0 && currentIndex < allEntries.length) {
    savePlayhead(allEntries[currentIndex].txHash);
  }
  if (currentIndex + 1 < allEntries.length) {
    playEntry(currentIndex + 1);
  } else {
    // Nothing more to play — go idle and wait for the next poll.
    currentIndex = allEntries.length - 1;
    renderIdle();
    renderUpNext();
  }
}

async function playEntry(index) {
  currentIndex = index;
  isPlaying = true;
  const entry = allEntries[index];
  if (!entry) return;

  await renderNowPlaying(entry);
  renderUpNext();
  loadAndPlay(entry.song.soundcloudUrl);
}

async function renderNowPlaying(entry) {
  nowArt.src = entry.song.artworkUrl;
  nowTitle.textContent = entry.song.title;
  nowArtist.textContent = entry.song.artist;
  nowAttribution.innerHTML = '<span>loading…</span>';

  const profile = await getProfile(entry.from);
  const name = profile?.name || profile?.registeredName || shortAddress(entry.from);
  const avatar = profile?.previewImageUrl || profile?.imageUrl;
  nowAttribution.innerHTML = `
    ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : ''}
    <span>queued by ${escapeHtml(name)}</span>
  `;
}

function renderIdle() {
  nowArt.src = '/idle-art.jpg';
  nowTitle.textContent = 'Waiting for a request…';
  nowArtist.textContent = '';
  nowAttribution.innerHTML = '<span>Be the first to pay 10 CRC in the Jukebox miniapp</span>';
}

async function renderUpNext() {
  const upcoming = allEntries.slice(currentIndex + 1, currentIndex + 1 + 8);
  if (upcoming.length === 0) {
    upNextList.innerHTML =
      '<div class="up-next-empty">Queue empty — pay 10 CRC in the Circles Jukebox miniapp to queue a song.</div>';
    return;
  }
  upNextList.innerHTML = '';
  for (const entry of upcoming) {
    const row = document.createElement('div');
    row.className = 'up-next-row';
    const profile = await getProfile(entry.from);
    const name = profile?.name || profile?.registeredName || shortAddress(entry.from);
    const avatar = profile?.previewImageUrl || profile?.imageUrl;
    row.innerHTML = `
      <img class="up-next-art" src="${escapeHtml(entry.song.artworkUrl)}" alt="" />
      <div class="up-next-info">
        <div class="up-next-song">${escapeHtml(entry.song.title)} <span style="color:var(--muted);font-weight:400">· ${escapeHtml(entry.song.artist)}</span></div>
        <div class="up-next-attribution">
          ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : ''}
          <span>${escapeHtml(name)}</span>
        </div>
      </div>
    `;
    upNextList.appendChild(row);
  }
}

// ─── Boot ───────────────────────────────────────────────────
function start() {
  setStatus('idle', 'Loading queue…');
  renderIdle();
  initWidget();
  refreshFromChain();
  setInterval(refreshFromChain, POLL_INTERVAL_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
