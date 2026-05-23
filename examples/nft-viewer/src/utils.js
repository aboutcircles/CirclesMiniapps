/**
 * Pure utility functions for the NFT Viewer.
 * Extracted for testability — no DOM or side effects here.
 */

const IPFS_GATEWAY = 'https://ipfs.io/ipfs';

const GNOSIS_NFT = {
  contract: '0x550eb63E1D2324e45b890b952f749b4150AEfdFa',
  tokenId: '11',
};

// ============================================================================
// IPFS utilities
// ============================================================================

export function ipfsToHttp(uri) {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) return `${IPFS_GATEWAY}/${uri.slice(7)}`;
  if (uri.startsWith('ipfs/')) return `${IPFS_GATEWAY}/${uri.slice(5)}`;
  if (uri.startsWith('http')) return uri;
  return null;
}

export function shortAddr(addr) {
  if (!addr) return '';
  const a = addr.toLowerCase();
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function getNftImage(nft) {
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

export function getNftName(nft) {
  return nft.name || nft.metadata?.name || `#${nft.id || nft.tokenId || '?'}`;
}

export function getNftDescription(nft) {
  return nft.description || nft.metadata?.description || '';
}

// ============================================================================
// NFT key / hide
// ============================================================================

export function nftKey(nft) {
  const addr = (nft.address || nft.tokenAddress || '').toLowerCase();
  const id = String(nft.id || nft.tokenId || '');
  return `${addr}:${id}`;
}

// ============================================================================
// Gnosis NFT highlight
// ============================================================================

export function isGnosisNft(nft) {
  const addr = (nft.address || nft.tokenAddress || '').toLowerCase();
  const id = String(nft.id || nft.tokenId || '');
  return addr === GNOSIS_NFT.contract.toLowerCase() && id === GNOSIS_NFT.tokenId;
}

// ============================================================================
// Sorting
// ============================================================================

export function sortNfts(nfts) {
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
// Concurrency limiter
// ============================================================================

export async function mapConcurrent(items, fn, limit = 3) {
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