/**
 * Circles Jukebox — miniapp main.js
 *
 * Browse a curated catalog of SoundCloud songs and pay 10 CRC to add one to
 * the global jukebox queue. The miniapp itself never plays audio — that's
 * the display device's job (the standalone `jukebox-display` app, kept in a
 * separate repo). This app only handles picking, paying, and showing recent
 * requests.
 *
 * Payment rail: a native Circles ERC-1155 transfer on Hub V2 —
 * `safeTransferFrom(payer, JUKEBOX_ADDRESS, crcTokenId, amount, "")`. The payer
 * spends whichever CRC they already hold (personal or group); we look up their
 * balances and pick a native v2 token with enough. On-chain encoding:
 * amount = 10e18 + songId wei. The display decodes the songId from each
 * incoming TransferSingle as `amount % SONG_ID_MOD`.
 */

// @ts-nocheck
import { onWalletChange, sendTransactions, isMiniappMode } from '@aboutcircles/miniapp-sdk';
import { Sdk } from '@aboutcircles/sdk';
import { hubV2Abi } from '@aboutcircles/sdk-abis';
import {
  getAddress,
  encodeFunctionData,
  createPublicClient,
  http,
} from 'viem';
import { gnosis } from 'viem/chains';
import songsCatalog from './songs.json';
import {
  RPC_URL,
  RPC_FALLBACKS,
  JUKEBOX_ADDRESS,
  HUB_V2_ADDRESS,
  BASE_AMOUNT_WEI,
  SONG_ID_MOD,
  START_BLOCK,
} from './constants.js';

// ─── DOM refs ───────────────────────────────────────────────
const badge = document.getElementById('badge');
const tabSongs = document.getElementById('tab-songs');
const tabQueue = document.getElementById('tab-queue');
const songsPanel = document.getElementById('songs-panel');
const queuePanel = document.getElementById('queue-panel');
const songList = document.getElementById('song-list');
const queueList = document.getElementById('queue-list');
const disconnectedHint = document.getElementById('disconnected-hint');
const confirmModal = document.getElementById('confirm-modal');
const nowPlayingBar = document.getElementById('now-playing');
const nowPlayingArt = document.getElementById('now-playing-art');
const nowPlayingTitle = document.getElementById('now-playing-title');
const nowPlayingArtist = document.getElementById('now-playing-artist');
const backToTopBtn = document.getElementById('back-to-top');
const confirmTitle = document.getElementById('confirm-title');
const confirmArtwork = document.getElementById('confirm-artwork');
const confirmSongTitle = document.getElementById('confirm-song-title');
const confirmSongArtist = document.getElementById('confirm-song-artist');
const confirmStatus = document.getElementById('confirm-status');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmProceed = document.getElementById('confirm-proceed');

// ─── State ──────────────────────────────────────────────────
let connectedAddress = null;
let pendingSong = null;
let isBusy = false;
const profileCache = new Map();

// ─── SDK (lazy) ─────────────────────────────────────────────
let _readSdk = null;
function getReadSdk() {
  if (!_readSdk) _readSdk = new Sdk();
  return _readSdk;
}

