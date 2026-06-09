/**
 * NFT Viewer — main.js
 * Read-only gallery of ERC-721 NFTs held by the connected Circles wallet.
 * Data sourced from the Safe Transaction Service API.
 */

import { onWalletChange } from '@aboutcircles/miniapp-sdk';
import { getAddress } from 'viem';
import { gsap } from 'gsap';
import { createAnimator } from './src/animations.js';

// Expose for console debugging. Harmless in production.
if (typeof window !== 'undefined') {
  window.__gsap = gsap;
}

// ============================================================================
// Constants
// ============================================================================

const SAFE_API_BASE = 'https://safe-transaction-gnosis-chain.safe.global';
const IPFS_GATEWAY = 'https://ipfs.io/ipfs';
const BLOCKSCOUT = 'https://gnosis.blockscout.com';

// Gnosis-related NFT to highlight
const GNOSIS_NFT = {
  contract: '0x550eb63E1D2324e45b890b952f749b4150AEfdFa',
  tokenId: '11',
  label: '⭐ Gnosis',
};

const HIDDEN_STORAGE_KEY = 'nft-viewer-hidden';

// ============================================================================
// Animator
// ============================================================================

const animator = createAnimator();

// Expose for console debugging. Harmless in production.
if (typeof window !== 'undefined') {
  window.__animator = animator;
  // Expose a quick replay helper for verifying the entrance animation.
  window.__replayEntrance = () => {
    animator.kill();
    animator.pageEnter({
      topbar: document.querySelector('.topbar'),
      tabs: document.querySelector('.nav-tabs'),
    });
    renderCurrentView();
  };
}

// ============================================================================
// State
// ============================================================================

const state = {
  wallet: null,       // `0x${string}` or null
  nfts: [],           // raw collectibles from Safe API
  loading: false,
  error: null,
  activeTab: 'gallery', // 'gallery' | 'hidden'
  selectedNft: null,  // nft object for detail view
};

// ============================================================================
// DOM helpers
// ============================================================================

function el(tag, opts, ...children) {
  const node = document.createElement(tag);
  if (!opts) {
    // no opts, just append children
  } else if (typeof opts === 'string') {
    node.className = opts;
  } else {
  if (opts.class) node.className = opts.class;
  if (opts.id) node.id = opts.id;
  if (opts.html) node.innerHTML = opts.html;
  if (opts.text) node.textContent = opts.text;
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v != null) node.setAttribute(k, v);
    }
  }
  if (opts.on) {
    for (const [ev, fn] of Object.entries(opts.on)) {
      node.addEventListener(ev, fn);
    }
  }
  }
  for (const c of children.flat(Infinity).filter(Boolean)) {
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function render(node) {
  document.getElementById('view').replaceChildren(node);
}

function toast(message, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = `toast show ${kind}`;
  animator.showToast(t);
  setTimeout(() => {
    animator.hideToast(t);
    setTimeout(() => { t.className = 'toast'; }, 250);
  }, 4250);
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;left:-9999px';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(ta);
  return ok;
}

function copyToClipboard(text, btn) {
  const onSuccess = () => {
    if (btn) {
      const orig = btn.textContent;
      btn.classList.add('copied');
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = orig;
      }, 1500);
    }
    toast('Copied to clipboard', 'success');
  };
  const onFail = () => toast('Failed to copy', 'error');

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(() => {
      if (fallbackCopy(text)) onSuccess();
      else onFail();
    });
  } else {
    if (fallbackCopy(text)) onSuccess();
    else onFail();
  }
}

// ============================================================================
// IPFS utilities
// ============================================================================

function ipfsToHttp(uri) {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) return `${IPFS_GATEWAY}/${uri.slice(7)}`;
  if (uri.startsWith('ipfs/')) return `${IPFS_GATEWAY}/${uri.slice(5)}`;
  if (uri.startsWith('http')) return uri;
  return null;
}

