/**
 * Affiliate Link — Circles miniapp
 *
 * Two jobs, one app:
 *
 *  1. ADMIN mode (opened with no `?data=` payload). A group admin pastes their
 *     group address and gets a shareable link + QR. Anyone who opens that link
 *     lands in member mode pre-pointed at the group.
 *
 *  2. MEMBER mode (opened with a group in the `?data=` payload, or via the
 *     admin's "preview"). Shows the group and a one-tap "Set as my affiliate
 *     group" button. The affiliate group receives 1/12 of the CRC the member
 *     mints (~2 CRC/day) — at no cost to the member, changeable any time.
 *
 * The on-chain write is a single call to the AffiliateGroupRegistry:
 *   setAffiliateGroup(address newGroup)
 * submitted through the host bridge via `sendTransactions`. It is NOT a
 * Safe-management call and does not target the user's own Safe, so it passes
 * the host transaction policy. Reads (current affiliate, isGroup, profile name)
 * are best-effort niceties — the app works without them.
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
import {
  RPC_FALLBACKS,
  AFFILIATE_GROUP_REGISTRY,
  HUB_V2_ADDRESS,
} from './constants.js';
import { parseGroupPayload, buildShareLink } from './payload.js';

// ─── ABIs (minimal) ─────────────────────────────────────────
const affiliateRegistryAbi = [
  {
    type: 'function',
    name: 'setAffiliateGroup',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newGroup', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'affiliateGroup',
    stateMutability: 'view',
    inputs: [{ name: 'human', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
];
const hubIsGroupAbi = [
  {
    type: 'function',
    name: 'isGroup',
    stateMutability: 'view',
    inputs: [{ name: '_avatar', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
];

// ─── DOM refs ───────────────────────────────────────────────
const badge = document.getElementById('badge');
const memberView = document.getElementById('member-view');
const adminView = document.getElementById('admin-view');
// member
const mGroupName = document.getElementById('m-group-name');
const mGroupAddr = document.getElementById('m-group-addr');
const mGroupAvatar = document.getElementById('m-group-avatar');
const mCurrent = document.getElementById('m-current');
const mStatus = document.getElementById('m-status');
const mSetBtn = document.getElementById('m-set-btn');
// admin
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
let targetGroup = null; // member-mode group (checksummed)
let targetGroupName = null;
let busy = false;

// ─── Read clients ───────────────────────────────────────────
const rpcClients = RPC_FALLBACKS.map((url) =>
  createPublicClient({ chain: gnosis, transport: http(url) }),
);

async function readAny(params) {
  let lastErr;
  for (const client of rpcClients) {
    try {
      return await client.readContract(params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// ─── Read SDK (profile names, lazy) ─────────────────────────
let _sdk = null;
function getReadSdk() {
  if (!_sdk) _sdk = new Sdk();
  return _sdk;
}
async function getProfileName(address) {
  const sdk = getReadSdk();
  try {
    const p = await sdk.rpc.profile.getProfileByAddress(getAddress(address));
    return p?.name || p?.registeredName || null;
  } catch {
    try {
      const p = await sdk.rpc.profile.getProfileByAddress(address.toLowerCase());
      return p?.name || p?.registeredName || null;
    } catch {
      return null;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────
function shortAddress(a) {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}
function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function setStatus(el, text, type = 'info') {
  if (!text) {
    el.textContent = '';
    el.className = 'status hidden';
    return;
  }
  el.textContent = text;
  el.className = `status ${type}`;
}

// ─── On-chain reads (best-effort) ───────────────────────────
async function readCurrentAffiliate(human) {
  try {
    const a = await readAny({
      address: getAddress(AFFILIATE_GROUP_REGISTRY),
      abi: affiliateRegistryAbi,
      functionName: 'affiliateGroup',
      args: [getAddress(human)],
    });
    return a && a !== zeroAddress ? getAddress(a) : null;
  } catch {
    return null;
  }
}
// true / false / null(unknown — read failed)
async function checkIsGroup(addr) {
  try {
    return await readAny({
      address: getAddress(HUB_V2_ADDRESS),
      abi: hubIsGroupAbi,
      functionName: 'isGroup',
      args: [getAddress(addr)],
    });
  } catch {
    return null;
  }
}

// ─── View switching ─────────────────────────────────────────
function showMember() {
  memberView.classList.remove('hidden');
  adminView.classList.add('hidden');
}
function showAdmin() {
  adminView.classList.remove('hidden');
  memberView.classList.add('hidden');
}

// ─── Member mode ────────────────────────────────────────────
function enterMemberMode(payload) {
  if (!payload) return;
  targetGroup = payload.group;
  targetGroupName = payload.name;
  showMember();
  renderMemberGroup();
  // Fill in a friendly name if the link didn't carry one.
  if (!targetGroupName) {
    getProfileName(targetGroup).then((n) => {
      if (n) {
        targetGroupName = n;
        renderMemberGroup();
      }
    });
  }
  refreshCurrentAffiliate();
}

function renderMemberGroup() {
  mGroupName.textContent = targetGroupName || 'Circles group';
  mGroupAddr.textContent = shortAddress(targetGroup);
  const initial = (targetGroupName || targetGroup || '?').trim().charAt(0).toUpperCase();
  mGroupAvatar.textContent = initial;
}

async function refreshCurrentAffiliate() {
  if (!connectedAddress) {
    setStatus(mStatus, 'Open this from the Circles wallet to set your affiliate group.', 'info');
    mSetBtn.disabled = true;
    mCurrent.classList.add('hidden');
    return;
  }
  mSetBtn.disabled = false;
  const current = await readCurrentAffiliate(connectedAddress);
  if (current && targetGroup && current.toLowerCase() === targetGroup.toLowerCase()) {
    mCurrent.classList.add('hidden');
    setStatus(mStatus, `✓ ${targetGroupName || 'This group'} is already your affiliate group.`, 'success');
    mSetBtn.textContent = 'Already your affiliate';
    mSetBtn.disabled = true;
    return;
  }
  if (current) {
    const curName = (await getProfileName(current)) || shortAddress(current);
    mCurrent.innerHTML = `Your current affiliate: <strong>${escapeHtml(curName)}</strong>`;
  } else {
    mCurrent.innerHTML = "You don't have an affiliate group yet.";
  }
  mCurrent.classList.remove('hidden');
}

async function onSetAffiliate() {
  if (busy || !targetGroup) return;
  if (!connectedAddress) {
    setStatus(mStatus, 'Open this from the Circles wallet first.', 'error');
    return;
  }
  busy = true;
  mSetBtn.disabled = true;
  mSetBtn.textContent = 'Confirm in your wallet…';
  setStatus(mStatus, 'Confirm the transaction in your wallet…', 'info');
  try {
    const tx = {
      to: getAddress(AFFILIATE_GROUP_REGISTRY),
      data: encodeFunctionData({
        abi: affiliateRegistryAbi,
        functionName: 'setAffiliateGroup',
        args: [getAddress(targetGroup)],
      }),
      value: '0x0',
    };
    const hashes = await sendTransactions([tx]);
    if (!hashes || hashes.length === 0) throw new Error('Wallet returned no transaction hash');
    setStatus(mStatus, 'Waiting for confirmation…', 'info');
    const receipt = await waitForReceipt(hashes[hashes.length - 1]);
    if (receipt.status !== 'success') throw new Error('Transaction reverted on-chain');
    setStatus(mStatus, `🎉 Done! ${targetGroupName || 'This group'} is now your affiliate group.`, 'success');
    mSetBtn.textContent = 'Affiliate set';
  } catch (err) {
    console.error('[affiliate-link] setAffiliateGroup failed:', err);
    setStatus(mStatus, `Failed: ${decodeError(err)}`, 'error');
    mSetBtn.textContent = 'Set as my affiliate group';
    mSetBtn.disabled = false;
  } finally {
    busy = false;
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
      } catch {
        /* try next rpc */
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error('Timed out waiting for transaction');
}

