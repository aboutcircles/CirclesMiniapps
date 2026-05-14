/**
 * Circles Jukebox — miniapp main.js
 *
 * Browse a curated catalog of SoundCloud songs and pay 10 CRC to add one to
 * the global jukebox queue. The miniapp itself never plays audio — that's
 * the display device's job (examples/jukebox-display/). This app only handles
 * picking, paying, and showing recent requests.
 *
 * On-chain encoding: amount = 10e18 + songId wei. Decoder reads
 * `amount % SONG_ID_MOD` to recover the songId.
 */

// @ts-nocheck
import { onWalletChange, sendTransactions, isMiniappMode } from '@aboutcircles/miniapp-sdk';
import { Sdk } from '@aboutcircles/sdk';
import {
  getAddress,
  encodeFunctionData,
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
  BASE_AMOUNT_WEI,
  SONG_ID_MOD,
  TRANSFER_EVENT_TOPIC,
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

// ─── ABIs ───────────────────────────────────────────────────
const ERC20_TRANSFER_ABI = [{
  type: 'function',
  name: 'transfer',
  inputs: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}];

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
  setConfirmStatus('Looking up your wrapped CRC…', 'info');

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

  // 1. Find a wrapped CRC token the user holds.
  const sdk = getReadSdk();
  const balances = await sdk.rpc.balance.getTokenBalances(connectedAddress);
  if (!balances || balances.length === 0) {
    throw new Error('No CRC balance found on this wallet');
  }
  const wrapped = balances.filter(b => b.isWrapped);
  if (wrapped.length === 0) {
    throw new Error('You need wrapped CRC to pay. Wrap some in the Circles wallet first.');
  }

  // Pick the wrapper with the largest balance — best chance of covering 10 CRC.
  wrapped.sort((a, b) => {
    const av = BigInt(a.attoCircles || a.staticAttoCircles || '0');
    const bv = BigInt(b.attoCircles || b.staticAttoCircles || '0');
    return bv > av ? 1 : bv < av ? -1 : 0;
  });
  const picked = wrapped[0];
  const wrapperAddress = getAddress(picked.tokenAddress);

  // 2. Encode amount = 10e18 + songId.
  const amountWei = BASE_AMOUNT_WEI + BigInt(song.id);

  const haveWei = BigInt(picked.attoCircles || picked.staticAttoCircles || '0');
  if (haveWei < amountWei) {
    throw new Error('Not enough wrapped CRC to cover 10 CRC');
  }

  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [getAddress(JUKEBOX_ADDRESS), amountWei],
  });

  setConfirmStatus('Confirm the transaction in your wallet…', 'info');

  // 3. Send via the host bridge.
  const hashes = await sendTransactions([{
    to: wrapperAddress,
    data,
    value: '0x0',
  }]);

  if (!hashes || hashes.length === 0) {
    throw new Error('Wallet returned no transaction hash');
  }

  // 4. Wait for confirmation.
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

async function fetchQueueEntries() {
  // Filter Transfer events with `to = JUKEBOX_ADDRESS`. No address filter so
  // we capture transfers across every wrapped CRC contract the senders hold.
  const toTopic = pad(getAddress(JUKEBOX_ADDRESS), { size: 32 }).toLowerCase();

  for (const client of rpcClients) {
    try {
      const latest = await client.getBlockNumber();
      const logs = await client.getLogs({
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
          // Only accept payments that round to the 10 CRC base price.
          if (base !== BASE_AMOUNT_WEI) continue;
          const song = songById(songId);
          if (!song) continue;
          // topics[1] is the indexed `from`.
          const fromHex = '0x' + log.topics[1].slice(26);
          entries.push({
            song,
            from: getAddress(fromHex),
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
          });
        } catch {
          // skip malformed log
        }
      }
      // Stable chronological order.
      entries.sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) {
          return a.blockNumber < b.blockNumber ? -1 : 1;
        }
        return a.logIndex - b.logIndex;
      });
      return entries;
    } catch (err) {
      console.warn('[jukebox] getLogs failed on RPC, trying next:', decodeError(err));
    }
  }
  throw new Error('All RPCs failed to return queue logs');
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

// ─── Init ───────────────────────────────────────────────────
renderSongList();
refreshQueue();

if (!isMiniappMode()) {
  console.warn('[jukebox] Not running inside the Circles MiniApp host.');
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div style="background:#fff9ea;padding:8px 16px;font-size:12px;text-align:center;border-bottom:1px solid #eee7e2">' +
    '⚠️ Standalone mode — payments require the Circles wallet host. ' +
    'You can still browse the catalog and view the queue.</div>'
  );
}
