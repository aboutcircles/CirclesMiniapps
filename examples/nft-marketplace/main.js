import {
  onWalletChange,
  sendTransactions,
  isMiniappMode,
  isDevMode,
} from './src/wallet.js';
import { encodeFunctionData, getAddress, parseUnits, parseEther } from 'viem';
import {
  FACTORY_ADDRESS,
  factoryAbi,
  editionAbi,
  isConfigured,
} from './src/contracts.js';
import {
  getPublicClient,
  ipfsToHttp,
  shortAddr,
  formatCrc,
} from './src/clients.js';
import {
  getAllCollections,
  getActiveListings,
  getOwnedTokens,
  fetchMetadata,
  invalidate as invalidateIndex,
} from './src/indexer.js';

// ============================================================================
// State
// ============================================================================

const state = {
  wallet: null,
  myCollection: null,
};

let walletPromise;
const walletReady = new Promise((resolve) => {
  walletPromise = resolve;
});

// ============================================================================
// DOM helpers
// ============================================================================

const $view = document.getElementById('view');
const $walletChip = document.getElementById('walletChip');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

function el(tag, opts = {}, ...children) {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.id) node.id = opts.id;
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  if (opts.on) for (const [evt, fn] of Object.entries(opts.on)) node.addEventListener(evt, fn);
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) node.append(...c.filter(Boolean));
    else if (typeof c === 'string') node.append(document.createTextNode(c));
    else node.append(c);
  }
  return node;
}

function render(node) {
  $view.replaceChildren(node);
}

let toastTimer;
function toast(message, kind = 'success') {
  $toast.className = `toast ${kind}`;
  $toast.textContent = message;
  $toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.add('hidden'), 4500);
}

/**
 * Show a modal and resolve with the user's choice. Pass a `body` node and an
 * array of `actions: [{ label, kind?, value }]`. `kind` accepts the same class
 * suffix as buttons (default primary, `secondary`, `danger`). Closing via the
 * backdrop resolves with `null`.
 */
function modal({ title, subtitle, body, actions }) {
  return new Promise((resolve) => {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const dialog = el('div', { class: 'modal' });
    if (title) dialog.append(el('h3', { text: title }));
    if (subtitle) dialog.append(el('p', { class: 'subtitle', text: subtitle }));
    if (body) dialog.append(body);
    const actionsRow = el('div', { class: 'actions' });
    for (const a of actions) {
      const btn = el('button', {
        class: a.kind === 'secondary' ? 'btn-secondary' : a.kind === 'danger' ? 'danger' : '',
        text: a.label,
        on: {
          click: () => {
            document.body.removeChild(backdrop);
            resolve(a.value);
          },
        },
      });
      actionsRow.append(btn);
    }
    dialog.append(actionsRow);
    backdrop.append(dialog);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        document.body.removeChild(backdrop);
        resolve(null);
      }
    });
    document.body.append(backdrop);
  });
}

async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      btn.classList.add('copied');
      const original = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = original;
      }, 1500);
    }
  } catch {
    toast('Failed to copy', 'error');
  }
}

function explorerTx(hash) {
  return `https://gnosisscan.io/tx/${hash}`;
}

// ============================================================================
// Wallet
// ============================================================================

onWalletChange(async (address) => {
  state.wallet = address ? getAddress(address) : null;
  $walletChip.className = `wallet-chip ${state.wallet ? 'connected' : 'disconnected'}`;
  $walletChip.innerHTML = state.wallet
    ? `Connected <span class="addr">${shortAddr(state.wallet)}</span>`
    : 'Not connected';
  state.myCollection = null;
  if (state.wallet && isConfigured()) {
    try {
      const collection = await getPublicClient().readContract({
        address: FACTORY_ADDRESS,
        abi: factoryAbi,
        functionName: 'collectionOf',
        args: [state.wallet],
      });
      state.myCollection = collection === '0x0000000000000000000000000000000000000000'
        ? null
        : getAddress(collection);
    } catch (err) {
      console.error('collectionOf read failed', err);
    }
  }
  walletPromise(true);
  route();
});

