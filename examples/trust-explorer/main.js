/**
 * Circles Trust Explorer
 *
 * Lets you view your own trust graph, search for any Circles user,
 * inspect their connections, and trust/untrust them directly.
 *
 * SDK split:
 *   miniapp-sdk.js        — wallet bridge (send transactions)
 *   @aboutcircles/sdk     — read profiles, trust relations
 *   viem                  — encode contract calls
 */
import { onWalletChange, sendTransactions, isMiniappMode } from './miniapp-sdk.js';
import { Sdk } from '@aboutcircles/sdk';
import { encodeFunctionData, getAddress, createPublicClient, http, parseAbiItem } from 'viem';
import { gnosis } from 'viem/chains';

// ── Constants ──────────────────────────────────────────────────────────────
const RPC_URL = 'https://rpc.aboutcircles.com/';
const RPC_FALLBACK = 'https://rpc.gnosischain.com';
const HUB_V2 = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';
const ENTRYPOINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const TRUST_EXPIRY_MAX = BigInt('0xffffffffffffffffffffffff');

const TRUST_ABI = [
  {
    type: 'function',
    name: 'trust',
    inputs: [
      { name: '_trustReceiver', type: 'address' },
      { name: '_expiry', type: 'uint96' },
    ],
  },
];

// ── State ──────────────────────────────────────────────────────────────────
let connectedAddress = null;
let myTrustRelations = null; // cached {trusting: Set, trustedBy: Set, mutual: Set}
let viewingAddress = null;   // address currently shown in detail panel

// ── SDK / RPC clients ──────────────────────────────────────────────────────
const sdk = new Sdk(RPC_URL, null);

const receiptClients = [RPC_URL, RPC_FALLBACK].map(url =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

// ── UI helpers ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showView(id) {
  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  $(id)?.classList.remove('hidden');
}

function showToast(msg, type = 'info', ms = 4000) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

function isPasskeyError(err) {
  const m = decodeError(err).toLowerCase();
  return m.includes('passkey') || m.includes('auto connect') ||
    (m.includes('wallet address') && m.includes('retrieve'));
}

// ── Receipt polling ────────────────────────────────────────────────────────
async function waitForReceipts(hashes) {
  return Promise.all(hashes.map(waitForReceipt));
}

async function waitForReceipt(hash) {
  const deadline = Date.now() + 8 * 60_000;
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
        const r = await tryUserOp(client, hash);
        if (r) return r;
      }
    }
    await sleep(3000);
  }
  throw new Error(`Timed out waiting for ${hash}`);
}

