import { describe, it, expect } from 'vitest';
import {
  ipfsToHttp,
  shortAddr,
  getNftImage,
  getNftName,
  getNftDescription,
  nftKey,
  isGnosisNft,
  sortNfts,
  mapConcurrent,
} from './utils.js';

// ============================================================================
// ipfsToHttp
// ============================================================================

describe('ipfsToHttp', () => {
  it('converts ipfs:// URI to gateway URL', () => {
    expect(ipfsToHttp('ipfs://QmABC123')).toBe('https://ipfs.io/ipfs/QmABC123');
  });

  it('converts ipfs/ prefix to gateway URL', () => {
    expect(ipfsToHttp('ipfs/QmABC123')).toBe('https://ipfs.io/ipfs/QmABC123');
  });

  it('passes through http:// URLs', () => {
    expect(ipfsToHttp('http://example.com/img.png')).toBe('http://example.com/img.png');
  });

  it('passes through https:// URLs', () => {
    expect(ipfsToHttp('https://example.com/img.png')).toBe('https://example.com/img.png');
  });

  it('returns null for null', () => {
    expect(ipfsToHttp(null)).toBe(null);
  });

  it('returns null for undefined', () => {
    expect(ipfsToHttp(undefined)).toBe(null);
  });

  it('returns null for empty string', () => {
    expect(ipfsToHttp('')).toBe(null);
  });

  it('returns null for non-IPFS/non-HTTP string', () => {
    expect(ipfsToHttp('ar://something')).toBe(null);
  });
});

// ============================================================================
// shortAddr
// ============================================================================