if (isDevMode()) {
  document.querySelector('.brand').insertAdjacentHTML(
    'beforeend',
    ' <span class="pill pill-warn" style="margin-left:8px;font-size:10px;">DEV</span>',
  );
}

// ============================================================================
// Router
// ============================================================================

const routes = [
  { match: /^#?\/?$/, view: viewGallery },
  { match: /^#\/mint$/, view: viewMint },
  { match: /^#\/me$/, view: viewMyCollection },
  { match: /^#\/wall$/, view: viewMyWall },
  { match: /^#\/onboard$/, view: viewOnboard },
  { match: /^#\/nft\/([^/]+)\/([^/]+)$/, view: (m) => viewNftDetail(m[1], m[2]) },
  { match: /^#\/buy\/(.+)$/, view: (m) => viewBuy(m[1]) },
];

function route() {
  const hash = location.hash || '#/';
  for (const r of routes) {
    const m = hash.match(r.match);
    if (m) {
      updateNavActive(hash);
      r.view(m);
      return;
    }
  }
  render(emptyState('Page not found', 'The page you tried to open does not exist.'));
}

function updateNavActive(hash) {
  for (const a of $nav.querySelectorAll('a')) {
    const target = a.getAttribute('href');
    a.classList.toggle('active', target === hash || (target === '#/' && hash === '#/'));
  }
}

window.addEventListener('hashchange', route);

// ============================================================================
// Building blocks
// ============================================================================

function configBanner() {
  if (isConfigured()) return null;
  return el('div', { class: 'banner pending' },
    el('strong', {}, 'Setup required: '),
    'Set ',
    el('code', { text: 'VITE_FACTORY_ADDRESS' }),
    ' and ',
    el('code', { text: 'VITE_DEPLOY_BLOCK' }),
    ' (factory deploy block) before the app can read on-chain state.',
  );
}

function connectedGuard() {
  if (state.wallet) return null;
  return el('div', { class: 'card' },
    el('h2', { text: 'Wallet not connected' }),
    el('p', { class: 'subtitle', text: 'Open this miniapp from inside the Gnosis wallet to connect.' }),
  );
}

function emptyState(title, body) {
  return el('div', { class: 'card empty' },
    el('h3', { text: title }),
    el('p', { text: body }),
  );
}

function skeletonGrid(n = 6) {
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push(el('div', { class: 'nft-card' },
      el('div', { class: 'img skeleton' }),
      el('div', { class: 'meta' },
        el('div', { class: 'skeleton', attrs: { style: 'height: 14px; width: 70%;' } }),
        el('div', { class: 'skeleton', attrs: { style: 'height: 12px; width: 40%;' } }),
      ),
    ));
  }
  return el('div', { class: 'grid' }, ...items);
}

function addressKvRow(label, address) {
  const copyBtn = el('button', {
    class: 'copy-btn',
    text: 'Copy',
    attrs: { title: address },
  });
  copyBtn.addEventListener('click', (e) => {
    e.preventDefault();
    copyToClipboard(address, copyBtn);
  });
  return el('div', { class: 'kv-row' },
    el('span', { class: 'k', text: label }),
    el('span', { class: 'v' },
      el('span', { class: 'address', text: shortAddr(address) }),
      ' ',
      copyBtn,
    ),
  );
}

function nftCard({ collection, tokenId, image, title, priceLabel, href }) {
  const card = el('a', {
    class: 'nft-card',
    attrs: { href: href || `#/nft/${collection}/${tokenId}` },
  },
    el('div', {
      class: 'img',
      attrs: image ? { style: `background-image: url('${image}')` } : {},
    }),
    el('div', { class: 'meta' },
      el('div', { class: 'title', text: title || `#${tokenId}` }),
      priceLabel
        ? el('div', { class: 'price', html: priceLabel })
        : el('div', { class: 'price', text: 'Not listed' }),
    ),
  );
  return card;
}

// ============================================================================
// View: Gallery (#/)
// ============================================================================

async function viewGallery() {
  const banner = configBanner();
  const container = el('div', {},
    banner,
    el('div', { class: 'card' },
      el('h1', { text: 'Gallery' }),
      el('p', { class: 'subtitle', text: 'Editions listed for sale across all creators. Priced in s-gCRC.' }),
      el('div', { id: 'galleryGrid' }, skeletonGrid(6)),
    ),
  );
  render(container);
  if (!isConfigured()) return;

  try {
    const collections = await getAllCollections();
    if (collections.length === 0) {
      document.getElementById('galleryGrid').replaceWith(
        emptyState('No collections yet', 'Be the first - mint and list an NFT to start the wall.'),
      );
      return;
    }
    const listings = await getActiveListings(collections);
    if (listings.length === 0) {
      document.getElementById('galleryGrid').replaceWith(
        emptyState('No active listings', 'Creators have minted but nothing is for sale right now.'),
      );
      return;
    }
    const cards = [];
    for (const l of listings) {
      cards.push(await listingCard(l));
    }
    document.getElementById('galleryGrid').replaceWith(el('div', { class: 'grid' }, ...cards));
  } catch (err) {
    document.getElementById('galleryGrid').replaceWith(
      emptyState('Failed to load gallery', err.message),
    );
  }
}

async function listingCard(listing) {
  let title = `#${listing.tokenId}`;
  let image = null;
  try {
    const uri = await getPublicClient().readContract({
      address: listing.collection,
      abi: editionAbi,
      functionName: 'tokenURI',
      args: [listing.tokenId],
    });
    const meta = await fetchMetadata(uri);
    if (meta) {
      if (meta.name) title = meta.name;
      if (meta.image) image = ipfsToHttp(meta.image);
    }
  } catch {}
  return nftCard({
    collection: listing.collection,
    tokenId: listing.tokenId.toString(),
    title,
    image,
    priceLabel: `<strong>${formatCrc(listing.price)}</strong> s-gCRC`,
  });
}

// ============================================================================
// View: Onboarding (#/onboard) - create first collection
// ============================================================================

function viewOnboard() {
  const guard = connectedGuard();
  if (guard) { render(guard); return; }

  if (state.myCollection) {
    render(el('div', { class: 'card empty' },
      el('h3', { text: 'You already have a collection' }),
      el('p', {}, 'Your collection: ', el('span', { class: 'address', text: state.myCollection })),
      el('div', { class: 'actions' },
        el('a', { class: 'btn', attrs: { href: '#/me' }, text: 'Open my collection' }),
      ),
    ));
    return;
  }

  const card = el('div', { class: 'card' },
    el('h1', { text: 'Create your collection' }),
    el('p', { class: 'subtitle', text: 'Deploy your own NFT contract clone. One-time setup, runs on Gnosis. After this you can mint and list editions.' }),
    el('div', { class: 'field' },
      el('label', { text: 'Collection name' }),
      el('input', { id: 'colName', attrs: { type: 'text', placeholder: 'e.g. Shorn Editions' } }),
    ),
    el('div', { class: 'field' },
      el('label', { text: 'Symbol' }),
      el('input', { id: 'colSym', attrs: { type: 'text', placeholder: 'e.g. SHORN', maxlength: '12' } }),
    ),
    el('button', { class: 'full', id: 'createBtn', text: 'Create collection' }),
    el('div', { class: 'banner pending', id: 'createStatus', attrs: { style: 'display:none' } }),
  );
  render(card);

  const $name = document.getElementById('colName');
  const $sym = document.getElementById('colSym');
  const $btn = document.getElementById('createBtn');
  const $status = document.getElementById('createStatus');

  $btn.addEventListener('click', async () => {
    const name = $name.value.trim();
    const symbol = $sym.value.trim().toUpperCase();
    if (!name || !symbol) {
      toast('Name and symbol are required', 'error');
      return;
    }
    if (!isConfigured()) {
      toast('Factory address not set - cannot deploy', 'error');
      return;
    }
    $btn.disabled = true;
    $status.style.display = 'block';
    $status.textContent = 'Requesting approval from the host wallet...';
    try {
      const data = encodeFunctionData({
        abi: factoryAbi,
        functionName: 'createCollection',
        args: [name, symbol],
      });
      const hashes = await sendTransactions([{ to: FACTORY_ADDRESS, data, value: '0' }]);
      $status.textContent = 'Submitted. Waiting for confirmation...';
      invalidateIndex();
      // Refresh collectionOf
      let collection = '0x0000000000000000000000000000000000000000';
      for (let i = 0; i < 30 && collection === '0x0000000000000000000000000000000000000000'; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          collection = await getPublicClient().readContract({
            address: FACTORY_ADDRESS,
            abi: factoryAbi,
            functionName: 'collectionOf',
            args: [state.wallet],
          });
        } catch {}
      }
      if (collection !== '0x0000000000000000000000000000000000000000') {
        state.myCollection = getAddress(collection);
        toast('Collection created');
        location.hash = '#/me';
      } else {
        $status.innerHTML = `Pending. Check tx: <a href="${explorerTx(hashes[0])}" target="_blank">${hashes[0]}</a>`;
      }
    } catch (err) {
      $status.className = 'banner error';
      $status.textContent = 'Failed: ' + err.message;
      $btn.disabled = false;
    }
  });
}

// ============================================================================
// View: Mint (#/mint)
// ============================================================================

function viewMint() {
  const guard = connectedGuard();
  if (guard) { render(guard); return; }
  if (!state.myCollection) {
    render(el('div', { class: 'card empty' },
      el('h3', { text: 'Create a collection first' }),
      el('p', { text: 'You need your own collection contract before you can mint.' }),
      el('div', { class: 'actions' },
        el('a', { class: 'btn', attrs: { href: '#/onboard' }, text: 'Create collection' }),
      ),
    ));
    return;
  }

  const card = el('div', { class: 'card' },
    el('h1', { text: 'Mint a new edition' }),
    el('p', { class: 'subtitle' },
      'Mints to your collection ',
      el('span', { class: 'address', text: shortAddr(state.myCollection) }),
      '. Image is pinned to IPFS via Filebase.',
    ),
    el('div', { class: 'field' },
      el('label', { text: 'Image (PNG, JPG, WebP or GIF · max 5 MB)' }),
      el('input', { id: 'mintFile', attrs: { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif' } }),
      el('div', { class: 'image-preview', id: 'mintPreview' }),
    ),
    el('div', { class: 'field' },
      el('label', { text: 'Title' }),
      el('input', { id: 'mintTitle', attrs: { type: 'text', placeholder: 'Edition title' } }),
    ),
    el('div', { class: 'field' },
      el('label', { text: 'Description' }),
      el('textarea', { id: 'mintDesc', attrs: { placeholder: 'Short description' } }),
    ),
    el('button', { class: 'full', id: 'mintBtn', text: 'Mint' }),
    el('div', { class: 'banner pending', id: 'mintStatus', attrs: { style: 'display:none' } }),
  );
  render(card);

  const $file = document.getElementById('mintFile');
  const $title = document.getElementById('mintTitle');
  const $desc = document.getElementById('mintDesc');
  const $btn = document.getElementById('mintBtn');
  const $status = document.getElementById('mintStatus');
  const $preview = document.getElementById('mintPreview');

  let previewUrl = null;
  $file.addEventListener('change', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = $file.files?.[0];
    if (!file) {
      $preview.style.backgroundImage = '';
      $preview.classList.remove('has-image');
      previewUrl = null;
      return;
    }
    previewUrl = URL.createObjectURL(file);
    $preview.style.backgroundImage = `url('${previewUrl}')`;
    $preview.classList.add('has-image');
  });

  $btn.addEventListener('click', async () => {
    const file = $file.files?.[0];
    const title = $title.value.trim();
    const description = $desc.value.trim();
    if (!file) { toast('Please choose an image', 'error'); return; }
    if (!title) { toast('Title is required', 'error'); return; }

    $btn.disabled = true;
    $status.style.display = 'block';
    $status.className = 'banner pending';
    $status.textContent = 'Uploading image to IPFS...';

    try {
      const imageRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!imageRes.ok) throw new Error('image upload failed: ' + (await imageRes.text()));
      const { cid: imageCid } = await imageRes.json();

      $status.textContent = 'Pinning metadata...';
      const metadata = {
        name: title,
        description,
        image: `ipfs://${imageCid}`,
      };
      const metaRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(metadata),
      });
      if (!metaRes.ok) throw new Error('metadata upload failed: ' + (await metaRes.text()));
      const { cid: metaCid } = await metaRes.json();
      const tokenURI = `ipfs://${metaCid}`;

      $status.textContent = 'Requesting mint approval from the host wallet...';
      const data = encodeFunctionData({
        abi: editionAbi,
        functionName: 'mint',
        args: [tokenURI],
      });
      const hashes = await sendTransactions([{ to: state.myCollection, data, value: '0' }]);

      $status.className = 'banner success';
      $status.innerHTML = `Mint submitted. Tx: <a href="${explorerTx(hashes[0])}" target="_blank">${hashes[0]}</a>`;
      invalidateIndex();
      $title.value = ''; $desc.value = ''; $file.value = '';
      if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
      $preview.style.backgroundImage = '';
      $preview.classList.remove('has-image');
    } catch (err) {
      $status.className = 'banner error';
      $status.textContent = 'Failed: ' + err.message;
    } finally {
      $btn.disabled = false;
    }
  });
}

// ============================================================================
// View: My Collection (#/me)
// ============================================================================

async function viewMyCollection() {
  const guard = connectedGuard();
  if (guard) { render(guard); return; }
  if (!state.myCollection) {
    render(el('div', { class: 'card empty' },
      el('h3', { text: 'No collection yet' }),
      el('p', { text: 'Create your collection to start minting.' }),
      el('div', { class: 'actions' },
        el('a', { class: 'btn', attrs: { href: '#/onboard' }, text: 'Create collection' }),
      ),
    ));
    return;
  }

  const container = el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'row between' },
        el('div', {},
          el('h1', { text: 'My collection' }),
          el('p', { class: 'subtitle' }, 'Contract: ', el('span', { class: 'address', text: state.myCollection })),
        ),
        el('a', { class: 'btn', attrs: { href: '#/mint' }, text: 'Mint new' }),
      ),
      el('div', { id: 'myGrid' }, skeletonGrid(4)),
    ),
  );
  render(container);

  try {
    const nextId = await getPublicClient().readContract({
      address: state.myCollection,
      abi: editionAbi,
      functionName: 'nextId',
    });
    const total = Number(nextId);
    if (total === 0) {
      document.getElementById('myGrid').replaceWith(
        emptyState('No editions yet', 'Mint your first edition to populate your collection.'),
      );
      return;
    }
    const cards = [];
    for (let id = 1n; id <= nextId; id++) {
      cards.push(await myCollectionCard(id));
    }
    document.getElementById('myGrid').replaceWith(el('div', { class: 'grid' }, ...cards));
  } catch (err) {
    document.getElementById('myGrid').replaceWith(emptyState('Failed to load', err.message));
  }
}