// ─── Admin mode ─────────────────────────────────────────────
async function onCreateLink() {
  const raw = aGroupInput.value.trim();
  setStatus(aWarn, '');
  aWarn.classList.add('hidden');
  if (!isAddress(raw)) {
    aWarn.textContent = 'Enter a valid Gnosis Chain group address (0x…).';
    aWarn.className = 'status error';
    aResult.classList.add('hidden');
    return;
  }
  const group = getAddress(raw);
  const name = aNameInput.value.trim();

  // Best-effort: warn (don't block) if it isn't a registered group.
  const isGroup = await checkIsGroup(group);
  if (isGroup === false) {
    aWarn.textContent = "Heads up: this address isn't a registered Circles group, so setting it as an affiliate will fail. Double-check the address.";
    aWarn.className = 'status error';
    aWarn.classList.remove('hidden');
  }

  const link = buildShareLink(group, name);
  aLinkInput.value = link;
  aResult.classList.remove('hidden');
  try {
    const dataUrl = await QRCode.toDataURL(link, { margin: 1, width: 240 });
    aQr.src = dataUrl;
    aQr.classList.remove('hidden');
  } catch {
    aQr.classList.add('hidden');
  }
}

async function onCopyLink() {
  const link = aLinkInput.value;
  if (!link) return;
  try {
    await navigator.clipboard.writeText(link);
  } catch {
    aLinkInput.select();
    document.execCommand('copy');
  }
  const prev = aCopyBtn.textContent;
  aCopyBtn.textContent = 'Copied!';
  setTimeout(() => {
    aCopyBtn.textContent = prev;
  }, 1500);
}