// ─── viem clients (for getLogs + receipt polling) ───────────
const rpcClients = RPC_FALLBACKS.map(url =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

// ─── ABI ────────────────────────────────────────────────────
// Native Circles Hub V2 (ERC-1155). We only need `safeTransferFrom`, encoded
// from the canonical SDK ABI (@aboutcircles/sdk-abis) so it can't drift. The
// payer's balances come from the SDK's indexer (sdk.rpc.balance), not raw
// balanceOf, so we can pick from any CRC they hold.

// ─── Helpers ────────────────────────────────────────────────
function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

function showToast(message, type = 'info', durationMs = 4000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

function songById(id) {
  return songsCatalog.find(s => s.id === id);
}

function shortAddress(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

// ─── Tab switching ──────────────────────────────────────────
function selectTab(which) {
  const isSongs = which === 'songs';
  tabSongs.classList.toggle('active', isSongs);
  tabQueue.classList.toggle('active', !isSongs);
  tabSongs.setAttribute('aria-selected', String(isSongs));
  tabQueue.setAttribute('aria-selected', String(!isSongs));
  songsPanel.classList.toggle('hidden', !isSongs);
  queuePanel.classList.toggle('hidden', isSongs);
  if (!isSongs) refreshQueue();
}

tabSongs.addEventListener('click', () => selectTab('songs'));
tabQueue.addEventListener('click', () => selectTab('queue'));

// ─── Render: song catalog ───────────────────────────────────
function renderSongList() {
  songList.innerHTML = '';
  for (const song of songsCatalog) {
    const card = document.createElement('div');
    card.className = 'song-card';
    if (!connectedAddress) card.classList.add('disabled');
    card.innerHTML = `
      <img class="song-artwork" src="${song.artworkUrl}" alt="" />
      <div class="song-meta">
        <div class="song-title">${escapeHtml(song.title)}</div>
        <div class="song-artist">${escapeHtml(song.artist)}</div>
      </div>
      <div class="song-price">10 CRC</div>
    `;
    card.addEventListener('click', () => {
      if (!connectedAddress) {
        showToast('Connect via the Circles wallet to pay for a song.', 'info');
        return;
      }
      openConfirm(song);
    });
    songList.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ─── Confirmation modal ────────────────────────────────────
function openConfirm(song) {
  pendingSong = song;
  confirmTitle.textContent = 'Play this song?';
  confirmArtwork.src = song.artworkUrl;
  confirmSongTitle.textContent = song.title;
  confirmSongArtist.textContent = song.artist;
  confirmStatus.classList.add('hidden');
  confirmStatus.textContent = '';
  confirmStatus.className = 'confirm-status hidden';
  confirmProceed.disabled = false;
  confirmProceed.textContent = 'Pay 10 CRC';
  confirmCancel.disabled = false;
  confirmModal.classList.remove('hidden');
}

function closeConfirm() {
  if (isBusy) return;
  confirmModal.classList.add('hidden');
  pendingSong = null;
}

confirmCancel.addEventListener('click', closeConfirm);
confirmModal.querySelector('.modal-backdrop').addEventListener('click', closeConfirm);

function setConfirmStatus(text, type = 'info') {
  confirmStatus.textContent = text;
  confirmStatus.className = `confirm-status ${type}`;
  confirmStatus.classList.remove('hidden');
}

confirmProceed.addEventListener('click', async () => {
  if (isBusy || !pendingSong) return;
  const song = pendingSong;

  isBusy = true;
  confirmProceed.disabled = true;
  confirmCancel.disabled = true;
  confirmProceed.textContent = 'Sending…';
  setConfirmStatus('Looking up your CRC balance…', 'info');

  try {
    await payForSong(song);

    setConfirmStatus(`Queued! "${song.title}" added to the jukebox.`, 'success');
    confirmProceed.textContent = 'Done';
    showToast(`"${song.title}" added to queue ✨`, 'success');

    setTimeout(() => {
      isBusy = false;
      confirmProceed.disabled = false;
      confirmCancel.disabled = false;
      confirmModal.classList.add('hidden');
      pendingSong = null;
      refreshQueue();
    }, 1800);
  } catch (err) {
    console.error('[jukebox] payment failed:', err);
    setConfirmStatus(`Failed: ${decodeError(err)}`, 'error');
    confirmProceed.textContent = 'Try again';
    isBusy = false;
    confirmProceed.disabled = false;
    confirmCancel.disabled = false;
  }
});

// ─── Payment flow ───────────────────────────────────────────
async function payForSong(song) {
  if (!connectedAddress) throw new Error('Wallet not connected');

  const user = getAddress(connectedAddress);
  // amount = 10·10^18 + songId. The songId rides in the low bits; the display
  // decodes it as amount % 10000. This is the exact value transferred — the
  // Hub emits TransferSingle with this value verbatim.
  const amountWei = BASE_AMOUNT_WEI + BigInt(song.id);

  // Pick a native Hub V2 CRC token the user actually holds. We accept personal
  // OR group CRC — any unwrapped v2 ERC-1155 token. Native balances are
  // demurraged 1:1, so `attoCircles` (the demurraged balance, == on-chain
  // balanceOf) is directly comparable to amountWei and is the unit
  // safeTransferFrom moves. There is no auto-mint.
  setConfirmStatus('Looking up your CRC balance…', 'info');

  let balances;
  try {
    balances = await getReadSdk().rpc.balance.getTokenBalances(user);
  } catch (err) {
    console.error('[jukebox] balance lookup failed:', err);
    throw new Error("Couldn't read your CRC balance — please try again.");
  }

  const candidates = (balances || []).filter(b =>
    b.isErc1155 && !b.isWrapped && Number(b.version) === 2 &&
    BigInt(b.attoCircles) >= amountWei
  );
  // Spend the largest balance first — avoids a demurrage rounding edge where a
  // just-enough balance dips below the price between this read and execution.
  candidates.sort((a, b) =>
    BigInt(b.attoCircles) > BigInt(a.attoCircles) ? 1 : -1
  );
  const chosen = candidates[0];
  if (!chosen) {
    // If they hold enough but it's wrapped as an ERC-20, the native transfer
    // can't reach it — point them at unwrapping rather than a generic error.
    const hasWrapped = (balances || []).some(b =>
      b.isWrapped && BigInt(b.attoCircles) >= amountWei
    );
    if (hasWrapped) {
      throw new Error('Your CRC is wrapped as an ERC-20. Unwrap it to native CRC in your wallet, then try again.');
    }
    throw new Error('You need at least 10 CRC (personal or group) to play a song.');
  }
  const tokenId = BigInt(chosen.tokenId);

  setConfirmStatus('Confirm the transaction in your wallet…', 'info');

  // Native ERC-1155 transfer: move exactly amountWei of the chosen CRC to the
  // treasury. One sendTransactions call = one Safe tx; the Safe is both _from
  // and msg.sender, so no operator approval is needed.
  const hashes = await sendTransactions([{
    to: getAddress(HUB_V2_ADDRESS),
    data: encodeFunctionData({
      abi: hubV2Abi,
      functionName: 'safeTransferFrom',
      args: [user, getAddress(JUKEBOX_ADDRESS), tokenId, amountWei, '0x'],
    }),
    value: '0x0',
  }]);
  if (!hashes || hashes.length === 0) {
    throw new Error('Wallet returned no transaction hash');
  }

  setConfirmStatus('Waiting for confirmation…', 'info');
  const receipt = await waitForReceipt(hashes[0]);
  if (receipt.status !== 'success') {
    throw new Error('Transaction reverted on-chain');
  }
}

async function waitForReceipt(hash) {
  const POLL_MS = 3000;
  const TIMEOUT_MS = 5 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const client of rpcClients) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        if (r) return r;
      } catch { /* try next */ }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error('Timed out waiting for transaction');
}

// ─── Queue rendering ────────────────────────────────────────
async function refreshQueue() {
  queueList.innerHTML = '<div class="queue-empty">Loading queue…</div>';
  try {
    const entries = await fetchQueueEntries();
    if (entries.length === 0) {
      queueList.innerHTML = '<div class="queue-empty">No requests yet. Be the first 🎶</div>';
      return;
    }
    queueList.innerHTML = '';
    // Most recent first, cap at 50.
    const top = entries.slice(-50).reverse();
    for (let i = 0; i < top.length; i++) {
      const entry = top[i];
      const row = await renderQueueRow(entry, i + 1);
      queueList.appendChild(row);
    }
  } catch (err) {
    console.error('[jukebox] queue load failed:', err);
    queueList.innerHTML = `<div class="queue-empty">Couldn't load queue: ${escapeHtml(decodeError(err))}</div>`;
  }
}

// Query the Circles indexer instead of raw eth_getLogs. The indexer has no
// block-range limit (raw getLogs over millions of blocks is rejected by every
// public Gnosis RPC). `value` on the TransferSingle table is the raw on-chain
// uint256, so the songId-in-low-bits decode below is exact.
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
  // All native ERC-1155 (TransferSingle) payments received by the treasury org.
  // Any avatar's CRC counts — native balances are demurraged 1:1, so there is
  // no token allowlist; the 10 CRC base-price check below is the only filter
  // that matters (the treasury is a low-traffic org, so the set is tiny).
  const rows = await circlesQuery(
    'TransferSingle',
    ['blockNumber', 'timestamp', 'transactionHash', 'logIndex', 'from', 'to', 'value'],
    [{ column: 'to', value: JUKEBOX_ADDRESS.toLowerCase() }],
    [{ Column: 'blockNumber', SortOrder: 'ASC' }],
    1000,
  );

  const entries = [];
  for (const row of rows) {
    try {
      const value = BigInt(row.value);
      const songId = Number(value % SONG_ID_MOD);
      const base = value - (value % SONG_ID_MOD);
      // Only accept payments that round to the 10 CRC base price.
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
    } catch {
      // skip malformed row
    }
  }
  // Stable chronological order.
  entries.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    return a.logIndex - b.logIndex;
  });
  return entries;
}

