/**
 * Affiliate Link — Circles miniapp (runs inside a Circles host)
 *
 * A human avatar sets their own affiliate group. The affiliate group receives
 * 1/12 of the CRC the member mints (~2 CRC/day), at no cost to the member,
 * changeable any time.
 *
 *  • "Set my affiliate" (member): search/pick a group (SDK rpc.group.findGroups)
 *    → one tap sets it. A shared deep link (?data=) pre-selects a group.
 *  • "Promote my group" (admin): generate a shareable link + QR for a group.
 *
 * Wallet + writes go through the HOST BRIDGE (@aboutcircles/miniapp-sdk):
 * the app has no wallet of its own — it asks the host for the account
 * (onWalletChange) and submits via sendTransactions. The on-chain write is a
 * single AffiliateGroupRegistry.setAffiliateGroup(address) call. Reads
 * (group search, current affiliate) use the Circles SDK / public RPC.
 */

// @ts-nocheck
import {
  onWalletChange,
  sendTransactions,
  isMiniappMode,
  onAppData,
} from '@aboutcircles/miniapp-sdk';
import { Sdk } from '@aboutcircles/sdk';
import {
  getAddress,
  isAddress,
  encodeFunctionData,
  createPublicClient,
  http,
  zeroAddress,
} from 'viem';
import { gnosis } from 'viem/chains';
import QRCode from 'qrcode';
import { RPC_FALLBACKS, AFFILIATE_GROUP_REGISTRY, HUB_V2_ADDRESS } from './constants.js';
import { parseGroupPayload, buildShareLink } from './payload.js';