function shortAddr(addr) {
  if (!addr) return '';
  const a = addr.toLowerCase();
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function getNftImage(nft) {
  // Try multiple sources for the image
  const sources = [
    nft.imageUri,
    nft.metadata?.image,
    nft.metadata?.image_url,
    nft.metadata?.animation_url,
  ];
  for (const src of sources) {
    const http = ipfsToHttp(src);
    if (http) return http;
  }
  return null;
}

function getNftName(nft) {
  return nft.name || nft.metadata?.name || `#${nft.id || nft.tokenId || '?'}`;
}

function getNftDescription(nft) {
  return nft.description || nft.metadata?.description || '';
}

// ============================================================================
// Hide / Unhide (localStorage)
// ============================================================================

function getHiddenKeys() {
  try {
    return JSON.parse(localStorage.getItem(HIDDEN_STORAGE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveHiddenKeys(keys) {
  localStorage.setItem(HIDDEN_STORAGE_KEY, JSON.stringify(keys));
}

function nftKey(nft) {
  const addr = (nft.address || nft.tokenAddress || '').toLowerCase();
  const id = String(nft.id || nft.tokenId || '');
  return `${addr}:${id}`;
}

function isHidden(nft) {
  return getHiddenKeys().includes(nftKey(nft));
}

async function hideNft(nft) {
  const card = document.querySelector(`.nft-card[data-key="${cssEscape(nftKey(nft))}"]`);
  // Update state immediately so the re-render is consistent
  const keys = getHiddenKeys();
  const k = nftKey(nft);
  if (!keys.includes(k)) {
    keys.push(k);
    saveHiddenKeys(keys);
  }
  updateHiddenCount();

  if (card) {
    // Animate the card out, then re-render so it disappears
    await animator.removeCard(card);
  }
  renderCurrentView();
  toast('NFT hidden', 'success');
}

async function unhideNft(nft) {
  const keys = getHiddenKeys();
  const k = nftKey(nft);
  const idx = keys.indexOf(k);
  if (idx >= 0) {
    keys.splice(idx, 1);
    saveHiddenKeys(keys);
  }
  updateHiddenCount();
  renderCurrentView();
  toast('NFT unhidden', 'success');
}

function updateHiddenCount() {
  const badge = document.getElementById('hidden-count');
  const count = getHiddenKeys().length;
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// CSS.escape polyfill for older browsers
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}

// ============================================================================
// Zoom / lightbox
// ============================================================================

let activeZoomOverlay = null;
let activeZoomKeyHandler = null;
let activeZoomScrollLock = 0;

function openZoom(nft) {
  if (!nft) return;
  if (activeZoomOverlay) return; // already open

  const srcImg = getNftImage(nft);
  const name = getNftName(nft);
  const collection = nft.tokenName || '';

  // Build the overlay
  const overlay = el('div', { class: 'zoom-overlay' });

  const closeBtn = el('button', {
    class: 'zoom-close',
    attrs: { 'aria-label': 'Close', type: 'button' },
    text: '×',
  });
  overlay.appendChild(closeBtn);

  if (srcImg) {
    const zoomImg = el('img', {
      class: 'zoom-img',
      attrs: { src: srcImg, alt: name, draggable: 'false' },
    });
    overlay.appendChild(zoomImg);

    const caption = el('div', { class: 'zoom-caption' },
      el('div', { class: 'zoom-name' }, name),
      collection ? el('div', { class: 'zoom-collection' }, collection) : null,
    );
    overlay.appendChild(caption);

    // Close on image click (anywhere on the image) — openZoom is reached
    // via image click, so clicking again is the natural way to dismiss.
    zoomImg.addEventListener('click', (e) => {
      e.stopPropagation();
      closeZoom();
    });
  } else {
    // No image — show a placeholder
    overlay.appendChild(el('div', {
      class: 'zoom-img',
      style: 'display:flex;align-items:center;justify-content:center;font-size:6rem;background:#1c1c26;color:#8e8ea0;',
    }, '🖼'));
  }

  // Close on backdrop click (but not on the close button, which has its own handler)
  overlay.addEventListener('click', () => closeZoom());
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeZoom();
  });

  // Escape key
  activeZoomKeyHandler = (e) => {
    if (e.key === 'Escape') closeZoom();
  };
  document.addEventListener('keydown', activeZoomKeyHandler);

  // Body scroll lock
  activeZoomScrollLock = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${activeZoomScrollLock}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.overflow = 'hidden';

  document.body.appendChild(overlay);
  activeZoomOverlay = overlay;

  // Animate in
  const img = overlay.querySelector('.zoom-img');
  const caption = overlay.querySelector('.zoom-caption');
  animator.zoomIn({ backdrop: overlay, img, caption });
}

function closeZoom() {
  if (!activeZoomOverlay) return;
  const overlay = activeZoomOverlay;
  const img = overlay.querySelector('.zoom-img');
  const caption = overlay.querySelector('.zoom-caption');

  // Clean up listeners and body lock immediately so re-opening works
  if (activeZoomKeyHandler) {
    document.removeEventListener('keydown', activeZoomKeyHandler);
    activeZoomKeyHandler = null;
  }
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.overflow = '';
  if (activeZoomScrollLock) {
    window.scrollTo(0, activeZoomScrollLock);
    activeZoomScrollLock = 0;
  }

  activeZoomOverlay = null;

  animator.zoomOut({
    backdrop: overlay,
    img,
    caption,
  }).then(() => {
    overlay.remove();
  });
}

// ============================================================================
// Gnosis NFT highlight
// ============================================================================

function isGnosisNft(nft) {
  const addr = (nft.address || nft.tokenAddress || '').toLowerCase();
  const id = String(nft.id || nft.tokenId || '');
  return addr === GNOSIS_NFT.contract.toLowerCase() && id === GNOSIS_NFT.tokenId;
}

// ============================================================================
// Safe Transaction Service
// ============================================================================

async function fetchWithRetry(url, opts = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, opts);
    if (res.ok) return res;
    if (res.status === 429 && i < retries - 1) {
      const delay = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    return res; // non-429 or exhausted retries
  }
}

async function fetchMetadata(uri) {
  if (!uri) return null;
  try {
    const httpUrl = ipfsToHttp(uri);
    const res = await fetchWithRetry(httpUrl || uri, { signal: AbortSignal.timeout(8000) }, 2);
    if (!res || !res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Limit concurrency of async tasks
async function mapConcurrent(items, fn, limit = 3) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function fetchCollectibles(safeAddress) {
  const allItems = [];
  let url = `${SAFE_API_BASE}/api/v2/safes/${safeAddress}/collectibles/?limit=100`;

  while (url) {
    const res = await fetchWithRetry(url);
    if (!res || !res.ok) {
      throw new Error(`Safe API returned ${res ? res.status : 'network error'}: ${res ? res.statusText : 'fetch failed'}`);
    }
    const data = await res.json();
    // v2 returns { count, next, previous, results: [...] }
    const items = Array.isArray(data) ? data : (data.results || []);
    allItems.push(...items.filter((nft) => nft != null));
    url = data.next || null;
  }

  // Fetch metadata for each NFT (max 3 concurrent) to resolve images and names
  const enriched = await mapConcurrent(allItems, async (nft) => {
    // Already has image from Safe API
    if (nft.imageUri || nft.metadata?.image) return nft;

    // Fetch from token URI
    const meta = await fetchMetadata(nft.uri);
    if (meta) {
      nft.name = nft.name || meta.name || null;
      nft.description = nft.description || meta.description || null;
      nft.imageUri = nft.imageUri || meta.image || meta.image_url || null;
      if (!nft.metadata) nft.metadata = {};
      nft.metadata.image = nft.metadata.image || meta.image || null;
      nft.metadata.image_url = nft.metadata.image_url || meta.image_url || null;
    }
    return nft;
  }, 3);

  return enriched;
}

// ============================================================================
// Sorting: Gnosis NFT first, then alphabetical by collection/name
// ============================================================================

function sortNfts(nfts) {
  return [...nfts].sort((a, b) => {
    const aGnosis = isGnosisNft(a) ? 0 : 1;
    const bGnosis = isGnosisNft(b) ? 0 : 1;
    if (aGnosis !== bGnosis) return aGnosis - bGnosis;

    const aCollection = (a.tokenName || '').toLowerCase();
    const bCollection = (b.tokenName || '').toLowerCase();
    if (aCollection < bCollection) return -1;
    if (aCollection > bCollection) return 1;

    const aName = getNftName(a).toLowerCase();
    const bName = getNftName(b).toLowerCase();
    return aName.localeCompare(bName);
  });
}

// ============================================================================
// Rendering
// ============================================================================

function renderSkeletons() {
  const grid = el('div', 'nft-grid');
  for (let i = 0; i < 8; i++) {
    const card = el('div', 'nft-card');
    card.appendChild(el('div', 'skeleton skeleton-card'));
    card.appendChild(el('div', 'card-body',
      el('div', { class: 'skeleton', style: 'height:14px;width:70%;margin-bottom:6px;border-radius:4px;' }),
      el('div', { class: 'skeleton', style: 'height:10px;width:50%;border-radius:4px;' }),
    ));
    grid.appendChild(card);
  }
  render(grid);
  animator.showSkeleton(grid);
}

function renderNftCard(nft, opts = {}) {
  const { showUnhide = false } = opts;
  const img = getNftImage(nft);
  const name = getNftName(nft);
  const collection = nft.tokenName || shortAddr(nft.address || nft.tokenAddress);
  const highlighted = isGnosisNft(nft);
  const hidden = !showUnhide && isHidden(nft);

  // Skip hidden NFTs in gallery view
  if (hidden) return null;

  const card = el('div', `nft-card${highlighted ? ' highlighted' : ''}${showUnhide ? ' hidden-card' : ''}`);
  card.dataset.key = nftKey(nft);

  // Badge for highlighted NFT
  if (highlighted) {
    card.appendChild(el('span', 'badge', GNOSIS_NFT.label));
  }

  // Hide / Unhide button
  if (showUnhide) {
    const unhideBtn = el('button', { class: 'card-unhide', text: '↩ Show' });
    unhideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      unhideNft(nft);
    });
    card.appendChild(unhideBtn);
  } else {
    const hideBtn = el('button', { class: 'card-hide', text: '✕ Hide' });
    hideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hideNft(nft);
    });
    card.appendChild(hideBtn);
  }

  // Image
  if (img) {
    const imgEl = el('img', {
      class: 'card-img',
      attrs: { src: img, alt: name, loading: 'lazy' },
      on: {
        error: (e) => {
          // On image load failure, replace with placeholder
          e.target.replaceWith(el('div', 'card-img placeholder', '🖼'));
        },
      },
    });
    card.appendChild(imgEl);
  } else {
    card.appendChild(el('div', 'card-img placeholder', '🖼'));
  }

  // Body
  const body = el('div', 'card-body');
  body.appendChild(el('div', 'card-name', name));
  body.appendChild(el('div', 'card-collection', collection));
  card.appendChild(body);

  // Click → detail (async, awaits the morph)
  card.addEventListener('click', () => {
    openDetail(nft, card);
  });

  return card;
}

function renderGallery() {
  const hiddenKeys = getHiddenKeys();
  const visible = sortNfts(state.nfts.filter((nft) => !hiddenKeys.includes(nftKey(nft))));

  if (visible.length === 0) {
    const empty = el('div', 'empty-state',
      el('span', { class: 'icon' }, '🖼'),
      el('p', {}, state.nfts.length === 0
        ? 'No NFTs found in this wallet'
        : 'All NFTs are hidden. Check the Hidden tab.'),
    );
    render(empty);
    animator.showEmpty(empty);
    return;
  }

  const grid = el('div', 'nft-grid');
  for (const nft of visible) {
    const card = renderNftCard(nft);
    if (card) grid.appendChild(card);
  }
  render(grid);
  animator.showGrid(Array.from(grid.children));

  // Pulse the highlighted (Gnosis) card
  const gnosisCard = grid.querySelector('.nft-card.highlighted');
  if (gnosisCard) animator.pulseHighlighted(gnosisCard);
}

function renderHidden() {
  const hiddenKeys = getHiddenKeys();
  const hidden = sortNfts(state.nfts.filter((nft) => hiddenKeys.includes(nftKey(nft))));

  if (hidden.length === 0) {
    const empty = el('div', 'empty-state',
      el('span', { class: 'icon' }, '👁'),
      el('p', {}, 'No hidden NFTs'),
    );
    render(empty);
    animator.showEmpty(empty);
    return;
  }

  const grid = el('div', 'nft-grid');
  for (const nft of hidden) {
    const card = renderNftCard(nft, { showUnhide: true });
    if (card) grid.appendChild(card);
  }
  render(grid);
  animator.showGrid(Array.from(grid.children));
}

function renderDetail(nft) {
  const img = getNftImage(nft);
  const name = getNftName(nft);
  const desc = getNftDescription(nft);
  const contractAddr = nft.address || nft.tokenAddress || '';
  const tokenId = String(nft.id || nft.tokenId || '');
  const collection = nft.tokenName || '';
  const highlighted = isGnosisNft(nft);

  const container = el('div');

  // Back button
  const back = el('button', { class: 'back-btn', text: '← Back to gallery' });
  back.addEventListener('click', () => {
    closeDetail(nft);
  });
  container.appendChild(back);

  const detail = el('div', 'detail');

  // Image
  if (img) {
    const imgEl = el('img', {
      class: 'detail-img',
      attrs: { src: img, alt: name, draggable: 'false' },
      on: {
        click: () => openZoom(nft),
        error: (e) => {
          e.target.replaceWith(el('div', 'detail-img placeholder', '🖼'));
        },
      },
    });
    detail.appendChild(imgEl);
  } else {
    detail.appendChild(el('div', 'detail-img placeholder', '🖼'));
  }

  // Info panel
  const info = el('div', 'detail-info');
  info.appendChild(el('h2', {}, name));
  info.appendChild(el('div', 'collection',
    highlighted ? `${GNOSIS_NFT.label} · ${collection}` : collection,
  ));

  // Contract address row
  const contractRow = el('div', 'meta-row');
  contractRow.appendChild(el('span', 'meta-label', 'Contract'));
  try {
    const checksummed = getAddress(contractAddr);
    contractRow.appendChild(el('span', 'meta-value', checksummed));
    const copyBtn = el('button', { class: 'copy-btn', text: 'Copy' });
    copyBtn.addEventListener('click', () => copyToClipboard(checksummed, copyBtn));
    contractRow.appendChild(copyBtn);
  } catch {
    contractRow.appendChild(el('span', 'meta-value', contractAddr));
  }
  info.appendChild(contractRow);

  // Token ID row
  const idRow = el('div', 'meta-row');
  idRow.appendChild(el('span', 'meta-label', 'Token ID'));
  idRow.appendChild(el('span', 'meta-value', tokenId));
  info.appendChild(idRow);

  // Blockscout link (copy-only, no external navigation in miniapp iframe)
  if (contractAddr && tokenId) {
    const linkRow = el('div', 'meta-row');
    linkRow.appendChild(el('span', 'meta-label', 'Explorer'));
    const blockscoutUrl = `${BLOCKSCOUT}/token/${contractAddr}/instance/${tokenId}`;
    const urlText = el('span', 'meta-value', `${BLOCKSCOUT}/token/…/${tokenId}`);
    linkRow.appendChild(urlText);
    const copyBtn = el('button', { class: 'copy-btn', text: '📋' });
    copyBtn.addEventListener('click', () => copyToClipboard(blockscoutUrl, copyBtn));
    linkRow.appendChild(copyBtn);
    info.appendChild(linkRow);
  }

  // Description
  if (desc) {
    info.appendChild(el('div', 'description', desc));
  }

  // Hide/Unhide button in detail
  const actionRow = el('div', { class: 'row', style: 'margin-top:16px;' });
  if (isHidden(nft)) {
    const unhideBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '↩ Unhide NFT' });
    unhideBtn.addEventListener('click', async () => {
      await unhideNft(nft);
      // After unhide, the active tab decides where to go.
      // If we're in the gallery tab, go back to it.
      state.selectedNft = null;
      renderCurrentView();
    });
    actionRow.appendChild(unhideBtn);
  } else {
    const hideBtn = el('button', { class: 'btn btn-danger btn-sm', text: '✕ Hide NFT' });
    hideBtn.addEventListener('click', () => {
      // hideNft animates the (now-removed) card, then re-renders the
      // current view which restages the grid with a stagger.
      hideNft(nft);
      state.selectedNft = null;
    });
    actionRow.appendChild(hideBtn);
  }
  info.appendChild(actionRow);

  detail.appendChild(info);
  container.appendChild(detail);
  render(container);

  return { container, info };
}