async function tryUserOp(client, userOpHash) {
  try {
    const latest = await client.getBlockNumber();
    const from = latest > 5000n ? latest - 5000n : 0n;
    const logs = await client.getLogs({
      address: ENTRYPOINT,
      event: parseAbiItem(
        'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
      ),
      args: { userOpHash },
      fromBlock: from,
      toBlock: latest,
    });
    if (logs.length > 0) {
      return await client.getTransactionReceipt({ hash: logs.at(-1).transactionHash });
    }
  } catch {}
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Profile helpers ────────────────────────────────────────────────────────
async function fetchProfile(address) {
  try {
    const p = await sdk.rpc.profile.getProfileByAddress(address);
    return p || null;
  } catch {
    return null;
  }
}

function displayName(profile, address) {
  if (!profile) return shortAddr(address);
  return profile.name || profile.registeredName || shortAddr(address);
}

function avatarInitial(name) {
  if (!name) return '?';
  return name.trim().charAt(0).toUpperCase();
}

function setAvatarEl(el, profile, address) {
  const name = displayName(profile, address);
  if (profile?.imageUrl) {
    el.innerHTML = `<img src="${profile.imageUrl}" alt="${name}" onerror="this.parentElement.textContent='${avatarInitial(name)}'" />`;
    el.classList.add('has-img');
  } else {
    el.textContent = avatarInitial(name);
    el.classList.remove('has-img');
    const colors = ['#0e00a8','#4335df','#7c3aed','#1d4ed8','#0369a1'];
    const idx = address.charCodeAt(2) % colors.length;
    el.style.background = colors[idx];
  }
}

// ── Trust graph ────────────────────────────────────────────────────────────
async function getTrustRelations(address) {
  const relations = await sdk.data.getTrustRelations(address);
  const trusting = new Set();
  const trustedBy = new Set();

  for (const r of relations) {
    const other = r.objectAvatar?.toLowerCase() === address.toLowerCase()
      ? r.subjectAvatar
      : r.objectAvatar;

    if (r.subjectAvatar?.toLowerCase() === address.toLowerCase()) {
      trusting.add(getAddress(r.objectAvatar));
    } else {
      trustedBy.add(getAddress(r.subjectAvatar));
    }
  }

  const mutual = new Set([...trusting].filter(a => trustedBy.has(a)));
  return { trusting, trustedBy, mutual };
}

// ── Trust actions ──────────────────────────────────────────────────────────
function toHex(value) {
  return value ? `0x${BigInt(value).toString(16)}` : '0x0';
}

async function doTrust(targetAddress) {
  const data = encodeFunctionData({
    abi: TRUST_ABI,
    functionName: 'trust',
    args: [targetAddress, TRUST_EXPIRY_MAX],
  });
  const hashes = await sendTransactions([{ to: HUB_V2, data, value: '0x0' }]);
  return waitForReceipts(hashes);
}

async function doUntrust(targetAddress) {
  const data = encodeFunctionData({
    abi: TRUST_ABI,
    functionName: 'trust',
    args: [targetAddress, 0n],
  });
  const hashes = await sendTransactions([{ to: HUB_V2, data, value: '0x0' }]);
  return waitForReceipts(hashes);
}

// ── Render helpers ─────────────────────────────────────────────────────────
function renderTrustList(containerEl, addresses, myTrusting) {
  if (addresses.length === 0) {
    containerEl.innerHTML = '<div class="empty-list">No connections yet</div>';
    return;
  }

  containerEl.innerHTML = '';
  for (const addr of addresses) {
    const row = document.createElement('div');
    row.className = 'trust-row';

    const isMutual = myTrusting?.has(addr);

    row.innerHTML = `
      <div class="trust-row-avatar" data-addr="${addr}"></div>
      <div class="trust-row-info">
        <div class="trust-row-name" data-addr="${addr}">…</div>
        <div class="trust-row-addr">${shortAddr(addr)}</div>
      </div>
      ${isMutual ? '<span class="badge-mutual">mutual</span>' : ''}
    `;
    containerEl.appendChild(row);

    // Lazy load profile name
    fetchProfile(addr).then(profile => {
      const nameEl = containerEl.querySelector(`.trust-row-name[data-addr="${addr}"]`);
      const avatarEl = containerEl.querySelector(`.trust-row-avatar[data-addr="${addr}"]`);
      if (nameEl) nameEl.textContent = displayName(profile, addr);
      if (avatarEl) setAvatarEl(avatarEl, profile, addr);
    });

    // Click to view profile
    row.addEventListener('click', () => openProfile(addr));
  }
}

// ── My profile panel ───────────────────────────────────────────────────────
async function loadMyProfile() {
  const address = connectedAddress;
  const [profile, relations] = await Promise.all([
    fetchProfile(address),
    getTrustRelations(address),
  ]);

  myTrustRelations = relations;

  setAvatarEl($('my-avatar'), profile, address);
  $('my-name').textContent = displayName(profile, address);
  $('my-address').textContent = shortAddr(address);

  $('my-trusting-count').textContent = relations.trusting.size;
  $('my-trusted-by-count').textContent = relations.trustedBy.size;
  $('my-mutual-count').textContent = relations.mutual.size;

  $('my-profile-card').classList.remove('hidden');

  renderTrustList($('my-trusting-list'), [...relations.trusting], null);
  renderTrustList($('my-trusted-by-list'), [...relations.trustedBy], relations.trusting);
  renderTrustList($('my-mutual-list'), [...relations.mutual], null);

  $('my-trust-section').classList.remove('hidden');
}

// ── Profile detail panel ───────────────────────────────────────────────────
async function openProfile(address) {
  let checksummed;
  try {
    checksummed = getAddress(address);
  } catch {
    showToast('Invalid address', 'error');
    return;
  }

  viewingAddress = checksummed;

  $('search-card').classList.add('hidden');
  $('my-trust-section').classList.add('hidden');
  $('profile-detail').classList.remove('hidden');

  $('detail-name').textContent = 'Loading…';
  $('detail-address').textContent = shortAddr(checksummed);
  $('detail-avatar').textContent = '?';
  $('detail-trusting-count').textContent = '—';
  $('detail-trusted-by-count').textContent = '—';
  $('detail-mutual-count').textContent = '—';
  $('detail-trusting-list').innerHTML = '';
  $('detail-trusted-by-list').innerHTML = '';

  $('trust-btn').classList.add('hidden');
  $('untrust-btn').classList.add('hidden');
  $('trust-status-badge').classList.add('hidden');

  // Don't show trust/untrust for own address
  const isSelf = checksummed.toLowerCase() === connectedAddress?.toLowerCase();

  try {
    const [profile, relations] = await Promise.all([
      fetchProfile(checksummed),
      getTrustRelations(checksummed),
    ]);

    setAvatarEl($('detail-avatar'), profile, checksummed);
    $('detail-name').textContent = displayName(profile, checksummed);
    $('detail-trusting-count').textContent = relations.trusting.size;
    $('detail-trusted-by-count').textContent = relations.trustedBy.size;
    $('detail-mutual-count').textContent = relations.mutual.size;

    if (!isSelf && myTrustRelations) {
      const isTrusting = myTrustRelations.trusting.has(checksummed);
      const isTrustedBy = myTrustRelations.trustedBy.has(checksummed);

      if (isTrusting) {
        $('untrust-btn').classList.remove('hidden');
        if (isTrustedBy) {
          $('trust-status-badge').textContent = '↔ Mutual';
          $('trust-status-badge').className = 'badge badge-mutual-lg';
          $('trust-status-badge').classList.remove('hidden');
        }
      } else {
        $('trust-btn').classList.remove('hidden');
        if (isTrustedBy) {
          $('trust-status-badge').textContent = 'Trusts you';
          $('trust-status-badge').className = 'badge badge-info';
          $('trust-status-badge').classList.remove('hidden');
        }
      }
    }

    renderTrustList($('detail-trusting-list'), [...relations.trusting], myTrustRelations?.trusting);
    renderTrustList($('detail-trusted-by-list'), [...relations.trustedBy], myTrustRelations?.trusting);

  } catch (err) {
    showToast(`Failed to load profile: ${decodeError(err)}`, 'error');
  }
}

function closeProfile() {
  viewingAddress = null;
  $('profile-detail').classList.add('hidden');
  $('search-card').classList.remove('hidden');
  $('my-trust-section').classList.remove('hidden');
}

// ── Search ─────────────────────────────────────────────────────────────────
async function runSearch() {
  const query = $('search-input').value.trim();
  if (!query) return;

  const resultsEl = $('search-results');
  resultsEl.innerHTML = '<div class="search-loading">Searching…</div>';
  resultsEl.classList.remove('hidden');

  try {
    let results = [];

    if (query.startsWith('0x') && query.length === 42) {
      const addr = getAddress(query);
      const profile = await fetchProfile(addr);
      results = [{ address: addr, profile }];
    } else {
      const raw = await sdk.rpc.profile.searchByAddressOrName(query, 10, 0);
      results = (raw || []).map(r => ({
        address: getAddress(r.address || r.safeAddress),
        profile: r,
      }));
    }

    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="empty-list">No users found</div>';
      return;
    }

    resultsEl.innerHTML = '';
    for (const { address, profile } of results) {
      const row = document.createElement('div');
      row.className = 'search-result-row';

      const avatarDiv = document.createElement('div');
      avatarDiv.className = 'trust-row-avatar';
      setAvatarEl(avatarDiv, profile, address);

      const info = document.createElement('div');
      info.className = 'trust-row-info';
      info.innerHTML = `
        <div class="trust-row-name">${displayName(profile, address)}</div>
        <div class="trust-row-addr">${shortAddr(address)}</div>
      `;

      row.appendChild(avatarDiv);
      row.appendChild(info);

      const isTrusting = myTrustRelations?.trusting.has(address);
      const isTrustedBy = myTrustRelations?.trustedBy.has(address);
      if (isTrusting && isTrustedBy) {
        const badge = document.createElement('span');
        badge.className = 'badge-mutual';
        badge.textContent = 'mutual';
        row.appendChild(badge);
      } else if (isTrusting) {
        const badge = document.createElement('span');
        badge.className = 'badge-info';
        badge.textContent = 'trusting';
        row.appendChild(badge);
      } else if (isTrustedBy) {
        const badge = document.createElement('span');
        badge.className = 'badge-info';
        badge.textContent = 'trusts you';
        row.appendChild(badge);
      }

      row.addEventListener('click', () => {
        $('search-results').classList.add('hidden');
        openProfile(address);
      });

      resultsEl.appendChild(row);
    }
  } catch (err) {
    resultsEl.innerHTML = `<div class="empty-list">Search failed: ${decodeError(err)}</div>`;
  }
}