// ─── ABI ────────────────────────────────────────────────────
const affiliateRegistryAbi = [
  { type: 'function', name: 'setAffiliateGroup', stateMutability: 'nonpayable',
    inputs: [{ name: 'newGroup', type: 'address' }], outputs: [] },
  { type: 'function', name: 'affiliateGroup', stateMutability: 'view',
    inputs: [{ name: 'human', type: 'address' }], outputs: [{ name: '', type: 'address' }] },
];
const hubIsGroupAbi = [
  { type: 'function', name: 'isGroup', stateMutability: 'view',
    inputs: [{ name: '_avatar', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
];

// ─── DOM refs ───────────────────────────────────────────────
const badge = document.getElementById('badge');
const hostWarning = document.getElementById('host-warning');
const tabSet = document.getElementById('tab-set');
const tabPromote = document.getElementById('tab-promote');
const setPanel = document.getElementById('set-panel');
const promotePanel = document.getElementById('promote-panel');
// set (member)
const currentAffiliateEl = document.getElementById('current-affiliate');
const groupSearch = document.getElementById('group-search');
const groupListEl = document.getElementById('group-list');
const setBar = document.getElementById('set-bar');
const setBarName = document.getElementById('set-bar-name');
const setBtn = document.getElementById('set-btn');
const setStatus = document.getElementById('set-status');
// promote (admin)
const aGroupInput = document.getElementById('a-group-input');
const aNameInput = document.getElementById('a-name-input');
const aCreateBtn = document.getElementById('a-create-btn');
const aWarn = document.getElementById('a-warn');
const aResult = document.getElementById('a-result');
const aLinkInput = document.getElementById('a-link-input');
const aCopyBtn = document.getElementById('a-copy-btn');
const aPreviewBtn = document.getElementById('a-preview-btn');
const aQr = document.getElementById('a-qr');

// ─── State ──────────────────────────────────────────────────
let connectedAddress = null;
let currentAffiliate = null;        // checksummed address or null
let selected = null;                // { group, name } the member chose
let busy = false;
let searchSeq = 0;                  // guards against out-of-order search responses
let searchTimer = null;

// ─── Read clients ───────────────────────────────────────────
const rpcClients = RPC_FALLBACKS.map((url) =>
  createPublicClient({ chain: gnosis, transport: http(url) }));
async function readAny(params) {
  let last;
  for (const c of rpcClients) { try { return await c.readContract(params); } catch (e) { last = e; } }
  throw last;
}
let _sdk = null;
function getReadSdk() { if (!_sdk) _sdk = new Sdk(); return _sdk; }

// ─── Helpers ────────────────────────────────────────────────
const shortAddress = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
const initialOf = (s) => (s || '?').trim().charAt(0).toUpperCase();
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.shortMessage || err.message || String(err);
}
function setStatusEl(el, text, type = 'info') {
  if (!text) { el.textContent = ''; el.className = 'status hidden'; return; }
  el.textContent = text;
  el.className = `status ${type}`;
}

// ─── Reads ──────────────────────────────────────────────────
async function readCurrentAffiliate(human) {
  try {
    const a = await readAny({ address: getAddress(AFFILIATE_GROUP_REGISTRY), abi: affiliateRegistryAbi,
      functionName: 'affiliateGroup', args: [getAddress(human)] });
    return a && a !== zeroAddress ? getAddress(a) : null;
  } catch { return null; }
}
async function checkIsGroup(addr) {
  try {
    return await readAny({ address: getAddress(HUB_V2_ADDRESS), abi: hubIsGroupAbi,
      functionName: 'isGroup', args: [getAddress(addr)] });
  } catch { return null; }
}
async function getProfileName(address) {
  try {
    const p = await getReadSdk().rpc.profile.getProfileByAddress(getAddress(address));
    return p?.name || p?.registeredName || null;
  } catch { return null; }
}

// ─── Tabs ───────────────────────────────────────────────────
function selectTab(which) {
  const isSet = which === 'set';
  tabSet.classList.toggle('active', isSet);
  tabPromote.classList.toggle('active', !isSet);
  tabSet.setAttribute('aria-selected', String(isSet));
  tabPromote.setAttribute('aria-selected', String(!isSet));
  setPanel.classList.toggle('hidden', !isSet);
  promotePanel.classList.toggle('hidden', isSet);
  setBar.classList.toggle('hidden', !(isSet && selected));
}
tabSet.addEventListener('click', () => selectTab('set'));
tabPromote.addEventListener('click', () => selectTab('promote'));

// ─── Group picker (member) ──────────────────────────────────
async function loadGroups(query) {
  const seq = ++searchSeq;
  groupListEl.innerHTML = '<div class="list-hint">Searching…</div>';
  let results = [];
  try {
    const params = query ? { nameStartsWith: query } : undefined;
    const res = await getReadSdk().rpc.group.findGroups(30, params);
    results = (res && res.results) || (Array.isArray(res) ? res : []);
  } catch (e) {
    if (seq !== searchSeq) return;
    groupListEl.innerHTML = `<div class="list-hint">Couldn't load groups: ${escapeHtml(decodeError(e))}</div>`;
    return;
  }
  if (seq !== searchSeq) return; // a newer search superseded this one
  renderGroupList(results);
}

function renderGroupList(groups) {
  if (!groups.length) {
    groupListEl.innerHTML = '<div class="list-hint">No groups found.</div>';
    return;
  }
  groupListEl.innerHTML = '';
  for (const g of groups) {
    const addr = getAddress(g.group);
    const name = g.name || g.symbol || shortAddress(addr);
    const row = document.createElement('button');
    row.className = 'group-row';
    row.dataset.addr = addr;
    if (selected && selected.group.toLowerCase() === addr.toLowerCase()) row.classList.add('selected');
    const isCurrent = currentAffiliate && currentAffiliate.toLowerCase() === addr.toLowerCase();
    row.innerHTML = `
      <span class="group-avatar">${escapeHtml(initialOf(name))}</span>
      <span class="group-meta">
        <span class="group-name">${escapeHtml(name)}</span>
        <span class="group-sub mono">${g.symbol ? escapeHtml(g.symbol) + ' · ' : ''}${shortAddress(addr)}</span>
      </span>
      ${isCurrent ? '<span class="group-tag">current</span>' : '<span class="group-pick">Select</span>'}
    `;
    row.addEventListener('click', () => selectGroup(addr, name));
    groupListEl.appendChild(row);
  }
}

function selectGroup(addr, name) {
  selected = { group: getAddress(addr), name: name || null };
  // highlight
  for (const el of groupListEl.querySelectorAll('.group-row')) {
    el.classList.toggle('selected', el.dataset.addr?.toLowerCase() === selected.group.toLowerCase());
  }
  setBarName.textContent = name || shortAddress(selected.group);
  setStatusEl(setStatus, '');
  refreshSetButton();
  setBar.classList.remove('hidden');
}

function refreshSetButton() {
  if (!selected) { setBar.classList.add('hidden'); return; }
  if (!connectedAddress) {
    setBtn.disabled = true;
    setBtn.textContent = 'Set as my affiliate';
    setStatusEl(setStatus, 'Open inside a Circles host to connect your wallet.', 'info');
    return;
  }
  if (currentAffiliate && currentAffiliate.toLowerCase() === selected.group.toLowerCase()) {
    setBtn.disabled = true;
    setBtn.textContent = 'Already your affiliate';
    setStatusEl(setStatus, '');
    return;
  }
  setBtn.disabled = false;
  setBtn.textContent = 'Set as my affiliate';
}

async function refreshCurrentAffiliate() {
  if (!connectedAddress) { currentAffiliateEl.classList.add('hidden'); return; }
  currentAffiliate = await readCurrentAffiliate(connectedAddress);
  if (currentAffiliate) {
    const n = (await getProfileName(currentAffiliate)) || shortAddress(currentAffiliate);
    currentAffiliateEl.innerHTML = `Current affiliate: <strong>${escapeHtml(n)}</strong>`;
  } else {
    currentAffiliateEl.innerHTML = "You don't have an affiliate group yet.";
  }
  currentAffiliateEl.classList.remove('hidden');
  refreshSetButton();
}

async function onSetAffiliate() {
  if (busy || !selected) return;
  if (!connectedAddress) { setStatusEl(setStatus, 'Open inside a Circles host first.', 'error'); return; }
  busy = true;
  setBtn.disabled = true;
  setBtn.textContent = 'Confirm in your wallet…';
  setStatusEl(setStatus, 'Confirm the transaction in your wallet…', 'info');
  try {
    const tx = {
      to: getAddress(AFFILIATE_GROUP_REGISTRY),
      data: encodeFunctionData({ abi: affiliateRegistryAbi, functionName: 'setAffiliateGroup', args: [getAddress(selected.group)] }),
      value: '0x0',
    };
    const hashes = await sendTransactions([tx]);
    if (!hashes || hashes.length === 0) throw new Error('Wallet returned no transaction hash');
    setStatusEl(setStatus, 'Waiting for confirmation…', 'info');
    const receipt = await waitForReceipt(hashes[hashes.length - 1]);
    if (receipt.status !== 'success') throw new Error('Transaction reverted on-chain');
    currentAffiliate = getAddress(selected.group);
    setStatusEl(setStatus, `🎉 Done! ${selected.name || 'This group'} is now your affiliate group.`, 'success');
    setBtn.textContent = 'Affiliate set';
    refreshCurrentAffiliate();
  } catch (err) {
    console.error('[affiliate-link] setAffiliateGroup failed:', err);
    setStatusEl(setStatus, `Failed: ${decodeError(err)}`, 'error');
    setBtn.disabled = false;
    setBtn.textContent = 'Set as my affiliate';
  } finally {
    busy = false;
  }
}

async function waitForReceipt(hash) {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    for (const c of rpcClients) {
      try { const r = await c.getTransactionReceipt({ hash }); if (r) return r; } catch { /* next */ }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('Timed out waiting for transaction');
}

// ─── Admin (promote) ────────────────────────────────────────
async function onCreateLink() {
  setStatusEl(aWarn, '');
  const raw = aGroupInput.value.trim();
  if (!isAddress(raw)) {
    aWarn.textContent = 'Enter a valid Gnosis Chain group address (0x…).';
    aWarn.className = 'status error';
    aResult.classList.add('hidden');
    return;
  }
  const group = getAddress(raw);
  const name = aNameInput.value.trim();
  const isGroup = await checkIsGroup(group);
  if (isGroup === false) {
    aWarn.textContent = "Heads up: this address isn't a registered Circles group, so setting it as an affiliate will fail.";
    aWarn.className = 'status error';
  }
  const link = buildShareLink(group, name);
  aLinkInput.value = link;
  aResult.classList.remove('hidden');
  try { aQr.src = await QRCode.toDataURL(link, { margin: 1, width: 240 }); aQr.classList.remove('hidden'); }
  catch { aQr.classList.add('hidden'); }
}
async function onCopyLink() {
  if (!aLinkInput.value) return;
  try { await navigator.clipboard.writeText(aLinkInput.value); }
  catch { aLinkInput.select(); document.execCommand('copy'); }
  const prev = aCopyBtn.textContent;
  aCopyBtn.textContent = 'Copied!';
  setTimeout(() => { aCopyBtn.textContent = prev; }, 1500);
}
function onPreview() {
  const raw = aGroupInput.value.trim();
  if (!isAddress(raw)) return;
  selectTab('set');
  selectGroup(getAddress(raw), aNameInput.value.trim() || null);
}
async function maybePrefillAdminGroup() {
  if (!connectedAddress || aGroupInput.value.trim()) return;
  if ((await checkIsGroup(connectedAddress)) === true) {
    aGroupInput.value = connectedAddress;
    const n = await getProfileName(connectedAddress);
    if (n && !aNameInput.value.trim()) aNameInput.value = n;
  }
}

// ─── Wallet (host bridge) ───────────────────────────────────
onWalletChange((address) => {
  if (!address) {
    connectedAddress = null;
    badge.textContent = 'Not connected';
    badge.className = 'badge badge-off';
  } else {
    connectedAddress = getAddress(address);
    badge.textContent = shortAddress(connectedAddress);
    badge.className = 'badge badge-on';
  }
  refreshCurrentAffiliate();
  maybePrefillAdminGroup();
});

// ─── Deep link (host app_data + URL fallback) ───────────────
function applyDeepLink(payload) {
  if (!payload) return;
  selectTab('set');
  selectGroup(payload.group, payload.name);
  if (!payload.name) getProfileName(payload.group).then((n) => {
    if (n && selected && selected.group.toLowerCase() === payload.group.toLowerCase()) {
      selected.name = n; setBarName.textContent = n;
    }
  });
}
onAppData((data) => {
  const str = typeof data === 'string' ? data : (data && data.data) || null;
  applyDeepLink(parseGroupPayload(str, true));
});

// ─── Wire up + init ─────────────────────────────────────────
setBtn.addEventListener('click', onSetAffiliate);
aCreateBtn.addEventListener('click', onCreateLink);
aCopyBtn.addEventListener('click', onCopyLink);
aPreviewBtn.addEventListener('click', onPreview);
groupSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadGroups(groupSearch.value.trim()), 300);
});

selectTab('set');
loadGroups('');

const urlPayload = parseGroupPayload(new URLSearchParams(location.search).get('data'), false);
if (urlPayload) applyDeepLink(urlPayload);

if (!isMiniappMode()) hostWarning.classList.remove('hidden');