// ============================================================================
// Detail transitions (image-morph open/close)
// ============================================================================

// openDetail / closeDetail used to animate an image morph between the
// card and detail view. The hand-rolled clone-and-animate approach was
// glitchy in practice, so the detail view now appears instantly and only
// the info rows stagger in. The functions remain in the animator for
// the future, but the morph-specific plumbing is gone.

async function openDetail(nft, _cardEl) {
  state.selectedNft = nft;
  const { info } = renderDetail(nft);
  const detailImg = document.querySelector('.detail-img');
  // Image and info rows animate in parallel — both run for the same
  // ~0.7s window so the detail view feels cohesive.
  await Promise.all([
    detailImg ? animator.showDetailImage(detailImg) : Promise.resolve(),
    animator.openDetail({ infoEl: info }),
  ]);
}

// closeDetail used to also call animator.closeDetail, but the hand-rolled
// morph was removed and that call became redundant — it overlapped with
// showGrid (which renderCurrentView already triggers) and reset the cards
// to opacity:0 mid-animation, leaving the gallery looking blank.
function closeDetail(_nft) {
  state.selectedNft = null;
  renderCurrentView();
}

function renderError(message) {
  const container = el('div', 'empty-state',
    el('span', { class: 'icon' }, '⚠️'),
    el('p', {}, message),
  );
  const retryBtn = el('button', { class: 'btn btn-primary', style: 'margin-top:12px;' }, 'Retry');
  retryBtn.addEventListener('click', () => loadNfts());
  container.appendChild(retryBtn);
  render(container);
  animator.showError(container);
}

