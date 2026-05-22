/**
 * NFT Viewer — main.js
 * Read-only gallery of ERC-721 NFTs held by the connected Circles wallet.
 * Data sourced from the Safe Transaction Service API.
 */

import { onWalletChange } from '@aboutcircles/miniapp-sdk';
import { getAddress } from 'viem';

// ============================================================================
// Constants
// ============================================================================

const SAFE_API_BASE = 'https://safe-transaction-gnosis.safe.global';
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
  if (!opts) return node;
  if (typeof opts === 'string') { node.className = opts; return node; }
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
  setTimeout(() => { t.className = 'toast'; }, 4500);
}

function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    if (btn) {
      btn.classList.add('copied');
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = 'Copy';
      }, 1500);
    }
    toast('Copied to clipboard', 'success');
  }).catch(() => toast('Failed to copy', 'error'));
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

function hideNft(nft) {
  const keys = getHiddenKeys();
  const k = nftKey(nft);
  if (!keys.includes(k)) {
    keys.push(k);
    saveHiddenKeys(keys);
  }
  updateHiddenCount();
  renderCurrentView();
  toast('NFT hidden', 'success');
}

function unhideNft(nft) {
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

async function fetchCollectibles(safeAddress) {
  const url = `${SAFE_API_BASE}/api/v1/safes/${safeAddress}/collectibles/`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Safe API returned ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();
  // API returns an array directly, or may wrap in { results: [...] }
  const items = Array.isArray(data) ? data : (data.results || []);
  return items.filter((nft) => nft != null);
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

  // Click → detail
  card.addEventListener('click', () => {
    state.selectedNft = nft;
    renderDetail(nft);
  });

  return card;
}

function renderGallery() {
  const hiddenKeys = getHiddenKeys();
  const visible = sortNfts(state.nfts.filter((nft) => !hiddenKeys.includes(nftKey(nft))));

  if (visible.length === 0) {
    render(el('div', 'empty-state',
      el('span', { class: 'icon' }, '🖼'),
      el('p', {}, state.nfts.length === 0
        ? 'No NFTs found in this wallet'
        : 'All NFTs are hidden. Check the Hidden tab.'),
    ));
    return;
  }

  const grid = el('div', 'nft-grid');
  for (const nft of visible) {
    const card = renderNftCard(nft);
    if (card) grid.appendChild(card);
  }
  render(grid);
}

function renderHidden() {
  const hiddenKeys = getHiddenKeys();
  const hidden = sortNfts(state.nfts.filter((nft) => hiddenKeys.includes(nftKey(nft))));

  if (hidden.length === 0) {
    render(el('div', 'empty-state',
      el('span', { class: 'icon' }, '👁'),
      el('p', {}, 'No hidden NFTs'),
    ));
    return;
  }

  const grid = el('div', 'nft-grid');
  for (const nft of hidden) {
    const card = renderNftCard(nft, { showUnhide: true });
    if (card) grid.appendChild(card);
  }
  render(grid);
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
    state.selectedNft = null;
    renderCurrentView();
  });
  container.appendChild(back);

  const detail = el('div', 'detail');

  // Image
  if (img) {
    detail.appendChild(el('img', {
      class: 'detail-img',
      attrs: { src: img, alt: name },
      on: {
        error: (e) => {
          e.target.replaceWith(el('div', 'detail-img placeholder', '🖼'));
        },
      },
    }));
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

  // Blockscout link
  if (contractAddr && tokenId) {
    const linkRow = el('div', 'meta-row');
    linkRow.appendChild(el('span', 'meta-label', 'Explorer'));
    const blockscoutUrl = `${BLOCKSCOUT}/token/${contractAddr}/instance/${tokenId}`;
    linkRow.appendChild(el('a', {
      class: 'meta-value',
      html: `${BLOCKSCOUT}/token/…/${tokenId}`,
      attrs: { href: blockscoutUrl, target: '_blank', rel: 'noopener' },
    }));
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
    unhideBtn.addEventListener('click', () => {
      unhideNft(nft);
      renderDetail(nft); // re-render detail
    });
    actionRow.appendChild(unhideBtn);
  } else {
    const hideBtn = el('button', { class: 'btn btn-danger btn-sm', text: '✕ Hide NFT' });
    hideBtn.addEventListener('click', () => {
      hideNft(nft);
      renderDetail(nft); // re-render detail
    });
    actionRow.appendChild(hideBtn);
  }
  info.appendChild(actionRow);

  detail.appendChild(info);
  container.appendChild(detail);
  render(container);
}

function renderError(message) {
  render(el('div', 'empty-state',
    el('span', { class: 'icon' }, '⚠️'),
    el('p', {}, message),
  ));
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
    render(el('div', 'empty-state',
      el('span', { class: 'icon' }, '👛'),
      el('p', {}, 'Connect your wallet to view NFTs'),
    ));
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

onWalletChange((address) => {
  state.wallet = address;
  updateWalletChip(address);
  if (address) {
    loadNfts();
  } else {
    state.nfts = [];
    render(el('div', 'empty-state',
      el('span', { class: 'icon' }, '👛'),
      el('p', {}, 'Connect your wallet to view NFTs'),
    ));
  }
});