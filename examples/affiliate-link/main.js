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
const setBarAvatar = document.getElementById('set-bar-avatar');
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
const aPreview = document.getElementById('a-preview');
const aResultPreview = document.getElementById('a-result-preview');
const aGroupSearch = document.getElementById('a-group-search');
const aResults = document.getElementById('a-group-results');

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

// ─── Profiles: names + avatars, batched & cached ────────────
// A single circles_getProfileByAddressBatch call hydrates a whole list of
// rows at once. `previewImageUrl` is normally a ready-to-use data: URI; an
// imageUrl / bare CID is routed through an IPFS gateway. Mirrors the way the
// host (ps-board / kudos-ga) resolves Circles avatars.
const profileCache = new Map(); // lowercased address -> { name, imageUrl }

function normalizeImage(raw) {
  if (!raw || typeof raw !== 'string') return null;
  if (raw.startsWith('data:')) return raw;
  if (raw.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${raw.slice(7)}`;
  if (raw.startsWith('http')) return raw;
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}/.test(raw) || /^bafy/.test(raw)) return `https://ipfs.io/ipfs/${raw}`;
  return null;
}

async function fetchProfiles(addresses) {
  const want = [];
  const seen = new Set();
  for (const a of addresses) {
    if (!a || !isAddress(a)) continue;
    const lc = a.toLowerCase();
    if (seen.has(lc) || profileCache.has(lc)) continue;
    seen.add(lc); want.push(getAddress(a));
  }
  if (!want.length) return;
  // Mark in-flight so concurrent callers don't refetch the same addresses.
  for (const a of want) profileCache.set(a.toLowerCase(), { name: null, imageUrl: null });
  let resolved = false;
  try {
    const profiles = await getReadSdk().rpc.profile.getProfileByAddressBatch(want);
    if (Array.isArray(profiles)) {
      for (let i = 0; i < want.length; i++) {
        const p = profiles[i];
        profileCache.set(want[i].toLowerCase(), {
          name: (p && p.name) || null,
          imageUrl: normalizeImage((p && (p.previewImageUrl || p.imageUrl)) || null),
        });
      }
      resolved = true;
    }
  } catch { /* avatars are optional polish — never throw */ }
  // On a failed/garbled batch, drop the in-flight placeholders so a later call
  // retries instead of caching nulls until reload (transient RPC outages).
  if (!resolved) for (const a of want) profileCache.delete(a.toLowerCase());
}

function getProfile(addr) {
  return (addr && profileCache.get(String(addr).toLowerCase())) || { name: null, imageUrl: null };
}

// Paint an `.avatar` element: real image when we have one, gradient initial
// otherwise. A broken image quietly falls back to the initial.
function paintAvatar(el, name, imageUrl) {
  if (!el) return;
  if (imageUrl) {
    const img = document.createElement('img');
    img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => { el.classList.remove('has-img'); el.textContent = initialOf(name); });
    el.classList.add('has-img');
    el.replaceChildren(img);
    img.src = imageUrl;
  } else {
    el.classList.remove('has-img');
    el.textContent = initialOf(name);
  }
}