function renderConnectWallet() {
  const empty = el('div', 'empty-state',
    el('span', { class: 'icon' }, '👛'),
    el('p', {}, 'Connect your wallet to view NFTs'),
  );
  render(empty);
  animator.showEmpty(empty);
}

function renderCurrentView() {
  if (state.selectedNft) {
    renderDetail(state.selectedNft);
    return;
  }
  if (state.activeTab === 'hidden') {
    renderHidden();
  } else {
    renderGallery();
  }
}

// ============================================================================
// Loading
// ============================================================================

async function loadNfts() {
  if (!state.wallet) {
    renderConnectWallet();
    return;
  }

  state.loading = true;
  state.error = null;
  renderSkeletons();

  try {
    state.nfts = await fetchCollectibles(state.wallet);
    state.loading = false;
    renderCurrentView();
  } catch (err) {
    state.loading = false;
    state.error = err.message;
    renderError(`Failed to load NFTs: ${err.message}`);
  }
}

// ============================================================================
// Tab navigation
// ============================================================================

function initTabs() {
  const tabs = document.querySelectorAll('#tabs .tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      state.activeTab = target;
      state.selectedNft = null; // clear detail on tab switch

      tabs.forEach((t) => t.classList.toggle('active', t === tab));
      renderCurrentView();
    });
  });
}

// ============================================================================
// Wallet chip
// ============================================================================

function updateWalletChip(address) {
  const chip = document.getElementById('wallet-chip');
  if (address) {
    try {
      chip.textContent = shortAddr(getAddress(address));
    } catch {
      chip.textContent = shortAddr(address);
    }
  } else {
    chip.textContent = '';
  }
}

// ============================================================================
// Boot
// ============================================================================

initTabs();
updateHiddenCount();

// First-paint entrance: topbar + tabs drop in. The view content is
// animated separately by showEmpty / showGrid / showSkeleton as it loads.
animator.pageEnter({
  topbar: document.querySelector('.topbar'),
  tabs: document.querySelector('.nav-tabs'),
});

onWalletChange((address) => {
  state.wallet = address;
  updateWalletChip(address);
  if (address) {
    loadNfts();
  } else {
    // Standalone/dev mode: use ?wallet=0x... param if no miniapp wallet
    const urlParams = new URLSearchParams(window.location.search);
    const devWallet = urlParams.get('wallet');
    if (devWallet) {
      state.wallet = devWallet;
      updateWalletChip(devWallet);
      loadNfts();
    } else {
      state.nfts = [];
      renderConnectWallet();
    }
  }
});