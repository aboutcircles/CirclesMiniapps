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
 * `safeTransferFrom(payer, JUKEBOX_ADDRESS, crcTokenId, amount, "")`. Payment is
 * restricted to group CRC ("gCRC") from two approved groups; personal CRC and
 * other groups are rejected. The payer may hold that gCRC in native ERC-1155
 * form or wrapped as an ERC-20 — we count both, and if a wrapped balance is
 * needed we unwrap it to native in the same transaction bundle, so the payment
 * always lands as a single native TransferSingle. On-chain encoding:
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
  ACCEPTED_GROUP_ADDRESSES,
  ACCEPTED_TOKEN_IDS,
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

// Minimal ABI for unwrapping a Circles ERC-20 wrapper back to native ERC-1155
// CRC. Both wrapper kinds (demurraged and inflationary) expose the same
// `unwrap(uint256)`; the argument is the balance in the wrapper's own units.
// Used to free wrapped gCRC into native form in the same tx as the payment, so
// users never have to unwrap by hand.
const erc20UnwrapAbi = [{
  type: 'function',
  name: 'unwrap',
  inputs: [{ name: '_amount', type: 'uint256' }],
  outputs: [],
  stateMutability: 'nonpayable',
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

// True iff `rawId` is one of the two accepted group token ids. Accepts hex
// (balance.tokenId) or decimal (indexer `id` column) — both normalize via
// BigInt, so we never depend on string formatting.
function isAcceptedTokenId(rawId) {
  if (rawId === null || rawId === undefined || rawId === '') return false;
  try {
    const v = BigInt(rawId);
    return ACCEPTED_TOKEN_IDS.some(id => id === v);
  } catch {
    return false;
  }
}

// A balance row's issuing avatar is one of the approved groups. Used for the
// "unwrap" hint where the token id is the ERC-20 wrapper, not the group avatar,
// so we match on tokenOwner instead.
function isAcceptedGroupOwner(b) {
  const owner = b?.tokenOwner ? String(b.tokenOwner).toLowerCase() : '';
  return owner !== '' && ACCEPTED_GROUP_ADDRESSES.some(a => a.toLowerCase() === owner);
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

  // Gather the user's holdings of each approved group, counting native ERC-1155
  // and wrapped ERC-20 (demurraged or inflationary) together. Payment is
  // restricted to the two approved groups' gCRC; personal CRC and other groups
  // are ignored. `attoCircles` is the demurraged/par value for every form, so
  // it's directly comparable to amountWei and summable across forms. We always
  // *pay* in native CRC — any wrapped portion is unwrapped first, in the same tx
  // bundle, so the user never has to deal with wrap state. There is no auto-mint
  // and no pathfinding: payment can only ever move the user's own approved gCRC.
  setConfirmStatus('Looking up your group CRC balance…', 'info');

  let balances;
  try {
    balances = await getReadSdk().rpc.balance.getTokenBalances(user);
  } catch (err) {
    console.error('[jukebox] balance lookup failed:', err);
    throw new Error("Couldn't read your CRC balance — please try again.");
  }

  // owner(lowercase) -> { native, combined, wrapped: [{ tokenAddress, atto, raw }] }
  const groups = new Map();
  for (const b of (balances || [])) {
    if (Number(b.version) !== 2 || !isAcceptedGroupOwner(b)) continue;
    const owner = String(b.tokenOwner).toLowerCase();
    const slot = groups.get(owner) || { native: 0n, combined: 0n, wrapped: [] };
    const atto = BigInt(b.attoCircles);
    slot.combined += atto;
    if (b.isErc1155 && !b.isWrapped) {
      slot.native += atto;
    } else if (b.isWrapped) {
      // `raw` is this wrapper's full balance in its own units (the value to
      // pass to unwrap() to free all of it): demurraged == attoCircles (par),
      // inflationary == staticAttoCircles.
      slot.wrapped.push({
        tokenAddress: getAddress(b.tokenAddress),
        atto,
        isInflationary: !!b.isInflationary,
        raw: b.isInflationary ? BigInt(b.staticAttoCircles) : atto,
      });
    }
    groups.set(owner, slot);
  }

  // Pick the approved group with the most total CRC that covers the price.
  // Gating on the *combined* (native + wrapped) balance guarantees the unwrap
  // step below only ever frees the user's own gCRC, never spilling over to a
  // non-approved token.
  let chosenOwner = null;
  let chosen = null;
  for (const [owner, slot] of groups) {
    if (slot.combined < amountWei) continue;
    if (!chosen || slot.combined > chosen.combined) {
      chosenOwner = owner;
      chosen = slot;
    }
  }
  if (!chosen) {
    throw new Error('You need at least 10 CRC from one of the two approved Circles groups to play a song.');
  }
  // Native Hub V2 token id for this group == uint256(group avatar). After any
  // unwrap below, this is the token safeTransferFrom moves.
  const tokenId = BigInt(getAddress(chosenOwner));

  // If the native balance alone doesn't cover the price, unwrap approved-group
  // wrappers until it does. Demurraged wrappers come first (1:1 with native, so
  // we can unwrap just the shortfall and leave the rest wrapped); inflationary
  // wrappers are a fallback and get unwrapped in full, since their ERC-20 unit
  // is "static" and a partial amount would need an on-chain conversion. Any
  // leftover stays as native CRC. These calls are prepended to the payment so
  // the wallet asks for a single confirmation (one atomic Safe bundle).
  const prelude = [];
  if (chosen.native < amountWei) {
    setConfirmStatus('Preparing your CRC…', 'info');
    let running = chosen.native;
    const wrappers = chosen.wrapped.slice().sort((a, b) => {
      if (a.isInflationary !== b.isInflationary) return a.isInflationary ? 1 : -1;
      return b.atto > a.atto ? 1 : -1;
    });
    for (const w of wrappers) {
      if (running >= amountWei) break;
      const need = amountWei - running;
      // demurraged: unwrap just the shortfall (capped at this wrapper's balance);
      // inflationary: unwrap the whole balance (in its own static units).
      const amount = w.isInflationary || need >= w.atto ? w.raw : need;
      prelude.push({
        to: w.tokenAddress,
        data: encodeFunctionData({
          abi: erc20UnwrapAbi,
          functionName: 'unwrap',
          args: [amount],
        }),
        value: '0x0',
      });
      running += w.isInflationary || need >= w.atto ? w.atto : need;
    }
  }

  setConfirmStatus('Confirm the transaction in your wallet…', 'info');

  // Native ERC-1155 transfer: move exactly amountWei of the group's CRC to the
  // treasury. The Safe is both _from and msg.sender, so no operator approval is
  // needed. Bundled after any unwrap calls — sendTransactions runs the whole
  // array as one Safe tx (the native freed by unwrap is spendable by the
  // transfer in the same tx), and the on-chain TransferSingle carries amountWei
  // verbatim, so the songId decode on the reader/display side is unchanged.
  const payTx = {
    to: getAddress(HUB_V2_ADDRESS),
    data: encodeFunctionData({
      abi: hubV2Abi,
      functionName: 'safeTransferFrom',
      args: [user, getAddress(JUKEBOX_ADDRESS), tokenId, amountWei, '0x'],
    }),
    value: '0x0',
  };

  const hashes = await sendTransactions([...prelude, payTx]);
  if (!hashes || hashes.length === 0) {
    throw new Error('Wallet returned no transaction hash');
  }

  setConfirmStatus('Waiting for confirmation…', 'info');
  // The payment is the last call in the bundle; wait on the last returned hash
  // (one Safe tx → one hash, but stay robust if the bridge returns one per call).
  const receipt = await waitForReceipt(hashes[hashes.length - 1]);
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
  // We fetch the token `id` so we can keep only payments made with one of the
  // two approved groups' gCRC (ACCEPTED_TOKEN_IDS) — matching the pay path.
  // The treasury is a low-traffic org, so the membership check below is cheap.
  const rows = await circlesQuery(
    'TransferSingle',
    ['blockNumber', 'timestamp', 'transactionHash', 'logIndex', 'from', 'to', 'id', 'value'],
    [{ column: 'to', value: JUKEBOX_ADDRESS.toLowerCase() }],
    [{ Column: 'blockNumber', SortOrder: 'ASC' }],
    1000,
  );

  const entries = [];
  for (const row of rows) {
    try {
      // Reject anything not paid with an approved group token id.
      if (!isAcceptedTokenId(row.id)) continue;
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

// ─── Latest request bar ─────────────────────────────────────
// Shows the most recently *requested* song. This is NOT "now playing": with no
// channel from the display we can't know what's actually on the speakers, and
// the display plays the queue in order, so the newest request is the last thing
// that'll play. Labelled "Latest request" in the UI to stay truthful. Refreshes
// on the same cadence as the display (10s).
let nowPlayingPollTimer = null;

async function refreshNowPlaying() {
  try {
    const entries = await fetchQueueEntries();
    if (entries.length === 0) {
      nowPlayingBar.classList.add('hidden');
      return;
    }
    // The last entry in chronological order is the most recent request.
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