describe('shortAddr', () => {
  it('shortens a checksummed address', () => {
    expect(shortAddr('0x550eb63E1D2324e45b890b952f749b4150AEfdFa'))
      .toBe('0x550e…fdfa');
  });

  it('shortens a lowercase address', () => {
    expect(shortAddr('0x550eb63e1d2324e45b890b952f749b4150aefdfa'))
      .toBe('0x550e…fdfa');
  });

  it('returns empty string for null', () => {
    expect(shortAddr(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(shortAddr(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(shortAddr('')).toBe('');
  });
});

// ============================================================================
// getNftImage
// ============================================================================

describe('getNftImage', () => {
  it('returns imageUri if present', () => {
    const nft = { imageUri: 'https://example.com/img.png' };
    expect(getNftImage(nft)).toBe('https://example.com/img.png');
  });

  it('resolves ipfs:// imageUri', () => {
    const nft = { imageUri: 'ipfs://QmABC123' };
    expect(getNftImage(nft)).toBe('https://ipfs.io/ipfs/QmABC123');
  });

  it('falls back to metadata.image', () => {
    const nft = { metadata: { image: 'https://example.com/meta.png' } };
    expect(getNftImage(nft)).toBe('https://example.com/meta.png');
  });

  it('falls back to metadata.image_url', () => {
    const nft = { metadata: { image_url: 'https://example.com/url.png' } };
    expect(getNftImage(nft)).toBe('https://example.com/url.png');
  });

  it('returns null if no image sources', () => {
    const nft = { metadata: {} };
    expect(getNftImage(nft)).toBe(null);
  });

  it('returns null for empty object', () => {
    expect(getNftImage({})).toBe(null);
  });
});

// ============================================================================
// getNftName
// ============================================================================

describe('getNftName', () => {
  it('returns name if present', () => {
    expect(getNftName({ name: 'My NFT' })).toBe('My NFT');
  });

  it('falls back to metadata.name', () => {
    expect(getNftName({ metadata: { name: 'Meta Name' } })).toBe('Meta Name');
  });

  it('falls back to #id', () => {
    expect(getNftName({ id: '42' })).toBe('#42');
  });

  it('falls back to #tokenId', () => {
    expect(getNftName({ tokenId: '7' })).toBe('#7');
  });

  it('falls back to #? if nothing', () => {
    expect(getNftName({})).toBe('#?');
  });

  it('prefers name over metadata.name', () => {
    expect(getNftName({ name: 'A', metadata: { name: 'B' } })).toBe('A');
  });
});

// ============================================================================
// getNftDescription
// ============================================================================

describe('getNftDescription', () => {
  it('returns description if present', () => {
    expect(getNftDescription({ description: 'A nice NFT' })).toBe('A nice NFT');
  });

  it('falls back to metadata.description', () => {
    expect(getNftDescription({ metadata: { description: 'Meta desc' } })).toBe('Meta desc');
  });

  it('returns empty string if nothing', () => {
    expect(getNftDescription({})).toBe('');
  });
});

// ============================================================================
// nftKey
// ============================================================================

describe('nftKey', () => {
  it('generates key from address and id', () => {
    expect(nftKey({ address: '0xABC', id: '1' })).toBe('0xabc:1');
  });

  it('uses tokenAddress fallback', () => {
    expect(nftKey({ tokenAddress: '0xDEF', tokenId: '5' })).toBe('0xdef:5');
  });

  it('lowercases the address', () => {
    expect(nftKey({ address: '0xABCDEF', id: '1' })).toBe('0xabcdef:1');
  });

  it('handles missing address', () => {
    expect(nftKey({ id: '1' })).toBe(':1');
  });
});

// ============================================================================
// isGnosisNft
// ============================================================================

describe('isGnosisNft', () => {
  it('returns true for the Gnosis NFT', () => {
    expect(isGnosisNft({
      address: '0x550eb63E1D2324e45b890b952f749b4150AEfdFa',
      id: '11',
    })).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isGnosisNft({
      address: '0x550eb63e1d2324e45b890b952f749b4150aefdfa',
      id: '11',
    })).toBe(true);
  });

  it('returns false for wrong token ID', () => {
    expect(isGnosisNft({
      address: '0x550eb63E1D2324e45b890b952f749b4150AEfdFa',
      id: '12',
    })).toBe(false);
  });

  it('returns false for wrong contract', () => {
    expect(isGnosisNft({
      address: '0x0000000000000000000000000000000000000000',
      id: '11',
    })).toBe(false);
  });

  it('uses tokenAddress fallback', () => {
    expect(isGnosisNft({
      tokenAddress: '0x550eb63E1D2324e45b890b952f749b4150AEfdFa',
      tokenId: '11',
    })).toBe(true);
  });
});

// ============================================================================
// sortNfts
// ============================================================================

describe('sortNfts', () => {
  it('puts Gnosis NFT first', () => {
    const nfts = [
      { address: '0x0000', id: '1', tokenName: 'Zebra' },
      { address: '0x550eb63E1D2324e45b890b952f749b4150AEfdFa', id: '11', tokenName: 'Gnosis' },
      { address: '0x1111', id: '2', tokenName: 'Alpha' },
    ];
    const sorted = sortNfts(nfts);
    expect(sorted[0].tokenName).toBe('Gnosis');
  });

  it('sorts by collection name alphabetically after Gnosis', () => {
    const nfts = [
      { address: '0x0000', id: '1', tokenName: 'Zebra' },
      { address: '0x1111', id: '2', tokenName: 'Alpha' },
      { address: '0x2222', id: '3', tokenName: 'Middle' },
    ];
    const sorted = sortNfts(nfts);
    expect(sorted.map(n => n.tokenName)).toEqual(['Alpha', 'Middle', 'Zebra']);
  });

  it('does not mutate the original array', () => {
    const nfts = [
      { address: '0x0000', id: '1', tokenName: 'B' },
      { address: '0x1111', id: '2', tokenName: 'A' },
    ];
    const copy = [...nfts];
    sortNfts(nfts);
    expect(nfts.map(n => n.tokenName)).toEqual(copy.map(n => n.tokenName));
  });
});

// ============================================================================
// mapConcurrent
// ============================================================================

describe('mapConcurrent', () => {
  it('maps all items', async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapConcurrent(items, async (x) => x * 2);
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const items = [1, 2, 3, 4, 5, 6];

    await mapConcurrent(items, async (x) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 50));
      concurrent--;
      return x;
    }, 2);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('handles empty array', async () => {
    const result = await mapConcurrent([], async (x) => x);
    expect(result).toEqual([]);
  });

  it('handles single item', async () => {
    const result = await mapConcurrent([42], async (x) => x);
    expect(result).toEqual([42]);
  });

  it('preserves order regardless of async timing', async () => {
    const items = [100, 50, 200, 10];
    const result = await mapConcurrent(items, async (ms) => {
      await new Promise(r => setTimeout(r, ms));
      return ms;
    }, 2);
    expect(result).toEqual([100, 50, 200, 10]);
  });
});