async function myCollectionCard(tokenId) {
  const collection = state.myCollection;
  const client = getPublicClient();
  let owner, listing, meta;
  try {
    [owner, listing] = await Promise.all([
      client.readContract({ address: collection, abi: editionAbi, functionName: 'ownerOf', args: [tokenId] }),
      client.readContract({ address: collection, abi: editionAbi, functionName: 'listings', args: [tokenId] }),
    ]);
    const uri = await client.readContract({
      address: collection, abi: editionAbi, functionName: 'tokenURI', args: [tokenId],
    });
    meta = await fetchMetadata(uri);
  } catch (err) {
    return el('div', { class: 'nft-card' },
      el('div', { class: 'img skeleton' }),
      el('div', { class: 'meta' }, el('div', { class: 'title', text: `#${tokenId} (error)` })),
    );
  }
  const listed = listing[0] !== '0x0000000000000000000000000000000000000000';
  const card = el('div', { class: 'nft-card' },
    el('div', {
      class: 'img',
      attrs: meta?.image ? { style: `background-image: url('${ipfsToHttp(meta.image)}')` } : {},
    }),
    el('div', { class: 'meta' },
      el('div', { class: 'title', text: meta?.name || `#${tokenId}` }),
      listed
        ? el('div', { class: 'price' },
            el('strong', { text: formatCrc(listing[1]) }), ' s-gCRC · ',
            el('span', { class: 'pill pill-soft', text: 'listed' }),
          )
        : el('div', { class: 'price', text: 'Not listed' }),
      el('div', { class: 'actions' },
        listed
          ? el('button', {
              class: 'btn-secondary',
              on: { click: () => delistToken(collection, tokenId, card) },
              text: 'Delist',
            })
          : listForSaleButton(collection, tokenId, card),
        el('a', { class: 'btn-ghost', attrs: { href: `#/nft/${collection}/${tokenId}` }, text: 'Open' }),
      ),
    ),
  );
  return card;
}

