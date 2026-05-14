import { describe, it, expect } from 'vitest';
import { foldListingEvents } from './listing-state.js';

const COL = '0x1111111111111111111111111111111111111111';
const SELLER_A = '0xaaaa000000000000000000000000000000000001';
const SELLER_B = '0xbbbb000000000000000000000000000000000002';
const BUYER = '0xcccc000000000000000000000000000000000003';

function listed({ tokenId, seller, price, block, idx = 0 }) {
  return {
    blockNumber: BigInt(block),
    logIndex: idx,
    args: { tokenId: BigInt(tokenId), seller, price: BigInt(price) },
  };
}

function delisted({ tokenId, seller, block, idx = 0 }) {
  return {
    blockNumber: BigInt(block),
    logIndex: idx,
    args: { tokenId: BigInt(tokenId), seller },
  };
}

function sold({ tokenId, seller, buyer, price, block, idx = 0 }) {
  return {
    blockNumber: BigInt(block),
    logIndex: idx,
    args: { tokenId: BigInt(tokenId), seller, buyer, price: BigInt(price) },
  };
}

describe('foldListingEvents', () => {
  it('returns an empty map for no events', () => {
    const out = foldListingEvents({ collection: COL });
    expect(out.size).toBe(0);
  });

  it('records a single listing', () => {
    const out = foldListingEvents({
      collection: COL,
      listed: [listed({ tokenId: 1, seller: SELLER_A, price: '1000', block: 10 })],
    });
    expect(out.size).toBe(1);
    const entry = out.get('1');
    expect(entry.tokenId).toBe(1n);
    // viem.getAddress() returns the EIP-55 checksum form; verify case-insensitively.
    expect(entry.seller.toLowerCase()).toBe(SELLER_A);
    expect(entry.seller).not.toBe(SELLER_A); // it should have been re-cased
    expect(entry.price).toBe(1000n);
    expect(entry.collection).toBe(COL);
  });

  it('clears a listing on Delisted', () => {
    const out = foldListingEvents({
      collection: COL,
      listed: [listed({ tokenId: 1, seller: SELLER_A, price: '500', block: 10 })],
      delisted: [delisted({ tokenId: 1, seller: SELLER_A, block: 11 })],
    });
    expect(out.size).toBe(0);
  });

  it('clears a listing on Sold', () => {
    const out = foldListingEvents({
      collection: COL,
      listed: [listed({ tokenId: 1, seller: SELLER_A, price: '500', block: 10 })],
      sold: [sold({ tokenId: 1, seller: SELLER_A, buyer: BUYER, price: '500', block: 12 })],
    });
    expect(out.size).toBe(0);
  });

  it('orders events by (blockNumber, logIndex), not by array position', () => {
    // Delist at block 12 (later) - listing at block 10 should be cleared.
    const out = foldListingEvents({
      collection: COL,
      delisted: [delisted({ tokenId: 1, seller: SELLER_A, block: 12 })],
      listed: [listed({ tokenId: 1, seller: SELLER_A, price: '500', block: 10 })],
    });
    expect(out.size).toBe(0);
  });

  it('handles relist after delist within the same fold', () => {
    const out = foldListingEvents({
      collection: COL,
      listed: [
        listed({ tokenId: 1, seller: SELLER_A, price: '100', block: 10 }),
        listed({ tokenId: 1, seller: SELLER_B, price: '200', block: 12 }),
      ],
      delisted: [delisted({ tokenId: 1, seller: SELLER_A, block: 11 })],
    });
    expect(out.size).toBe(1);
    const entry = out.get('1');
    expect(entry.price).toBe(200n);
    expect(entry.seller.toLowerCase()).toBe(SELLER_B);
  });

  it('tie-breaks events in the same block by logIndex', () => {
    // List at (10, 0), Delist at (10, 1) -> listing should be cleared.
    const out = foldListingEvents({
      collection: COL,
      listed: [listed({ tokenId: 1, seller: SELLER_A, price: '100', block: 10, idx: 0 })],
      delisted: [delisted({ tokenId: 1, seller: SELLER_A, block: 10, idx: 1 })],
    });
    expect(out.size).toBe(0);
  });

  it('tracks multiple tokens independently', () => {
    const out = foldListingEvents({
      collection: COL,
      listed: [
        listed({ tokenId: 1, seller: SELLER_A, price: '100', block: 10 }),
        listed({ tokenId: 2, seller: SELLER_B, price: '200', block: 10, idx: 1 }),
      ],
      sold: [sold({ tokenId: 1, seller: SELLER_A, buyer: BUYER, price: '100', block: 11 })],
    });
    expect(out.size).toBe(1);
    expect(out.has('1')).toBe(false);
    expect(out.get('2').price).toBe(200n);
  });
});
