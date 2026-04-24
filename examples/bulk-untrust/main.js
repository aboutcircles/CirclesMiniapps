import { onWalletChange, sendTransactions, isMiniappMode } from './miniapp-sdk.js';
import { Sdk } from '@aboutcircles/sdk';
import { createPublicClient, http, getAddress, encodeFunctionData, parseAbiItem } from 'viem';
import { gnosis } from 'viem/chains';

// ── Constants ──────────────────────────────────────────────────────────────
const HUB_V2 = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';

const TRUST_ABI = [{
  type: 'function',
  name: 'trust',
  inputs: [
    { name: '_canSendTo', type: 'address' },
    { name: '_expiry', type: 'uint96' },
  ],
  outputs: [],
}];

const SCORE_API = 'https://squid-app-3gxnl.ondigitalocean.app/aboutcircles-advanced-analytics2/scoring/relative_trustscore';

const RPC_FALLBACK_URLS = [
  'https://rpc.aboutcircles.com/',
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

const ENTRYPOINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const LOOKBACK = 5000n;
const POLL_MS = 3000;
const TIMEOUT_MS = 12 * 60 * 1000;

// ── SDK & RPC clients ──────────────────────────────────────────────────────
const sdk = new Sdk('https://rpc.aboutcircles.com/', null);

const receiptClients = RPC_FALLBACK_URLS.map(url =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

// ── App state ──────────────────────────────────────────────────────────────
let connectedAddress = null;
let entries = [];
let sortKey = 'date';
let sortAsc = false;
let filterMinScore = 0;
let filterFromDate = null;
let filterToDate = null;
let filterTypes = new Set();

// ── Receipt polling (Pattern F) ────────────────────────────────────────────
async function waitForReceipts(hashes) {
  return Promise.all(hashes.map(waitForReceiptFromAnyRpc));
}

async function waitForReceiptFromAnyRpc(hash) {
  const deadline = Date.now() + TIMEOUT_MS;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    for (const client of receiptClients) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        if (r) return r;
      } catch {}
    }
    if (round % 2 === 0) {
      for (const client of receiptClients) {
        const r = await tryResolveUserOp(client, hash);
        if (r) return r;
      }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for ${hash}`);
}

async function tryResolveUserOp(client, userOpHash) {
  try {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > LOOKBACK ? latest - LOOKBACK : 0n;
    const logs = await client.getLogs({
      address: ENTRYPOINT,
      event: parseAbiItem(
        'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
      ),
      args: { userOpHash },
      fromBlock,
      toBlock: latest,
    });
    if (logs.length > 0) {
      return await client.getTransactionReceipt({ hash: logs.at(-1).transactionHash });
    }
  } catch {}
  return null;
}

// ── Error helpers ──────────────────────────────────────────────────────────
function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

function isPasskeyError(err) {
  const msg = decodeError(err).toLowerCase();
  return (
    msg.includes('passkey') ||
    msg.includes('auto connect') ||
    (msg.includes('wallet address') && msg.includes('retrieve'))
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', ms = 4000) {
  document.querySelector('.toast')?.remove();
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ── UI helpers ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showView(id) {
  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatDate(unixSecs) {
  if (!unixSecs) return '';
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function scoreClass(score) {
  if (score >= 70) return 'score-high';
  if (score >= 30) return 'score-mid';
  return 'score-low';
}

// ── Stats bar ──────────────────────────────────────────────────────────────
function updateStats() {
  $('total-count').textContent = entries.length;
  $('mutual-count').textContent = entries.filter(e => e.isMutual).length;
  $('selected-count').textContent = entries.filter(e => e.selected).length;
}

// ── Sort + filter ──────────────────────────────────────────────────────────
function getFilteredSorted() {
  let list = entries.filter(e => {
    if (filterMinScore > 0) {
      if (e.trustScore === null) return true; // still loading — keep
      if (e.trustScore < 0 || e.trustScore < filterMinScore) return false;
    }
    if (filterFromDate && e.timestamp * 1000 < filterFromDate.getTime()) return false;
    if (filterToDate && e.timestamp * 1000 > filterToDate.getTime()) return false;
    if (filterTypes.size > 0 && !filterTypes.has(e.avatarType)) return false;
    return true;
  });

  list.sort((a, b) => {
    let v = 0;
    if (sortKey === 'date') v = a.timestamp - b.timestamp;
    else if (sortKey === 'score') {
      const sa = a.trustScore ?? -2;
      const sb = b.trustScore ?? -2;
      v = sa - sb;
    } else if (sortKey === 'name') {
      v = a.name.localeCompare(b.name);
    }
    return sortAsc ? v : -v;
  });

  return list;
}

// ── Render list ────────────────────────────────────────────────────────────
function renderRow(entry) {
  const scoreInner = entry.trustScore === null
    ? '<span class="score-loading">…</span>'
    : entry.trustScore < 0
      ? '<span class="score-na">N/A</span>'
      : `<span class="score-val ${scoreClass(entry.trustScore)}">${Math.round(entry.trustScore)}</span>`;

  const avatarStyle = entry.avatarImgUrl ? `style="background-image:url('${escHtml(entry.avatarImgUrl)}')"` : '';
  const avatarInitial = !entry.avatarImgUrl ? `<span>${escHtml((entry.name[0] || '?').toUpperCase())}</span>` : '';

  return `<label class="trust-row${entry.selected ? ' selected' : ''}" data-addr="${entry.address}">
  <input type="checkbox" class="row-check"${entry.selected ? ' checked' : ''} />
  <div class="trust-avatar" data-addr="${entry.address}" ${avatarStyle}>${avatarInitial}</div>
  <div class="trust-info">
    <div class="trust-name" data-addr="${entry.address}">${escHtml(entry.name)}</div>
    <div class="trust-meta">
      ${entry.isMutual ? '<span class="badge-mutual">mutual</span>' : ''}
      <span class="trust-type">${escHtml(entry.avatarType)}</span>
      <span class="trust-date">${formatDate(entry.timestamp)}</span>
    </div>
  </div>
  <div class="trust-score" data-addr="${entry.address}">${scoreInner}</div>
</label>`;
}

function attachRowListeners(listEl) {
  listEl.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const addr = cb.closest('.trust-row').dataset.addr;
      const entry = entries.find(e => e.address === addr);
      if (!entry) return;
      entry.selected = cb.checked;
      cb.closest('.trust-row').classList.toggle('selected', cb.checked);
      updateActionBar();
      updateStats();
    });
  });
}

function renderList() {
  const filtered = getFilteredSorted();
  const listEl = $('trust-list');
  const emptyEl = $('empty-state');

  if (filtered.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
  } else {
    emptyEl.classList.add('hidden');
    listEl.innerHTML = filtered.map(renderRow).join('');
    attachRowListeners(listEl);
  }

  updateActionBar();
  updateSelectRow();
}

function updateSelectRow() {
  const filtered = getFilteredSorted();
  const allSelected = filtered.length > 0 && filtered.every(e => e.selected);
  const selectBtn = $('select-all-btn');
  if (selectBtn) selectBtn.textContent = `Select all visible (${filtered.length})`;
}

// ── In-place row updates (for lazy loading) ────────────────────────────────
function updateRowName(entry) {
  const nameEl = document.querySelector(`.trust-name[data-addr="${entry.address}"]`);
  if (nameEl) nameEl.textContent = entry.name;

  const avatarEl = document.querySelector(`.trust-avatar[data-addr="${entry.address}"]`);
  if (avatarEl && entry.avatarImgUrl) {
    avatarEl.style.backgroundImage = `url('${entry.avatarImgUrl}')`;
    avatarEl.innerHTML = '';
  } else if (avatarEl) {
    avatarEl.innerHTML = `<span>${escHtml((entry.name[0] || '?').toUpperCase())}</span>`;
  }
}

function updateRowScore(entry) {
  const scoreEl = document.querySelector(`.trust-score[data-addr="${entry.address}"]`);
  if (!scoreEl) return;
  if (entry.trustScore === null) {
    scoreEl.innerHTML = '<span class="score-loading">…</span>';
  } else if (entry.trustScore < 0) {
    scoreEl.innerHTML = '<span class="score-na">N/A</span>';
  } else {
    scoreEl.innerHTML = `<span class="score-val ${scoreClass(entry.trustScore)}">${Math.round(entry.trustScore)}</span>`;
  }
}

// ── Action bar ─────────────────────────────────────────────────────────────
function updateActionBar() {
  const selected = entries.filter(e => e.selected);
  const bar = $('action-bar');
  const summary = $('action-summary');
  const btn = $('untrust-btn');

  if (selected.length === 0) {
    bar.classList.add('hidden');
    return;
  }

  bar.classList.remove('hidden');
  const mutualCount = selected.filter(e => e.isMutual).length;
  summary.textContent = `${selected.length} selected${mutualCount > 0 ? ` (${mutualCount} mutual)` : ''}`;
  if (btn) btn.disabled = false;
}

// ── Modal ──────────────────────────────────────────────────────────────────
function openConfirmModal(targets) {
  const mutuals = targets.filter(t => t.isMutual);
  $('modal-msg').textContent = `You are about to untrust ${targets.length} address${targets.length !== 1 ? 'es' : ''}. This cannot be undone in batch — you will need to re-trust individually.`;

  const warnEl = $('modal-warn');
  if (mutuals.length > 0) {
    warnEl.textContent = `${mutuals.length} of these are mutual trusts. They trust you back — untrusing does not affect their trust of you, but you will lose the mutual trust indicator.`;
    warnEl.classList.remove('hidden');
  } else {
    warnEl.classList.add('hidden');
  }

  $('confirm-modal').classList.remove('hidden');
}

function closeModal() {
  $('confirm-modal').classList.add('hidden');
}

// ── Trust score API ────────────────────────────────────────────────────────
async function fetchAllTrustScores(addresses) {
  try {
    const res = await fetch(SCORE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ avatars: addresses }),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const map = {};
    for (const item of (data.results || [])) {
      map[item.address.toLowerCase()] = item.relative_score;
    }
    return map;
  } catch {
    return {};
  }
}

// ── Lazy loading ───────────────────────────────────────────────────────────
async function lazyLoadProfiles() {
  await Promise.allSettled(entries.map(async (e) => {
    try {
      const profile = await sdk.rpc.profile.getProfileByAddress(e.address);
      if (profile) {
        const newName = profile.name || profile.registeredName || null;
        if (newName) e.name = newName;
        e.avatarImgUrl = profile.previewImageUrl || profile.imageUrl || null;
        updateRowName(e);
      }
    } catch {}
  }));
}

async function lazyLoadScores() {
  if (entries.length === 0) return;
  const addresses = entries.map(e => e.address);
  const scores = await fetchAllTrustScores(addresses);

  for (const e of entries) {
    const score = scores[e.address.toLowerCase()];
    e.trustScore = typeof score === 'number' ? score : -1;
    updateRowScore(e);
  }

  updateStats();
}

// ── Load trust connections ─────────────────────────────────────────────────
async function loadTrustConnections(address) {
  $('loading-state').classList.remove('hidden');
  $('trust-content').classList.add('hidden');

  try {
    const relations = await sdk.data.getTrustRelations(address);
    const outgoing = relations.filter(r =>
      r.relation === 'trusts' || r.relation === 'mutuallyTrusts'
    );

    entries = outgoing.map(r => ({
      address: getAddress(r.objectAvatar),
      name: shortAddr(r.objectAvatar),
      avatarImgUrl: null,
      avatarType: r.objectAvatarType || 'Human',
      timestamp: Number(r.timestamp || 0),
      isMutual: r.relation === 'mutuallyTrusts',
      expiryTime: BigInt(r.expiryTime || 0),
      trustScore: null,
      selected: false,
    }));

    $('loading-state').classList.add('hidden');
    $('trust-content').classList.remove('hidden');

    renderList();
    updateStats();

    // Load profiles and scores in parallel
    lazyLoadProfiles();
    lazyLoadScores();
  } catch (err) {
    $('loading-state').classList.add('hidden');
    $('trust-content').classList.remove('hidden');
    showToast(`Failed to load trust connections: ${decodeError(err)}`, 'error');
    entries = [];
    renderList();
    updateStats();
  }
}

// ── Bulk untrust ───────────────────────────────────────────────────────────
async function untrustSelected() {
  const targets = entries.filter(e => e.selected);
  if (targets.length === 0) return;

  closeModal();

  const btn = $('untrust-btn');
  if (btn) btn.disabled = true;

  try {
    const txs = targets.map(e => ({
      to: HUB_V2,
      data: encodeFunctionData({ abi: TRUST_ABI, functionName: 'trust', args: [e.address, 0n] }),
      value: '0x0',
    }));

    const hashes = await sendTransactions(txs);
    showToast('Transaction submitted, waiting for confirmation…', 'info', 10000);

    await waitForReceipts(hashes);

    const count = targets.length;
    const removed = new Set(targets.map(e => e.address));
    entries = entries.filter(e => !removed.has(e.address));

    renderList();
    updateStats();
    showToast(`Untrusted ${count} address${count !== 1 ? 'es' : ''}`, 'success');
  } catch (err) {
    if (isPasskeyError(err)) {
      showToast('Passkey auto-connect failed. Re-open wallet connect and choose your wallet again.', 'error', 6000);
    } else {
      showToast(`Untrust failed: ${decodeError(err)}`, 'error');
    }
    if (btn) btn.disabled = false;
    updateActionBar();
  }
}

// ── Controls wiring ────────────────────────────────────────────────────────
function wireControls() {
  // Sort buttons
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = key === 'name';
      }
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $('sort-dir-btn').textContent = sortAsc ? '↑' : '↓';
      renderList();
    });
  });

  $('sort-dir-btn').addEventListener('click', () => {
    sortAsc = !sortAsc;
    $('sort-dir-btn').textContent = sortAsc ? '↑' : '↓';
    renderList();
  });

  // Filter toggle
  $('filter-toggle-btn').addEventListener('click', () => {
    const fs = $('filter-section');
    const open = fs.classList.toggle('hidden');
    $('filter-toggle-btn').textContent = open ? 'Filter ▾' : 'Filter ▴';
  });

  // Score slider
  $('score-filter').addEventListener('input', e => {
    filterMinScore = Number(e.target.value);
    $('score-val-display').textContent = filterMinScore;
    renderList();
  });

  // Date range
  $('filter-from-date').addEventListener('change', e => {
    filterFromDate = e.target.value ? new Date(e.target.value) : null;
    renderList();
  });
  $('filter-to-date').addEventListener('change', e => {
    filterToDate = e.target.value ? new Date(e.target.value + 'T23:59:59') : null;
    renderList();
  });

  // Type toggles
  document.querySelectorAll('.type-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      if (filterTypes.has(type)) {
        filterTypes.delete(type);
        btn.classList.remove('active');
      } else {
        filterTypes.add(type);
        btn.classList.add('active');
      }
      renderList();
    });
  });

  // Clear filters
  $('clear-filters-btn').addEventListener('click', () => {
    filterMinScore = 0;
    filterFromDate = null;
    filterToDate = null;
    filterTypes = new Set();
    $('score-filter').value = 0;
    $('score-val-display').textContent = 0;
    $('filter-from-date').value = '';
    $('filter-to-date').value = '';
    document.querySelectorAll('.type-toggle').forEach(b => b.classList.remove('active'));
    renderList();
  });

  // Select all / deselect all
  $('select-all-btn').addEventListener('click', () => {
    const filtered = getFilteredSorted();
    filtered.forEach(e => { e.selected = true; });
    renderList();
    updateStats();
  });

  $('deselect-all-btn').addEventListener('click', () => {
    entries.forEach(e => { e.selected = false; });
    renderList();
    updateStats();
  });

  // Action bar — open confirm modal
  $('untrust-btn').addEventListener('click', () => {
    const targets = entries.filter(e => e.selected);
    if (targets.length === 0) return;
    openConfirmModal(targets);
  });

  // Modal buttons
  $('modal-cancel-btn').addEventListener('click', closeModal);
  $('modal-confirm-btn').addEventListener('click', untrustSelected);
  $('confirm-modal').addEventListener('click', e => {
    if (e.target === $('confirm-modal')) closeModal();
  });
}

// ── Wallet connection ──────────────────────────────────────────────────────
onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    $('wallet-status').textContent = 'Not connected';
    entries = [];
    showView('disconnected-view');
    return;
  }

  connectedAddress = getAddress(address);
  $('wallet-status').textContent = shortAddr(connectedAddress);
  showView('connected-view');
  await loadTrustConnections(connectedAddress);
});

// ── Init ───────────────────────────────────────────────────────────────────
wireControls();

if (!isMiniappMode()) {
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div style="background:#fff9ea;padding:8px 16px;font-size:12px;text-align:center;border-bottom:1px solid #ffe08a">' +
    'Running in standalone mode — wallet operations will not work. Load via the Circles host to test fully.</div>'
  );
}
