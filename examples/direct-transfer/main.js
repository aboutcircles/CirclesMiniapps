/**
 * Direct Transfer — main.js
 *
 * Sends Circles you hold (ERC1155 native, ERC20 demurraged wrapper, or ERC20
 * inflationary wrapper) directly to another user. Auto-routes between the
 * ERC1155 and demurraged forms by wrapping/unwrapping in a single tx batch.
 */

// @ts-nocheck
import {
  onWalletChange,
  sendTransactions,
  isMiniappMode,
} from '@aboutcircles/miniapp-sdk';
import { Sdk } from '@aboutcircles/sdk';
import { inflationaryCirclesAbi } from '@aboutcircles/sdk-abis/inflationaryCircles';
import {
  createPublicClient,
  http,
  getAddress,
  isAddress,
  parseUnits,
  formatUnits,
} from 'viem';
import { gnosis } from 'viem/chains';

import {
  HUB_V2,
  ZERO_ADDRESS,
  ATTO_PER_HUNDREDTH,
  classifyBalance,
  floorAttoTo2Decimals,
  toDisplayAtto as _toDisplayAtto,
  fromDisplayAtto as _fromDisplayAtto,
  computeRoute as computeRoutePure,
} from './routing.js';

// ─── Constants ──────────────────────────────────────────────
const RPC_URL = 'https://rpc.aboutcircles.com/';
const TINY_THRESHOLD_ATTO = 10n ** 17n; // hide < 0.1 CRC by default in the list