function onPreview() {
  const raw = aGroupInput.value.trim();
  if (!isAddress(raw)) return;
  enterMemberMode({ group: getAddress(raw), name: aNameInput.value.trim() || null });
}

// When the connected account is itself a group, pre-fill the admin form.
async function maybePrefillAdminGroup() {
  if (!connectedAddress || aGroupInput.value.trim()) return;
  const isGroup = await checkIsGroup(connectedAddress);
  if (isGroup === true) {
    aGroupInput.value = connectedAddress;
    const name = await getProfileName(connectedAddress);
    if (name && !aNameInput.value.trim()) aNameInput.value = name;
  }
}

// ─── Wallet ─────────────────────────────────────────────────
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
  // Re-render whichever view is active.
  if (!memberView.classList.contains('hidden')) {
    refreshCurrentAffiliate();
  } else {
    maybePrefillAdminGroup();
  }
});

// ─── App data (deep link) ───────────────────────────────────
onAppData((data) => {
  const str = typeof data === 'string' ? data : data && data.data ? data.data : null;
  const payload = parseGroupPayload(str, true); // host already base64-decoded it
  if (payload) enterMemberMode(payload);
});

// ─── Wire up + init ─────────────────────────────────────────
mSetBtn.addEventListener('click', onSetAffiliate);
aCreateBtn.addEventListener('click', onCreateLink);
aCopyBtn.addEventListener('click', onCopyLink);
aPreviewBtn.addEventListener('click', onPreview);

// Direct/standalone open: read the group straight off the URL (?data=).
const urlData = new URLSearchParams(location.search).get('data');
const urlPayload = parseGroupPayload(urlData, false);
if (urlPayload) {
  enterMemberMode(urlPayload);
} else if (isMiniappMode()) {
  // Embedded with no URL data: the host may still deliver a group via app_data
  // (a member deep link). Wait briefly before falling back to the admin view so
  // the member flow doesn't flash the admin form first.
  setTimeout(() => {
    if (!targetGroup) showAdmin();
  }, 1500);
} else {
  showAdmin();
}

if (!isMiniappMode()) {
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div class="standalone-banner">⚠️ Standalone mode — open from the Circles wallet to read your account and submit the transaction.</div>',
  );
}
