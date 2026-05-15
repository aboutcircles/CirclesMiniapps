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
import {
  getAddress,
  createPublicClient,
  http,
  pad,
} from 'viem';
import { gnosis } from 'viem/chains';
import songsCatalog from './songs.json';
import {
  RPC_URL,
  RPC_FALLBACKS,
  JUKEBOX_ADDRESS,
  ACCEPTED_TOKEN_ADDRESS,
  BASE_AMOUNT_WEI,
  SONG_ID_MOD,
  TRANSFER_EVENT_TOPIC,
  START_BLOCK,
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
const profileCache = new Map();

// ─── SDK + RPC ──────────────────────────────────────────────
let _readSdk = null;
function getReadSdk() {
  if (!_readSdk) _readSdk = new Sdk();
  return _readSdk;
}
const rpcClients = RPC_FALLBACKS.map(url =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

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
async function fetchQueueEntries() {
  const toTopic = pad(getAddress(JUKEBOX_ADDRESS), { size: 32 }).toLowerCase();

  for (const client of rpcClients) {
    try {
      const latest = await client.getBlockNumber();
      const logs = await client.getLogs({
        address: ACCEPTED_TOKEN_ADDRESS,
        fromBlock: START_BLOCK,
        toBlock: latest,
        topics: [TRANSFER_EVENT_TOPIC, null, toTopic],
      });

      const entries = [];
      for (const log of logs) {
        try {
          const value = BigInt(log.data);
          const songId = Number(value % SONG_ID_MOD);
          const base = value - (value % SONG_ID_MOD);
          if (base !== BASE_AMOUNT_WEI) continue;
          const song = songById(songId);
          if (!song) continue;
          const fromHex = '0x' + log.topics[1].slice(26);
          entries.push({
            song,
            from: getAddress(fromHex),
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          });
        } catch {
          /* skip */
        }
      }

      entries.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber < b.blockNumber ? -1 : 1;
        }
        return a.logIndex - b.logIndex;
      });
      return entries;
    } catch (err) {
      console.warn('[display] getLogs failed, trying next RPC:', err);
    }
  }
  throw new Error('All RPCs failed');
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
    setStatus('live', `${entries.length} requests on-chain`);

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
  if (!widgetReady) return;
  const next = currentIndex + 1;
  if (next < allEntries.length) {
    playEntry(next);
  }
}

function onSongEnded() {
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