// ── Tab switching ──────────────────────────────────────────────────────────
function setupTabs(tabsContainerId, panels) {
  const container = $(tabsContainerId);
  if (!container) return;
  container.addEventListener('click', e => {
    const btn = e.target.closest('.tab-btn');
    if (!btn) return;
    const tab = btn.dataset.tab;

    container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    panels.forEach(({ id, key }) => {
      $(id)?.classList.toggle('hidden', key !== tab);
    });
  });
}

// ── Initialise ─────────────────────────────────────────────────────────────
async function initializeApp(address) {
  showView('connected-view');
  $('wallet-status').textContent = shortAddr(address);
  $('wallet-status').className = 'badge badge-success';

  try {
    await loadMyProfile();
  } catch (err) {
    if (isPasskeyError(err)) {
      showToast('Passkey auto-connect failed. Re-open wallet connect and choose your wallet again.', 'error', 6000);
    } else {
      showToast(`Failed to load profile: ${decodeError(err)}`, 'error');
    }
  }
}

// ── Wire up events ─────────────────────────────────────────────────────────
$('search-btn').addEventListener('click', runSearch);
$('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch(); });

$('back-btn').addEventListener('click', closeProfile);

$('trust-btn').addEventListener('click', async () => {
  if (!viewingAddress) return;
  $('trust-btn').disabled = true;
  showToast('Sending trust transaction…', 'info');
  try {
    await doTrust(viewingAddress);
    showToast('Trusted successfully!', 'success');
    // Refresh both profiles
    myTrustRelations = await getTrustRelations(connectedAddress);
    await openProfile(viewingAddress);
  } catch (err) {
    if (isPasskeyError(err)) {
      showToast('Passkey auto-connect failed. Re-open wallet connect and choose your wallet again.', 'error', 6000);
    } else {
      showToast(`Trust failed: ${decodeError(err)}`, 'error');
    }
  } finally {
    $('trust-btn').disabled = false;
  }
});

$('untrust-btn').addEventListener('click', async () => {
  if (!viewingAddress) return;
  $('untrust-btn').disabled = true;
  showToast('Sending untrust transaction…', 'info');
  try {
    await doUntrust(viewingAddress);
    showToast('Untrusted successfully!', 'success');
    myTrustRelations = await getTrustRelations(connectedAddress);
    await openProfile(viewingAddress);
  } catch (err) {
    if (isPasskeyError(err)) {
      showToast('Passkey auto-connect failed. Re-open wallet connect and choose your wallet again.', 'error', 6000);
    } else {
      showToast(`Untrust failed: ${decodeError(err)}`, 'error');
    }
  } finally {
    $('untrust-btn').disabled = false;
  }
});

setupTabs('detail-tabs', [
  { id: 'tab-trusting', key: 'trusting' },
  { id: 'tab-trusted-by', key: 'trusted-by' },
]);

setupTabs('my-tabs', [
  { id: 'tab-my-trusting', key: 'my-trusting' },
  { id: 'tab-my-trusted-by', key: 'my-trusted-by' },
  { id: 'tab-my-mutual', key: 'my-mutual' },
]);

// ── Wallet connection ──────────────────────────────────────────────────────
onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    myTrustRelations = null;
    viewingAddress = null;
    $('wallet-status').textContent = 'Not connected';
    $('wallet-status').className = 'badge';
    showView('disconnected-view');
    return;
  }

  connectedAddress = getAddress(address);
  await initializeApp(connectedAddress);
});

// ── Standalone dev mode banner ─────────────────────────────────────────────
if (!isMiniappMode()) {
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div style="background:#fff9ea;padding:8px 16px;font-size:12px;text-align:center;border-bottom:1px solid #fde68a">' +
    '⚠ Running in standalone mode — wallet ops unavailable. Load via https://circles.gnosis.io/miniapps to test fully.</div>'
  );
}