async function renderQueueRow(entry, position) {
  const row = document.createElement('div');
  row.className = 'queue-row';

  const profile = await getProfile(entry.from);
  const displayName = profile?.name || profile?.registeredName || shortAddress(entry.from);
  const avatarUrl = profile?.previewImageUrl || profile?.imageUrl;

  row.innerHTML = `
    <div class="queue-position">#${position}</div>
    <img class="queue-artwork" src="${entry.song.artworkUrl}" alt="" />
    <div class="queue-info">
      <div class="queue-song">${escapeHtml(entry.song.title)} <span style="color:var(--muted);font-weight:400">· ${escapeHtml(entry.song.artist)}</span></div>
      <div class="queue-attribution">
        ${avatarUrl
          ? `<img class="queue-avatar" src="${escapeHtml(avatarUrl)}" alt="" />`
          : `<span class="queue-avatar"></span>`}
        <span>queued by ${escapeHtml(displayName)}</span>
      </div>
    </div>
  `;
  return row;
}

async function getProfile(address) {
  const key = address.toLowerCase();
  if (profileCache.has(key)) return profileCache.get(key);
  const sdk = getReadSdk();
  let profile = null;
  try {
    profile = await sdk.rpc.profile.getProfileByAddress(address);
  } catch {
    try {
      profile = await sdk.rpc.profile.getProfileByAddress(address.toLowerCase());
    } catch { /* still null */ }
  }
  profileCache.set(key, profile);
  return profile;
}