// Compact group chip (avatar + name + short address). Paints from cache
// immediately, then upgrades name/avatar once the profile resolves.
function renderGroupChip(el, addr, name) {
  if (!el) return;
  if (!addr || !isAddress(addr)) { el.classList.add('hidden'); el.replaceChildren(); return; }
  const a = getAddress(addr);
  el.classList.remove('hidden');
  el.innerHTML = `
    <span class="gp-avatar avatar"></span>
    <span class="gp-meta">
      <span class="gp-name"></span>
      <span class="gp-sub mono"></span>
    </span>`;
  const nameEl = el.querySelector('.gp-name');
  const subEl = el.querySelector('.gp-sub');
  const avEl = el.querySelector('.gp-avatar');
  const paint = () => {
    const p = getProfile(a);
    const dn = (name && name.trim()) || p.name || shortAddress(a);
    nameEl.textContent = dn;
    subEl.textContent = shortAddress(a);
    paintAvatar(avEl, dn, p.imageUrl);
  };
  paint();
  fetchProfiles([a]).then(paint);
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
  try { await fetchProfiles([address]); return getProfile(address).name; }
  catch { return null; }
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
function skeletonRows(n) {
  let h = '';
  for (let i = 0; i < n; i++) {
    h += `<div class="group-row skeleton-row" aria-hidden="true">
      <span class="sk sk-avatar"></span>
      <span class="group-meta"><span class="sk sk-line sk-line-1"></span><span class="sk sk-line sk-line-2"></span></span>
    </div>`;
  }
  return h;
}

// findGroups is groups-only by construction — humans and orgs never appear in
// its results — so the "groups only" filter is handled server-side. We keep a
// defensive guard for malformed rows.
async function fetchGroups(query) {
  const params = query ? { nameStartsWith: query } : undefined;
  const res = await getReadSdk().rpc.group.findGroups(30, params);
  const rows = (res && res.results) || (Array.isArray(res) ? res : []);
  return rows.filter((g) => g && g.group && isAddress(g.group));
}

async function loadGroups(query) {
  const seq = ++searchSeq;
  groupListEl.innerHTML = skeletonRows(6);
  let results = [];
  try {
    results = await fetchGroups(query);
  } catch (e) {
    if (seq !== searchSeq) return;
    groupListEl.innerHTML = `<div class="list-hint">Couldn't load groups: ${escapeHtml(decodeError(e))}</div>`;
    return;
  }
  if (seq !== searchSeq) return; // a newer search superseded this one
  renderGroupList(results);
}

// Reusable group-row renderer. `onPick(addr, name)` fires on click; `opts`
// controls the trailing label and the member-only selected/current markers.
// Used by both the member picker and the admin group search.
function renderGroupRows(container, groups, onPick, opts = {}) {
  if (!groups.length) {
    container.innerHTML = '<div class="list-hint">No groups found.</div>';
    return;
  }
  container.innerHTML = '';
  const addrs = [];
  for (const g of groups) {
    const addr = getAddress(g.group);
    addrs.push(addr);
    const cached = getProfile(addr);
    const name = g.name || g.symbol || cached.name || shortAddress(addr);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'group-row';
    row.dataset.addr = addr;
    if (opts.markSelected && selected && selected.group.toLowerCase() === addr.toLowerCase()) row.classList.add('selected');
    const isCurrent = opts.markCurrent && currentAffiliate && currentAffiliate.toLowerCase() === addr.toLowerCase();
    row.innerHTML = `
      <span class="group-avatar avatar"></span>
      <span class="group-meta">
        <span class="group-name">${escapeHtml(name)}</span>
        <span class="group-sub mono">${g.symbol ? escapeHtml(g.symbol) + ' · ' : ''}${shortAddress(addr)}</span>
      </span>
      ${isCurrent ? '<span class="group-tag">current</span>' : `<span class="group-pick">${escapeHtml(opts.pickLabel || 'Select')}</span>`}
    `;
    paintAvatar(row.querySelector('.group-avatar'), name, cached.imageUrl);
    row.addEventListener('click', () => onPick(addr, row.querySelector('.group-name').textContent));
    container.appendChild(row);
  }
  hydrateGroupRows(container, addrs);
}

function renderGroupList(groups) {
  renderGroupRows(groupListEl, groups, (addr, name) => selectGroup(addr, name),
    { markSelected: true, markCurrent: true, pickLabel: 'Select' });
}

// Fill in real avatars (and upgrade bare-address names) once profiles resolve.
async function hydrateGroupRows(container, addrs) {
  await fetchProfiles(addrs);
  for (const el of container.querySelectorAll('.group-row')) {
    const addr = el.dataset.addr;
    if (!addr) continue;
    const p = getProfile(addr);
    const nameEl = el.querySelector('.group-name');
    if (nameEl && p.name && nameEl.textContent === shortAddress(addr)) nameEl.textContent = p.name;
    paintAvatar(el.querySelector('.group-avatar'), nameEl ? nameEl.textContent : '', p.imageUrl);
  }
}

function selectGroup(addr, name) {
  selected = { group: getAddress(addr), name: name || null };
  // highlight
  for (const el of groupListEl.querySelectorAll('.group-row')) {
    el.classList.toggle('selected', el.dataset.addr?.toLowerCase() === selected.group.toLowerCase());
  }
  const cached = getProfile(selected.group);
  const dn = name || cached.name || shortAddress(selected.group);
  setBarName.textContent = dn;
  paintAvatar(setBarAvatar, dn, cached.imageUrl);
  setStatusEl(setStatus, '');
  refreshSetButton();
  setBar.classList.remove('hidden');
  // Hydrate name + avatar from the profile (no-op once cached).
  const target = selected.group;
  fetchProfiles([target]).then(() => {
    if (!selected || selected.group !== target) return; // selection moved on
    const p = getProfile(target);
    if (!selected.name && p.name) selected.name = p.name;
    const n2 = selected.name || shortAddress(target);
    setBarName.textContent = n2;
    paintAvatar(setBarAvatar, n2, p.imageUrl);
  });
}

// The set-bar shows a connect hint while no wallet is bridged in. Once the
// host connects a wallet we must clear THAT hint — but not a success/error
// message that might be showing — so we match on the known hint text.
const HINT_STANDALONE = 'Open inside a Circles host to connect your wallet.';
const HINT_SIGNIN = 'Sign in to your Circles account to set this affiliate.';
const CONNECT_HINTS = new Set([HINT_STANDALONE, HINT_SIGNIN]);
function clearConnectHint() {
  if (CONNECT_HINTS.has(setStatus.textContent)) setStatusEl(setStatus, '');
}

function refreshSetButton() {
  if (!selected) { setBar.classList.add('hidden'); return; }
  if (!connectedAddress) {
    setBtn.disabled = true;
    setBtn.textContent = 'Set as my affiliate';
    // In a host but signed out → prompt sign-in; standalone → prompt a host.
    setStatusEl(setStatus, isMiniappMode() ? HINT_SIGNIN : HINT_STANDALONE, 'info');
    return;
  }
  if (currentAffiliate && currentAffiliate.toLowerCase() === selected.group.toLowerCase()) {
    setBtn.disabled = true;
    setBtn.textContent = 'Already your affiliate';
    clearConnectHint();
    return;
  }
  setBtn.disabled = false;
  setBtn.textContent = 'Set as my affiliate';
  clearConnectHint();
}

async function refreshCurrentAffiliate() {
  if (!connectedAddress) {
    // Disconnected: forget the previous session's affiliate and reset the
    // set-bar button so no stale "current"/enabled state lingers.
    currentAffiliate = null;
    currentAffiliateEl.classList.add('hidden');
    refreshSetButton();
    return;
  }
  currentAffiliate = await readCurrentAffiliate(connectedAddress);
  if (currentAffiliate) {
    await fetchProfiles([currentAffiliate]);
    const p = getProfile(currentAffiliate);
    const n = p.name || shortAddress(currentAffiliate);
    currentAffiliateEl.innerHTML =
      `Current affiliate: <span class="current-avatar avatar"></span> <strong>${escapeHtml(n)}</strong>`;
    paintAvatar(currentAffiliateEl.querySelector('.current-avatar'), n, p.imageUrl);
  } else {
    currentAffiliateEl.innerHTML = "You don't have an affiliate group yet — pick one below.";
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
  renderGroupChip(aResultPreview, group, name);
  aResult.classList.remove('hidden');
  try { aQr.src = await QRCode.toDataURL(link, { margin: 1, width: 240 }); aQr.classList.remove('hidden'); }
  catch { aQr.classList.add('hidden'); }
}

// Live preview chip under the admin form, so the admin sees the exact group
// (avatar + name) their link will point at before sharing it.
let adminPreviewTimer = null;
function scheduleAdminPreview() {
  clearTimeout(adminPreviewTimer);
  adminPreviewTimer = setTimeout(() => {
    const raw = aGroupInput.value.trim();
    renderGroupChip(aPreview, isAddress(raw) ? raw : null, aNameInput.value.trim());
  }, 200);
}

// Admin group search — same groups-only findGroups call as the member picker,
// so humans and orgs never show up. Picking a result fills the address +
// display-name fields (and the preview chip).
let adminSearchSeq = 0;
let adminSearchTimer = null;
async function loadAdminGroups(query) {
  if (!query) { aResults.classList.add('hidden'); aResults.replaceChildren(); return; }
  const seq = ++adminSearchSeq;
  aResults.classList.remove('hidden');
  aResults.innerHTML = skeletonRows(4);
  let results = [];
  try {
    results = await fetchGroups(query);
  } catch (e) {
    if (seq !== adminSearchSeq) return;
    aResults.innerHTML = `<div class="list-hint">Couldn't load groups: ${escapeHtml(decodeError(e))}</div>`;
    return;
  }
  if (seq !== adminSearchSeq) return; // superseded by a newer query
  renderGroupRows(aResults, results, pickAdminGroup, { pickLabel: 'Use this' });
}

function pickAdminGroup(addr, name) {
  const a = getAddress(addr);
  aGroupInput.value = a;
  // Adopt a real profile/display name, but not a fallback short address.
  if (name && name !== shortAddress(a)) aNameInput.value = name;
  aResults.classList.add('hidden');
  aResults.replaceChildren();
  aGroupSearch.value = '';
  setStatusEl(aWarn, '');
  renderGroupChip(aPreview, a, aNameInput.value.trim());
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
    renderGroupChip(aPreview, connectedAddress, aNameInput.value.trim());
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
  // selectGroup already hydrates the name + avatar from the profile.
  selectGroup(payload.group, payload.name);
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
aGroupInput.addEventListener('input', scheduleAdminPreview);
aNameInput.addEventListener('input', scheduleAdminPreview);
groupSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadGroups(groupSearch.value.trim()), 300);
});
aGroupSearch.addEventListener('input', () => {
  clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => loadAdminGroups(aGroupSearch.value.trim()), 300);
});

selectTab('set');
loadGroups('');

const urlPayload = parseGroupPayload(new URLSearchParams(location.search).get('data'), false);
if (urlPayload) applyDeepLink(urlPayload);

if (!isMiniappMode()) hostWarning.classList.remove('hidden');