const RPC_FALLBACKS = [
  RPC_URL,
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];
const receiptClients = RPC_FALLBACKS.map((url) =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

// ─── DOM refs ───────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const badge = $('badge');
const screenTitle = $('screen-title');
const screenSubtitle = $('screen-subtitle');
const disconnectedView = $('disconnected-view');
const loadingView = $('loading-view');
const balancesView = $('balances-view');
const sendView = $('send-view');
const errorView = $('error-view');
const balancesList = $('balances-list');
const emptyBalances = $('empty-balances');
const hideTinyToggle = $('hide-tiny');
const refreshBtn = $('refresh-btn');
const balancesSearch = $('balances-search');
const balancesSearchClear = $('balances-search-clear');
const errorMessageEl = $('error-message');
const errorRetryBtn = $('error-retry');
const backBtn = $('back-btn');

const sendTokenAvatar = $('send-token-avatar');
const sendTokenName = $('send-token-name');
const sendTokenTotal = $('send-token-total');

const recipientInput = $('recipient-input');
const recipientClear = $('recipient-clear');
const recipientResults = $('recipient-results');
const recipientSelected = $('recipient-selected');
const recipientAvatar = $('recipient-avatar');
const recipientNameEl = $('recipient-name');
const recipientAddressEl = $('recipient-address');

const amountInput = $('amount-input');
const amountHint = $('amount-hint');
const maxBtn = $('max-btn');

const routePreview = $('route-preview');
const sendBtn = $('send-btn');
const sendBtnText = sendBtn.querySelector('.btn-text');
const sendBtnSpinner = sendBtn.querySelector('.btn-spinner');
const sendResult = $('send-result');
const sendResultIcon = $('send-result-icon');
const sendResultMessage = $('send-result-message');

const toastHost = $('toast-host');

// ─── State ──────────────────────────────────────────────────
let connectedAddress = null;
/** Map<issuerAddress, IssuerEntry> */
let issuerMap = new Map();
let selectedIssuer = null; // IssuerEntry being sent
let selectedRecipient = null; // { address, name, imageUrl }
let pendingSearchTimer = null;
let isSending = false;
const profileCache = new Map();

// Display unit toggle. Internal canonical is always demurraged-atto; this
// only affects what the user sees and types.
//   'demurraged' — today's CRC (matches the Circles app)
//   'static'     — non-decaying inflationary unit (matches DeFi wrappers)
let displayUnit = (() => {
  try {
    return localStorage.getItem('direct-transfer:unit') === 'static' ? 'static' : 'demurraged';
  } catch {
    return 'demurraged';
  }
})();

/**
 * IssuerEntry shape:
 * {
 *   issuer: Address,
 *   profile: Profile | null,
 *   total: bigint,            // attoCircles (today's CRC) summed across forms
 *   erc1155: bigint,          // attoCircles in HubV2
 *   demurraged: { addr, attoCircles, attoNative },
 *   inflationary: { addr, attoCircles, attoNative },
 * }
 *
 * `attoNative` for demurraged is the wrapper's own balance (== attoCircles, 1:1).
 * `attoNative` for inflationary is the inflationary unit (staticAttoCircles).
 */

// ─── SDK (read-only) ────────────────────────────────────────
let _sdk = null;
function getSdk() {
  if (!_sdk) _sdk = new Sdk();
  return _sdk;
}

// ─── Utilities ──────────────────────────────────────────────
// Pure math/encoders live in ./routing.js — the wrappers below adapt them to
// the module's display-unit state. Display is rounded DOWN to 2 decimals
// (0.01 CRC step) everywhere; sub-0.01 dust is filtered out of the UI, and
// the displayed amount is always ≤ the true balance so Max can never trip
// "insufficient balance by dust".

function unitLabel() {
  return displayUnit === 'static' ? 'CRC (static)' : 'CRC';
}

const toDisplayAtto = (todayAtto, entry) =>
  _toDisplayAtto(todayAtto, entry?._staticFactor ?? 0n, displayUnit);

const fromDisplayAtto = (displayAtto, entry) =>
  _fromDisplayAtto(displayAtto, entry?._staticFactor ?? 0n, displayUnit);

function fmtCrc(todayAtto, entry) {
  const atto = toDisplayAtto(todayAtto, entry);
  if (atto < ATTO_PER_HUNDREDTH) return `< 0.01 ${unitLabel()}`;
  const floored = floorAttoTo2Decimals(atto);
  const n = Number(formatUnits(floored, 18));
  return `${n.toFixed(2)} ${unitLabel()}`;
}

function suffixCrcName(displayName) {
  return `${displayName}-CRC`;
}

function shortAddress(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

function showView(name) {
  const map = {
    disconnected: disconnectedView,
    loading: loadingView,
    balances: balancesView,
    send: sendView,
    error: errorView,
  };
  Object.values(map).forEach((v) => v.classList.add('hidden'));
  map[name]?.classList.remove('hidden');

  if (name === 'send') {
    screenTitle.textContent = 'Send';
    screenSubtitle.textContent = 'Choose recipient, amount, and the form to send in.';
  } else {
    screenTitle.textContent = 'Your CRC balance';
    screenSubtitle.textContent = 'Send CRC you hold directly to others.';
  }
}

function showToast(msg, type = 'info', durationMs = 3500) {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  toastHost.innerHTML = '';
  toastHost.appendChild(t);
  setTimeout(() => t.remove(), durationMs);
}

function avatarInitial(name) {
  return (name || '?').charAt(0).toUpperCase();
}

function setAvatarEl(el, profile, fallbackChar) {
  el.innerHTML = '';
  el.textContent = '';
  const url = profile?.imageUrl || profile?.previewImageUrl;
  const initial = avatarInitial(profile?.name || profile?.registeredName || fallbackChar || '?');
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.onerror = () => {
      el.textContent = initial;
    };
    el.appendChild(img);
  } else {
    el.textContent = initial;
  }
}

// ─── Profiles ───────────────────────────────────────────────

/**
 * Resolve N profiles without tripping the indexer's HTTP 429.
 *
 * Strategy (each step only runs if the previous failed for the affected slots):
 *   1. One big getProfileByAddressBatch call.
 *   2. Split into 20-address batch calls, max 3 in flight at once.
 *   3. For any chunks that still failed, single-address calls with concurrency 4.
 *
 * Returns an array aligned to `addresses` with profile-or-null per slot.
 */
async function fetchProfilesResilient(sdk, addresses) {
  const out = new Array(addresses.length).fill(null);
  const lower = addresses.map((a) => a.toLowerCase());

  // 1. Full-list batch.
  try {
    const r = await sdk.rpc.profile.getProfileByAddressBatch(addresses);
    if (Array.isArray(r)) {
      for (let i = 0; i < addresses.length; i++) out[i] = r[i] || null;
      const hits = out.filter(Boolean).length;
      console.log(`[direct-transfer] profile batch (full): ${hits}/${addresses.length}`);
      return out;
    }
  } catch (e) {
    console.warn('[direct-transfer] full batch failed:', decodeError(e));
  }

  // 2. Chunked batches.
  const CHUNK = 20;
  const chunks = [];
  for (let i = 0; i < addresses.length; i += CHUNK) {
    chunks.push({ start: i, addrs: addresses.slice(i, i + CHUNK) });
  }
  const failedChunkStarts = [];
  await pMap(
    chunks,
    async ({ start, addrs }) => {
      try {
        const r = await sdk.rpc.profile.getProfileByAddressBatch(addrs);
        for (let j = 0; j < addrs.length; j++) out[start + j] = r?.[j] || null;
      } catch (e) {
        console.warn(`[direct-transfer] chunk batch [${start}..] failed:`, decodeError(e));
        failedChunkStarts.push(start);
      }
    },
    3
  );

  // 3. Per-address singles for any remaining failed chunks.
  if (failedChunkStarts.length > 0) {
    const singles = [];
    for (const start of failedChunkStarts) {
      for (let j = 0; j < CHUNK && start + j < addresses.length; j++) {
        singles.push(start + j);
      }
    }
    await pMap(
      singles,
      async (i) => {
        try {
          out[i] = await sdk.rpc.profile.getProfileByAddress(lower[i]);
        } catch (e) {
          // Tolerate 429s and individual failures — leave slot null.
          if (!/429|rate/i.test(decodeError(e))) {
            console.warn(`[direct-transfer] single [${i}] failed:`, decodeError(e));
          }
        }
      },
      4
    );
  }

  const hits = out.filter(Boolean).length;
  console.log(`[direct-transfer] profile resilient: ${hits}/${addresses.length}`);
  return out;
}

/** Run `fn(item, i)` over `items` with at most `concurrency` in flight. */
async function pMap(items, fn, concurrency) {
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

async function getProfile(address) {
  const key = address.toLowerCase();
  if (profileCache.has(key)) return profileCache.get(key);
  const sdk = getSdk();
  let profile = null;
  try {
    profile = await sdk.rpc.profile.getProfileByAddress(address);
  } catch {}
  if (!profile) {
    try {
      profile = await sdk.rpc.profile.getProfileByAddress(address.toLowerCase());
    } catch {}
  }
  profileCache.set(key, profile);
  return profile;
}

function hasAddressField(r) {
  const raw = r?.address || r?.avatarAddress || r?.account || r?.owner || r?.avatar;
  return raw && isAddress(raw);
}

async function searchProfiles(query) {
  const sdk = getSdk();
  // We need each result to carry the avatar address (so we can send to it).
  // `searchProfiles` is the endpoint typed as SearchResultProfile[] with an
  // address field; `searchByAddressOrName` empirically returns plain Profile
  // objects (name/imageUrl only) for text queries, which are unusable.
  // So we try the address-carrying endpoint first.
  let primary = [];
  try {
    // Cap at 30 — the indexer is alphabetical-ish, so a popular name like
    // "paul" can push the right address past 10. 30 covers the common case
    // without flooding the dropdown.
    primary = (await sdk.rpc.profile.searchProfiles(query, 30, 0)) || [];
    console.log('[direct-transfer] searchProfiles ->', primary.length, 'result(s)');
  } catch (e) {
    console.warn('[direct-transfer] searchProfiles failed:', decodeError(e));
  }
  const usablePrimary = primary.filter(hasAddressField);
  if (usablePrimary.length > 0) {
    return { results: usablePrimary, error: null };
  }
  // Fallback: searchByAddressOrName. Mostly useful when the query is an
  // address (the response includes the matched address implicitly), and
  // some indexer versions do include addresses for text queries here.
  try {
    const resp = await sdk.rpc.profile.searchByAddressOrName(query, 30, null);
    const arr = Array.isArray(resp) ? resp : (resp?.results || []);
    console.log('[direct-transfer] searchByAddressOrName ->', arr.length, 'result(s)');
    return { results: arr.filter(hasAddressField), error: null };
  } catch (e) {
    console.warn('[direct-transfer] searchByAddressOrName failed:', decodeError(e));
    return { results: [], error: decodeError(e) };
  }
}

// ─── Receipt polling ────────────────────────────────────────
async function waitForReceipt(hash) {
  const POLL_MS = 3000;
  const TIMEOUT_MS = 3 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const c of receiptClients) {
      try {
        const r = await c.getTransactionReceipt({ hash });
        if (r) return r;
      } catch {
        /* try next */
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for tx ${hash}`);
}

// ─── Balances: fetch and group ──────────────────────────────
async function loadBalances() {
  if (!connectedAddress) return;
  const sdk = getSdk();
  showView('loading');

  let rows = [];
  try {
    rows = await sdk.rpc.balance.getTokenBalances(connectedAddress);
  } catch (err) {
    errorMessageEl.textContent = decodeError(err);
    showView('error');
    return;
  }

  const map = new Map();
  for (const b of rows) {
    const kind = classifyBalance(b);
    if (!kind) continue;
    const issuer = getAddress(b.tokenOwner);
    if (!map.has(issuer)) {
      map.set(issuer, {
        issuer,
        profile: null,
        total: 0n,
        totalStatic: 0n,
        erc1155: 0n,
        erc1155Static: 0n,
        demurraged: { addr: ZERO_ADDRESS, attoCircles: 0n, attoNative: 0n, attoStatic: 0n },
        inflationary: { addr: ZERO_ADDRESS, attoCircles: 0n, attoNative: 0n, attoStatic: 0n },
        _staticFactor: 0n, // static-atto per 1e18 today-atto, derived below
      });
    }
    const entry = map.get(issuer);
    const attoCircles = BigInt(b.attoCircles ?? 0);
    const attoStatic = BigInt(b.staticAttoCircles ?? 0);
    if (kind === 'erc1155') {
      entry.erc1155 += attoCircles;
      entry.erc1155Static += attoStatic;
    } else if (kind === 'demurraged') {
      entry.demurraged.addr = getAddress(b.tokenAddress);
      entry.demurraged.attoCircles += attoCircles;
      entry.demurraged.attoNative += attoCircles; // 1:1 with today's value
      entry.demurraged.attoStatic += attoStatic;
    } else if (kind === 'inflationary') {
      entry.inflationary.addr = getAddress(b.tokenAddress);
      entry.inflationary.attoCircles += attoCircles;
      entry.inflationary.attoNative += attoStatic; // inflationary wrapper unit == static
      entry.inflationary.attoStatic += attoStatic;
    }
    entry.total += attoCircles;
    entry.totalStatic += attoStatic;
    // Compute the demurraged→static factor from whichever row first gives us
    // both values. All rows for a given issuer are at the same "day" so the
    // factor is the same across forms (modulo tiny indexer rounding).
    if (entry._staticFactor === 0n && attoCircles > 0n && attoStatic > 0n) {
      entry._staticFactor = (attoStatic * (10n ** 18n)) / attoCircles;
    }
  }

  // Resolve all issuer profiles. The Circles RPC rate-limits aggressively
  // (HTTP 429) when we fire one request per issuer in parallel, so we cascade:
  //   1. Try one big batch (cheapest in roundtrips when it works).
  //   2. On failure, split into 20-address batches with concurrency 3.
  //   3. For any chunk that ALSO fails, fall back to per-address singles with
  //      concurrency 4 — slow but never trips the rate limiter.
  const issuers = [...map.keys()];
  if (issuers.length > 0) {
    const profiles = await fetchProfilesResilient(sdk, issuers);
    issuers.forEach((addr, i) => {
      const p = profiles?.[i] || null;
      map.get(addr).profile = p;
      profileCache.set(addr.toLowerCase(), p);
    });
  }

  issuerMap = map;
  renderBalances();
  showView('balances');
}

// ─── Render: balances list ──────────────────────────────────
function renderBalances() {
  const hideTiny = hideTinyToggle.checked;
  const query = (balancesSearch?.value || '').trim().toLowerCase();
  const all = [...issuerMap.values()];
  const visible = all
    .filter((e) => (hideTiny ? e.total >= TINY_THRESHOLD_ATTO : e.total > 0n))
    .filter((e) => {
      if (!query) return true;
      const name = (e.profile?.name || '').toLowerCase();
      const reg = (e.profile?.registeredName || '').toLowerCase();
      const desc = (e.profile?.description || '').toLowerCase();
      const addr = e.issuer.toLowerCase();
      return name.includes(query) || reg.includes(query) || desc.includes(query) || addr.includes(query);
    })
    .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : 0));

  balancesList.innerHTML = '';

  if (visible.length === 0) {
    emptyBalances.classList.remove('hidden');
    return;
  }
  emptyBalances.classList.add('hidden');

  for (const entry of visible) {
    const card = document.createElement('div');
    card.className = 'card balance-card';

    const summary = document.createElement('div');
    summary.className = 'balance-summary';
    summary.innerHTML = `
      <button class="balance-toggle" type="button" aria-label="Show breakdown">
        <div class="balance-avatar"></div>
        <div class="balance-info">
          <div class="balance-name"></div>
          <div class="balance-address"></div>
        </div>
        <div class="balance-amount"></div>
        <div class="balance-chevron">▾</div>
      </button>
      <button class="btn-send-inline" type="button">Send</button>
    `;
    setAvatarEl(summary.querySelector('.balance-avatar'), entry.profile, entry.issuer);
    const issuerDisplay =
      entry.profile?.name || entry.profile?.registeredName || shortAddress(entry.issuer);
    summary.querySelector('.balance-name').textContent = suffixCrcName(issuerDisplay);
    summary.querySelector('.balance-address').textContent = shortAddress(entry.issuer);
    summary.querySelector('.balance-amount').textContent = fmtCrc(entry.total, entry);

    summary.querySelector('.balance-toggle').addEventListener('click', () => {
      card.classList.toggle('open');
    });
    summary.querySelector('.btn-send-inline').addEventListener('click', () => {
      openSendScreen(entry);
    });

    const details = document.createElement('div');
    details.className = 'balance-details';
    const desc = entry.profile?.description?.trim();
    const regName = entry.profile?.registeredName;
    const profileBits = [];
    if (regName && regName !== entry.profile?.name) {
      profileBits.push(`<div class="token-meta-row"><span class="detail-label">Registered name</span><span class="detail-value">${escapeHtml(regName)}</span></div>`);
    }
    if (desc) {
      profileBits.push(`<div class="token-description">${escapeHtml(desc)}</div>`);
    }
    profileBits.push(
      `<div class="token-meta-row"><span class="detail-label">Avatar address</span><span class="detail-value mono">${entry.issuer}</span></div>`
    );
    profileBits.push(
      `<div class="token-meta-row"><span class="detail-label">ERC1155 token id</span><span class="detail-value mono" title="${BigInt(entry.issuer).toString()}">${BigInt(entry.issuer).toString()}</span></div>`
    );
    if (entry.demurraged.addr !== ZERO_ADDRESS) {
      profileBits.push(
        `<div class="token-meta-row"><span class="detail-label">ERC20 demurraged</span><span class="detail-value mono">${shortAddress(entry.demurraged.addr)}</span></div>`
      );
    }
    if (entry.inflationary.addr !== ZERO_ADDRESS) {
      profileBits.push(
        `<div class="token-meta-row"><span class="detail-label">ERC20 inflationary</span><span class="detail-value mono">${shortAddress(entry.inflationary.addr)}</span></div>`
      );
    }

    details.innerHTML = `
      ${profileBits.length > 0 ? `<div class="token-meta">${profileBits.join('')}</div>` : ''}
      <div class="detail-row">
        <span class="detail-label">ERC1155 (Hub native)</span>
        <span class="detail-value">${fmtCrc(entry.erc1155, entry)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">ERC20 — Demurraged</span>
        <span class="detail-value">${fmtCrc(entry.demurraged.attoCircles, entry)}</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">ERC20 — Inflationary</span>
        <span class="detail-value">${fmtCrc(entry.inflationary.attoCircles, entry)}</span>
      </div>
    `;
    // mark zero-rows
    details.querySelectorAll('.detail-row').forEach((row, i) => {
      const amounts = [entry.erc1155, entry.demurraged.attoCircles, entry.inflationary.attoCircles];
      if (amounts[i] === 0n) row.querySelector('.detail-value').classList.add('zero');
    });

    card.appendChild(summary);
    card.appendChild(details);
    balancesList.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─── Send screen ────────────────────────────────────────────
async function ensureWrappersResolved(entry) {
  const sdk = getSdk();
  const tasks = [];
  if (entry.demurraged.addr === ZERO_ADDRESS) {
    tasks.push(
      sdk.tokens
        .getDemurragedWrapper(entry.issuer)
        .then((w) => {
          if (w && w !== ZERO_ADDRESS) entry.demurraged.addr = getAddress(w);
        })
        .catch(() => {})
    );
  }
  if (entry.inflationary.addr === ZERO_ADDRESS) {
    tasks.push(
      sdk.tokens
        .getInflationaryWrapper(entry.issuer)
        .then((w) => {
          if (w && w !== ZERO_ADDRESS) entry.inflationary.addr = getAddress(w);
        })
        .catch(() => {})
    );
  }
  if (tasks.length > 0) await Promise.all(tasks);
}

/**
 * Inflationary tokens use a different unit (`staticAttoCircles`) that diverges
 * from today's demurraged value (`attoCircles`) by a time-dependent factor.
 * For any route that wraps/transfers via the inflationary wrapper we need to
 * convert between today-CRC and inflationary native. The conversion ratio
 * comes from the wrapper's pure view `convertDemurrageToInflationaryValue`.
 *
 * We pre-fetch the ratio for 1 CRC (10^18 today-atto) when the send screen
 * opens, so `computeRoute()` can remain synchronous.
 */
async function ensureInflationaryConversion(entry) {
  if (entry.inflationary.addr === ZERO_ADDRESS) return;
  if (entry._inflPerCrcAtto && entry._inflPerCrcAtto > 0n) return;

  // Prefer the on-row ratio if we hold any inflationary already — it's the
  // freshest snapshot and matches the indexer's idea of "today".
  if (entry.inflationary.attoCircles > 0n && entry.inflationary.attoNative > 0n) {
    // ratio per 1e18 today-atto
    entry._inflPerCrcAtto =
      (10n ** 18n * entry.inflationary.attoNative) / entry.inflationary.attoCircles;
    return;
  }
  // Otherwise query the wrapper directly. `day` and `convertDemurrage…` are
  // view/pure on the wrapper — single round-trip via any Gnosis RPC.
  try {
    const client = receiptClients[0];
    const nowTs = BigInt(Math.floor(Date.now() / 1000));
    const day = await client.readContract({
      address: entry.inflationary.addr,
      abi: inflationaryCirclesAbi,
      functionName: 'day',
      args: [nowTs],
    });
    const ratio = await client.readContract({
      address: entry.inflationary.addr,
      abi: inflationaryCirclesAbi,
      functionName: 'convertDemurrageToInflationaryValue',
      args: [10n ** 18n, day],
    });
    entry._inflPerCrcAtto = ratio;
  } catch (e) {
    console.warn('[direct-transfer] inflationary ratio fetch failed:', decodeError(e));
  }
}

function openSendScreen(entry) {
  selectedIssuer = entry;
  selectedRecipient = null;
  recipientInput.value = '';
  recipientResults.innerHTML = '';
  recipientResults.classList.add('hidden');
  recipientSelected.classList.add('hidden');
  recipientClear.classList.add('hidden');
  amountInput.value = '';
  amountHint.textContent = '';
  amountHint.classList.remove('error');
  sendResult.classList.add('hidden');
  // reset target form to ERC1155
  document.querySelector('input[name="target-form"][value="ERC1155"]').checked = true;

  setAvatarEl(sendTokenAvatar, entry.profile, entry.issuer);
  const sendIssuerDisplay =
    entry.profile?.name || entry.profile?.registeredName || shortAddress(entry.issuer);
  sendTokenName.textContent = suffixCrcName(sendIssuerDisplay);
  sendTokenTotal.textContent = fmtCrc(entry.total, entry);

  refreshRoute();
  showView('send');

  // Resolve wrapper addresses and inflationary conversion in the background;
  // refresh the route preview when each piece lands.
  ensureWrappersResolved(entry).then(async () => {
    await ensureInflationaryConversion(entry);
    refreshRoute();
  });
}

function getTargetForm() {
  return document.querySelector('input[name="target-form"]:checked')?.value || 'ERC1155';
}

function parseAmountInputAtto() {
  const raw = (amountInput.value || '').trim();
  if (!raw) return null;
  // Allow "1,5" and "1.5"
  const normalized = raw.replace(',', '.');
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === '.' || normalized === '') return null;
  try {
    // User is typing in the *displayed* unit. Convert back to today-atto so
    // the routing engine (which always works in demurraged) stays simple.
    const inputAtto = parseUnits(normalized, 18);
    return fromDisplayAtto(inputAtto, selectedIssuer);
  } catch {
    return null;
  }
}

// ─── Recipient search (debounced) ───────────────────────────
recipientInput.addEventListener('input', () => {
  const q = recipientInput.value.trim();
  recipientClear.classList.toggle('hidden', q.length === 0);
  if (selectedRecipient) {
    selectedRecipient = null;
    recipientSelected.classList.add('hidden');
    refreshRoute();
  }
  if (pendingSearchTimer) clearTimeout(pendingSearchTimer);
  if (q.length === 0) {
    recipientResults.innerHTML = '';
    recipientResults.classList.add('hidden');
    return;
  }
  // Show "Searching…" immediately so the user has visible feedback.
  recipientResults.innerHTML = '<div class="search-empty">Searching…</div>';
  recipientResults.classList.remove('hidden');
  pendingSearchTimer = setTimeout(async () => {
    try {
      await runSearch(q);
    } catch (e) {
      console.error('[direct-transfer] search render crashed:', e);
      recipientResults.innerHTML = `<div class="search-empty">Search error: ${escapeHtml(decodeError(e))}</div>`;
      recipientResults.classList.remove('hidden');
    }
  }, 200);
});

recipientClear.addEventListener('click', () => {
  recipientInput.value = '';
  recipientClear.classList.add('hidden');
  recipientResults.innerHTML = '';
  recipientResults.classList.add('hidden');
  selectedRecipient = null;
  recipientSelected.classList.add('hidden');
  refreshRoute();
});

async function runSearch(query) {
  const trimmed = query.trim();
  // If the input is no longer this query (user kept typing), bail out so a
  // slower request doesn't overwrite a fresher one.
  if (recipientInput.value.trim() !== trimmed) return;

  let addressMatch = null;
  if (isAddress(trimmed)) addressMatch = getAddress(trimmed);

  const { results, error } = await searchProfiles(trimmed);
  if (recipientInput.value.trim() !== trimmed) return; // stale response

  const out = [...results];

  // If the user pasted an address that didn't appear in the API results,
  // surface it as a manual option so they can always send to an arbitrary
  // address (with or without a Circles profile).
  if (addressMatch && !out.some((r) => (r.address || r.avatarAddress)?.toLowerCase() === addressMatch.toLowerCase())) {
    const profile = await getProfile(addressMatch);
    out.unshift({
      address: addressMatch,
      avatarAddress: addressMatch,
      name: profile?.name,
      description: profile?.description,
      imageUrl: profile?.imageUrl,
      previewImageUrl: profile?.previewImageUrl,
    });
  }

  recipientResults.innerHTML = '';
  recipientResults.classList.remove('hidden');

  // Keep only rows we can send to, and dedupe by address (the pasted-address
  // unshift above can collide with an API result for the same address).
  const seen = new Set();
  const renderable = [];
  for (const r of out) {
    const raw = r.address || r.avatarAddress || r.account || r.owner || r.avatar;
    if (!raw || !isAddress(raw)) continue;
    const addr = getAddress(raw);
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    renderable.push({ ...r, _addr: addr });
  }

  if (renderable.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'search-empty';
    if (error) {
      msg.textContent = `Search failed: ${error}`;
    } else if (isAddress(trimmed)) {
      msg.textContent = 'No matches.';
    } else {
      msg.textContent = 'No matches. Paste a 0x… address to send to any wallet.';
    }
    recipientResults.appendChild(msg);
    return;
  }

  for (const r of renderable) {
    const addr = r._addr;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-result';
    btn.innerHTML = `
      <div class="balance-avatar"></div>
      <div class="search-result-info">
        <div class="search-result-name"></div>
        <div class="search-result-address"></div>
      </div>
    `;
    setAvatarEl(btn.querySelector('.balance-avatar'), r, addr);
    btn.querySelector('.search-result-name').textContent =
      r.name || r.registeredName || shortAddress(addr);
    btn.querySelector('.search-result-address').textContent = addr;
    btn.addEventListener('click', () => selectRecipient({ address: addr, profile: r }));
    recipientResults.appendChild(btn);
  }
}

function selectRecipient({ address, profile }) {
  selectedRecipient = { address, profile };
  recipientResults.innerHTML = '';
  recipientResults.classList.add('hidden');
  recipientInput.value = '';
  recipientClear.classList.add('hidden');
  setAvatarEl(recipientAvatar, profile, address);
  recipientNameEl.textContent =
    profile?.name || profile?.registeredName || shortAddress(address);
  recipientAddressEl.textContent = address;
  recipientSelected.classList.remove('hidden');
  refreshRoute();
}

// ─── Amount handlers ────────────────────────────────────────
amountInput.addEventListener('input', refreshRoute);

maxBtn.addEventListener('click', () => {
  const e = selectedIssuer;
  if (!e) return;
  const target = getTargetForm();
  const total = e.erc1155 + e.demurraged.attoCircles + e.inflationary.attoCircles;
  // Determine the reachable cap for each target, given wrapper-deploy state.
  // Drawing from a wrapper requires it to be deployed (we'd have a balance row
  // for it from the indexer otherwise), but routing TO a wrapper that's not
  // yet deployed is unsupported here (Hub.wrap can deploy but the wrapper
  // address is unknown until that tx executes).
  let cap;
  if (target === 'ERC1155') {
    cap = total;
  } else if (target === 'ERC20_DEM') {
    cap = e.demurraged.addr === ZERO_ADDRESS ? e.demurraged.attoCircles : total;
  } else {
    cap = e.inflationary.addr === ZERO_ADDRESS ? e.inflationary.attoCircles : total;
  }
  // Convert today-atto cap to whatever unit the user is typing in, floor to
  // 2dp so the displayed value always matches what we'll actually send.
  const capDisplay = toDisplayAtto(cap, e);
  const floored = floorAttoTo2Decimals(capDisplay);
  const n = Number(formatUnits(floored, 18));
  amountInput.value = n.toFixed(2);
  refreshRoute();
});

document.querySelectorAll('input[name="target-form"]').forEach((el) => {
  el.addEventListener('change', refreshRoute);
});

backBtn.addEventListener('click', () => {
  selectedIssuer = null;
  selectedRecipient = null;
  showView('balances');
});

// ─── Route computation ──────────────────────────────────────
// Thin UI adapter around the pure `computeRoute` in routing.js: pulls inputs
// from module state, runs the planner, then rewrites the bare-atto step
// labels into nicer human-readable strings honouring the displayUnit.
function computeRoute() {
  const e = selectedIssuer;
  const amountAtto = parseAmountInputAtto();
  const targetForm = getTargetForm();
  const recipient = selectedRecipient?.address ?? null;

  const result = computeRoutePure({
    entry: e,
    amountAtto,
    targetForm,
    recipient,
    fromAddress: connectedAddress,
  });

  // Re-label the routing steps using the prettier display formatter. The pure
  // planner emits atto-string labels so it stays decoupled from the UI.
  if (e && result.steps.length > 0) {
    result.steps = result.steps.map((s) => {
      let label = s.label;
      label = label.replace(/(\d+) atto/g, (m, atto) => fmtCrc(BigInt(atto), e));
      label = label.replace(/0x[a-fA-F0-9]{40}/g, (addr) => shortAddress(addr));
      return { ...s, label };
    });
  }
  if (e && result.errors.length > 0) {
    result.errors = result.errors.map((err) =>
      err.replace(/(\d+) atto/g, (m, atto) => fmtCrc(BigInt(atto), e))
    );
  }
  return result;
}

function refreshRoute() {
  const route = computeRoute();

  routePreview.innerHTML = '';

  if (route.errors.length > 0) {
    if (!selectedRecipient || !parseAmountInputAtto()) {
      routePreview.innerHTML = '<em class="route-empty">Pick recipient and amount to see the route.</em>';
    } else {
      const div = document.createElement('div');
      div.className = 'route-error';
      div.textContent = route.errors[0];
      routePreview.appendChild(div);
    }
    sendBtn.disabled = true;
    return;
  }

  for (let i = 0; i < route.steps.length; i++) {
    const s = route.steps[i];
    const row = document.createElement('div');
    row.className = 'route-step';
    row.innerHTML = `
      <div class="route-step-num">${i + 1}</div>
      <div class="route-step-text"></div>
    `;
    row.querySelector('.route-step-text').textContent = s.label;
    routePreview.appendChild(row);
  }

  for (const w of route.warnings) {
    const div = document.createElement('div');
    div.className = 'route-warning';
    div.textContent = w;
    routePreview.appendChild(div);
  }

  sendBtn.disabled = isSending;
}

// ─── Send action ────────────────────────────────────────────
sendBtn.addEventListener('click', async () => {
  if (isSending) return;
  const route = computeRoute();
  if (route.errors.length > 0 || route.steps.length === 0) return;

  isSending = true;
  sendBtn.disabled = true;
  sendBtnText.textContent = 'Sending…';
  sendBtnSpinner.classList.remove('hidden');
  sendResult.classList.add('hidden');

  try {
    const txs = route.steps.map((s) => s.tx);
    const hashes = await sendTransactions(txs);
    showToast('Transactions submitted, waiting for confirmation…', 'info');
    // Wait for the LAST tx receipt (Safe submits sequentially, so confirming
    // the final one means everything before it landed too).
    const lastHash = hashes[hashes.length - 1];
    const receipt = await waitForReceipt(lastHash);
    if (receipt.status === 'reverted') throw new Error('Transaction reverted on-chain');

    sendResult.classList.remove('hidden');
    sendResult.classList.remove('result-error');
    sendResultIcon.textContent = '✅';
    sendResultMessage.textContent = `Sent successfully. (${hashes.length} tx${hashes.length > 1 ? 's' : ''})`;
    showToast('Transfer confirmed', 'success');

    // Refresh balances in the background and pop back to the list shortly.
    setTimeout(async () => {
      await loadBalances();
    }, 1500);
  } catch (err) {
    console.error('[direct-transfer] send failed:', err);
    sendResult.classList.remove('hidden');
    sendResult.classList.add('result-error');
    sendResultIcon.textContent = '❌';
    sendResultMessage.textContent = `Failed: ${decodeError(err)}`;
    showToast(decodeError(err), 'error', 5000);
  } finally {
    isSending = false;
    sendBtn.disabled = false;
    sendBtnText.textContent = 'Send';
    sendBtnSpinner.classList.add('hidden');
  }
});

// ─── Top-level event handlers ───────────────────────────────
hideTinyToggle.addEventListener('change', renderBalances);
refreshBtn.addEventListener('click', loadBalances);
errorRetryBtn.addEventListener('click', loadBalances);
balancesSearch.addEventListener('input', () => {
  balancesSearchClear.classList.toggle('hidden', balancesSearch.value.length === 0);
  renderBalances();
});

// Unit switch wiring. Re-rendering the balance list + (if open) the send
// screen is enough; internally everything keeps using demurraged-atto.
function applyDisplayUnit(unit) {
  if (unit !== 'demurraged' && unit !== 'static') return;
  displayUnit = unit;
  try { localStorage.setItem('direct-transfer:unit', unit); } catch {}
  document.querySelectorAll('.unit-btn').forEach((b) => {
    const on = b.dataset.unit === unit;
    b.classList.toggle('unit-active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
  const amountUnitEl = document.getElementById('amount-unit');
  if (amountUnitEl) amountUnitEl.textContent = unitLabel();
  renderBalances();
  if (selectedIssuer) {
    sendTokenTotal.textContent = fmtCrc(selectedIssuer.total, selectedIssuer);
    refreshRoute();
  }
}
document.querySelectorAll('.unit-btn').forEach((b) => {
  b.addEventListener('click', () => applyDisplayUnit(b.dataset.unit));
});
// Apply the saved/initial unit so the chip + amount label start correct.
applyDisplayUnit(displayUnit);
balancesSearchClear.addEventListener('click', () => {
  balancesSearch.value = '';
  balancesSearchClear.classList.add('hidden');
  renderBalances();
  balancesSearch.focus();
});

// ─── Wallet connection ──────────────────────────────────────
onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    issuerMap = new Map();
    badge.textContent = 'Not connected';
    badge.className = 'badge badge-disconnected';
    showView('disconnected');
    return;
  }
  connectedAddress = getAddress(address);
  badge.textContent = 'Connected';
  badge.className = 'badge badge-connected';
  await loadBalances();
});

// ─── Standalone mode warning ────────────────────────────────
if (!isMiniappMode()) {
  console.warn('[direct-transfer] Not running inside the Circles MiniApp host.');
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div style="background:#fff9ea;padding:8px 16px;font-size:12px;text-align:center;border-bottom:1px solid #eee7e2">' +
      '⚠️ Standalone mode — wallet operations require the Circles host. ' +
      'Load via <a href="https://circles.gnosis.io/miniapps" target="_blank">circles.gnosis.io/miniapps</a> to test fully.</div>'
  );
}