function listForSaleButton(collection, tokenId, card) {
  return el('button', {
    class: 'btn-secondary',
    on: { click: () => promptList(collection, tokenId, card) },
    text: 'List for sale',
  });
}

async function promptList(collection, tokenId, card) {
  const input = el('input', {
    class: 'mono',
    attrs: { type: 'text', placeholder: '5 or 12.5', inputmode: 'decimal' },
  });
  const errBox = el('div', { class: 'banner error', attrs: { style: 'display:none' } });
  const body = el('div', {},
    el('div', { class: 'field' },
      el('label', { text: 'Price in s-gCRC' }),
      input,
    ),
    errBox,
  );
  setTimeout(() => input.focus(), 50);
  const result = await modal({
    title: `List #${tokenId} for sale`,
    subtitle: 'Buyers pay this amount in Gnosis BaseGroup wrapped CRC (s-gCRC). You can delist at any time.',
    body,
    actions: [
      { label: 'Cancel', kind: 'secondary', value: null },
      { label: 'List', value: () => input.value.trim() },
    ],
  });
  if (typeof result !== 'function') return;
  const price = result();
  let priceWei;
  try {
    priceWei = parseEther(price);
    if (priceWei <= 0n) throw new Error('price must be positive');
  } catch (err) {
    toast('Invalid price: ' + err.message, 'error');
    return;
  }
  try {
    const data = encodeFunctionData({
      abi: editionAbi,
      functionName: 'list',
      args: [tokenId, priceWei],
    });
    await sendTransactions([{ to: collection, data, value: '0' }]);
    toast('List submitted - refreshing...');
    invalidateIndex();
    setTimeout(() => viewMyCollection(), 4000);
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

async function delistToken(collection, tokenId, card) {
  const ok = await modal({
    title: 'Delist this NFT?',
    subtitle: 'The NFT will be transferred back to your wallet from the escrow contract.',
    actions: [
      { label: 'Cancel', kind: 'secondary', value: false },
      { label: 'Delist', kind: 'danger', value: true },
    ],
  });
  if (!ok) return;
  try {
    const data = encodeFunctionData({
      abi: editionAbi,
      functionName: 'delist',
      args: [tokenId],
    });
    await sendTransactions([{ to: collection, data, value: '0' }]);
    toast('Delist submitted - refreshing...');
    invalidateIndex();
    setTimeout(() => viewMyCollection(), 4000);
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

// ============================================================================
// View: My Wall (#/wall)
// ============================================================================

async function viewMyWall() {
  const guard = connectedGuard();
  if (guard) { render(guard); return; }
  if (!isConfigured()) { render(configBanner()); return; }

  const container = el('div', {},
    el('div', { class: 'card' },
      el('h1', { text: 'My wall' }),
      el('p', { class: 'subtitle', text: 'NFTs you own across all collections - minted or purchased.' }),
      el('div', { id: 'wallGrid' }, skeletonGrid(4)),
    ),
  );
  render(container);

  try {
    const collections = await getAllCollections();
    const owned = await getOwnedTokens(state.wallet, collections);
    if (owned.length === 0) {
      document.getElementById('wallGrid').replaceWith(
        emptyState('Nothing here yet', 'Buy an NFT from the gallery, or mint your own.'),
      );
      return;
    }
    const cards = [];
    for (const t of owned) {
      cards.push(await wallCard(t));
    }
    document.getElementById('wallGrid').replaceWith(el('div', { class: 'grid' }, ...cards));
  } catch (err) {
    document.getElementById('wallGrid').replaceWith(emptyState('Failed to load', err.message));
  }
}

async function wallCard(t) {
  let title = `#${t.tokenId}`;
  let image = null;
  try {
    const uri = await getPublicClient().readContract({
      address: t.collection, abi: editionAbi, functionName: 'tokenURI', args: [t.tokenId],
    });
    const meta = await fetchMetadata(uri);
    if (meta?.name) title = meta.name;
    if (meta?.image) image = ipfsToHttp(meta.image);
  } catch {}
  return nftCard({
    collection: t.collection,
    tokenId: t.tokenId.toString(),
    title,
    image,
  });
}

// ============================================================================
// View: NFT Detail (#/nft/:collection/:id)
// ============================================================================

async function viewNftDetail(collectionRaw, tokenIdRaw) {
  let collection, tokenId;
  try {
    collection = getAddress(collectionRaw);
    tokenId = BigInt(tokenIdRaw);
  } catch {
    render(emptyState('Invalid URL', 'Bad collection address or token id.'));
    return;
  }

  render(el('div', { class: 'card' }, el('p', { class: 'subtitle', text: 'Loading...' })));
  const client = getPublicClient();
  let meta, owner, listing, name;
  try {
    const [uri, ownerAddr, listingTuple, colName] = await Promise.all([
      client.readContract({ address: collection, abi: editionAbi, functionName: 'tokenURI', args: [tokenId] }),
      client.readContract({ address: collection, abi: editionAbi, functionName: 'ownerOf', args: [tokenId] }),
      client.readContract({ address: collection, abi: editionAbi, functionName: 'listings', args: [tokenId] }),
      client.readContract({ address: collection, abi: editionAbi, functionName: 'name' }),
    ]);
    meta = await fetchMetadata(uri);
    owner = getAddress(ownerAddr);
    listing = { seller: listingTuple[0], price: listingTuple[1] };
    name = colName;
  } catch (err) {
    render(emptyState('Token not found', err.message));
    return;
  }

  const listed = listing.seller !== '0x0000000000000000000000000000000000000000';
  const isViewerSeller = state.wallet && listed && getAddress(listing.seller) === state.wallet;
  const canBuy = listed && state.wallet && !isViewerSeller;

  const card = el('div', { class: 'card' },
    el('div', { class: 'detail' },
      el('div', {
        class: 'img-wrap',
        attrs: meta?.image ? { style: `background-image: url('${ipfsToHttp(meta.image)}')` } : {},
      }),
      el('div', {},
        el('h1', { text: meta?.name || `#${tokenId}` }),
        el('p', { class: 'subtitle', text: meta?.description || '' }),
        el('div', { class: 'kv-row' },
          el('span', { class: 'k', text: 'Collection' }),
          el('span', { class: 'v', text: name }),
        ),
        el('div', { class: 'kv-row' },
          el('span', { class: 'k', text: 'Token ID' }),
          el('span', { class: 'v address', text: tokenId.toString() }),
        ),
        addressKvRow(listed ? 'Listed by' : 'Owner', listed ? listing.seller : owner),
        addressKvRow('Contract', collection),
        listed
          ? el('div', { class: 'kv-row' },
              el('span', { class: 'k', text: 'Price' }),
              el('span', { class: 'v' }, el('strong', { text: formatCrc(listing.price) }), ' s-gCRC'),
            )
          : null,
        el('div', { class: 'actions' },
          canBuy
            ? el('button', { id: 'buyBtn', text: 'Buy with s-gCRC' })
            : null,
          isViewerSeller
            ? el('span', { class: 'pill pill-soft', text: 'Your listing' })
            : null,
          !listed
            ? el('span', { class: 'pill', text: 'Not for sale' })
            : null,
        ),
        el('div', { class: 'banner pending', id: 'buyStatus', attrs: { style: 'display:none' } }),
      ),
    ),
  );
  render(card);

  const $buyBtn = document.getElementById('buyBtn');
  if ($buyBtn) {
    $buyBtn.addEventListener('click', async () => {
      $buyBtn.disabled = true;
      const $status = document.getElementById('buyStatus');
      $status.style.display = 'block';
      $status.className = 'banner pending';
      $status.textContent = 'Building payment intent...';
      try {
        const res = await fetch('/api/build-payment', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ collection, tokenId: tokenId.toString(), buyer: state.wallet }),
        });
        if (!res.ok) throw new Error('build-payment failed: ' + (await res.text()));
        const { txs, paymentData } = await res.json();
        $status.textContent = 'Requesting payment approval from your wallet...';
        await sendTransactions(txs.map((t) => ({ to: t.to, data: t.data, value: t.value || '0' })));
        location.hash = `#/buy/${encodeURIComponent(paymentData)}`;
      } catch (err) {
        $status.className = 'banner error';
        $status.textContent = 'Failed: ' + err.message;
        $buyBtn.disabled = false;
      }
    });
  }
}

// ============================================================================
// View: Buy polling (#/buy/:paymentData)
// ============================================================================

async function viewBuy(paymentDataEncoded) {
  const paymentData = decodeURIComponent(paymentDataEncoded);

  const card = el('div', { class: 'card' },
    el('h1', { text: 'Confirming purchase' }),
    el('p', { class: 'subtitle', text: 'Waiting for your CRC payment to land on-chain and for the NFT to be released from escrow.' }),
    el('div', { class: 'banner pending', id: 'pollStatus', text: 'Polling for confirmation...' }),
  );
  render(card);

  const $status = document.getElementById('pollStatus');
  let attempt = 0;
  const maxAttempts = 60; // 60 * 5s = 5 min
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const r = await fetch('/api/settle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentData }),
      });
      const json = await r.json();
      if (json.status === 'settled') {
        $status.className = 'banner success';
        $status.innerHTML = `Settled! Tx: <a href="${explorerTx(json.txHash)}" target="_blank">${json.txHash}</a>`;
        invalidateIndex();
        setTimeout(() => { location.hash = '#/wall'; }, 1500);
        return;
      }
      if (json.status === 'expired') {
        $status.className = 'banner error';
        $status.textContent = 'This purchase intent has expired. Please try again.';
        return;
      }
      $status.textContent = `Still pending (attempt ${attempt}/${maxAttempts})...`;
    } catch (err) {
      $status.textContent = `Network error - retrying (${err.message})`;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  $status.className = 'banner error';
  $status.textContent = 'Timed out waiting for settlement. If you paid, refresh in a moment.';
}

// ============================================================================
// Boot
// ============================================================================

// If we never get a wallet change event (eg standalone dev mode), fire the
// router after a short delay so the gallery still renders for read-only browsing.
setTimeout(() => walletPromise(false), 800);
walletReady.then(route);
