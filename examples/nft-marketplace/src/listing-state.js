import { getAddress } from 'viem';

/**
 * Folds Listed / Delisted / Sold event logs for a single collection into the
 * set of currently-active listings, keyed by `tokenId` as a decimal string.
 *
 * Pure function so it can be unit-tested without touching the chain.
 *
 * Each log must have shape: { blockNumber: bigint, logIndex: number, args: { tokenId, seller?, price? } }.
 * Events are processed in (blockNumber, logIndex) order. A `Listed` event sets
 * the entry; `Delisted` or `Sold` clears it.
 */
export function foldListingEvents({ listed = [], delisted = [], sold = [], collection }) {
  const flat = [
    ...listed.map((log) => ({ kind: 'list', log })),
    ...delisted.map((log) => ({ kind: 'delist', log })),
    ...sold.map((log) => ({ kind: 'sold', log })),
  ];
  flat.sort((a, b) => {
    const db = Number(a.log.blockNumber - b.log.blockNumber);
    if (db !== 0) return db;
    return Number(a.log.logIndex - b.log.logIndex);
  });

  const active = new Map();
  for (const e of flat) {
    const id = e.log.args.tokenId.toString();
    if (e.kind === 'list') {
      active.set(id, {
        collection,
        tokenId: e.log.args.tokenId,
        seller: getAddress(e.log.args.seller),
        price: e.log.args.price,
        blockNumber: e.log.blockNumber,
      });
    } else {
      active.delete(id);
    }
  }
  return active;
}