// ─── Wallet connection ──────────────────────────────────────
onWalletChange((address) => {
  if (!address) {
    connectedAddress = null;
    badge.textContent = 'Not connected';
    badge.className = 'badge badge-disconnected';
    disconnectedHint.classList.remove('hidden');
    renderSongList();
    return;
  }
  connectedAddress = getAddress(address);
  badge.textContent = 'Connected';
  badge.className = 'badge badge-connected';
  disconnectedHint.classList.add('hidden');
  renderSongList();
});

// ─── Now playing bar ────────────────────────────────────────
// Polls the same queue data the display uses, shows the most recent entry
// as "now playing". Refreshes on the same cadence as the display (10s).
let nowPlayingPollTimer = null;

async function refreshNowPlaying() {
  try {
    const entries = await fetchQueueEntries();
    if (entries.length === 0) {
      nowPlayingBar.classList.add('hidden');
      return;
    }
    // The last entry in chronological order is the most recent request.
    // The display plays them in order, so this is the current (or next) track.
    const latest = entries[entries.length - 1];
    nowPlayingArt.src = latest.song.artworkUrl;
    nowPlayingTitle.textContent = latest.song.title;
    nowPlayingArtist.textContent = latest.song.artist;
    nowPlayingBar.classList.remove('hidden');
  } catch {
    // Silently hide on error — not critical.
    nowPlayingBar.classList.add('hidden');
  }
}

// ─── Back to top button ────────────────────────────────────
// Shows when the page is scrolled past 300px, scrolls to top on click.
let scrollRaf = null;
window.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    if (window.scrollY > 300) {
      backToTopBtn.classList.remove('hidden');
    } else {
      backToTopBtn.classList.add('hidden');
    }
    scrollRaf = null;
  });
}, { passive: true });

backToTopBtn.addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// ─── Init ───────────────────────────────────────────────────
renderSongList();
refreshQueue();
refreshNowPlaying();
nowPlayingPollTimer = setInterval(refreshNowPlaying, 10_000);

if (!isMiniappMode()) {
  console.warn('[jukebox] Not running inside the Circles MiniApp host.');
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div style="background:#fff9ea;padding:8px 16px;font-size:12px;text-align:center;border-bottom:1px solid #eee7e2">' +
    '⚠️ Standalone mode — payments require the Circles wallet host. ' +
    'You can still browse the catalog and view the queue.</div>'
  );
}
