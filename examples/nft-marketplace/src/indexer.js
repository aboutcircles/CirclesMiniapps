import { getAddress } from 'viem';
import { getPublicClient } from './clients.js';
import {
  FACTORY_ADDRESS,
  DEPLOY_BLOCK,
  factoryAbi,
  editionAbi,
} from './contracts.js';
import { foldListingEvents } from './listing-state.js';

const CHUNK = 9_500n;

const cache = {
  collections: null,
  listingsByCollection: new Map(),
  ownedByUser: new Map(),
};

export function invalidate() {
  cache.collections = null;
  cache.listingsByCollection.clear();
  cache.ownedByUser.clear();
}

async function getLogsChunked({ address, event, args, fromBlock, toBlock }) {
  const out = [];
  let from = fromBlock;
  while (from <= toBlock) {
    const to = from + CHUNK - 1n > toBlock ? toBlock : from + CHUNK - 1n;
    const logs = await getPublicClient().getLogs({
      address,
      event,
      args,
      fromBlock: from,
      toBlock: to,
    });
    out.push(...logs);
    from = to + 1n;
  }
  return out;
}

const collectionCreatedEvent = factoryAbi.find(
  (i) => i.type === 'event' && i.name === 'CollectionCreated',
);
const listedEvent = editionAbi.find((i) => i.type === 'event' && i.name === 'Listed');
const delistedEvent = editionAbi.find((i) => i.type === 'event' && i.name === 'Delisted');
const soldEvent = editionAbi.find((i) => i.type === 'event' && i.name === 'Sold');
const transferEvent = editionAbi.find((i) => i.type === 'event' && i.name === 'Transfer');

export async function getAllCollections() {
  if (cache.collections) return cache.collections;
  const head = await getPublicClient().getBlockNumber();
  const logs = await getLogsChunked({
    address: FACTORY_ADDRESS,
    event: collectionCreatedEvent,
    fromBlock: DEPLOY_BLOCK,
    toBlock: head,
  });
  const collections = logs.map((l) => ({
    creator: getAddress(l.args.creator),
    address: getAddress(l.args.collection),
    name: l.args.name,
    symbol: l.args.symbol,
    blockNumber: l.blockNumber,
  }));
  cache.collections = collections;
  return collections;
}

/**
 * Returns all currently-active listings across the supplied collections, newest first.
 * State machine: Listed -> Sold / Delisted clears.
 */
export async function getActiveListings(collections) {
  const head = await getPublicClient().getBlockNumber();
  const all = [];
  for (const col of collections) {
    let state = cache.listingsByCollection.get(col.address);
    if (!state) {
      state = { active: new Map(), inactive: new Set(), upToBlock: DEPLOY_BLOCK };
      cache.listingsByCollection.set(col.address, state);
    }
    if (state.upToBlock < head) {
      const fromBlock = state.upToBlock + 1n > col.blockNumber ? state.upToBlock + 1n : col.blockNumber;
      const [listed, delisted, sold] = await Promise.all([
        getLogsChunked({ address: col.address, event: listedEvent, fromBlock, toBlock: head }),
        getLogsChunked({ address: col.address, event: delistedEvent, fromBlock, toBlock: head }),
        getLogsChunked({ address: col.address, event: soldEvent, fromBlock, toBlock: head }),
      ]);
      // Re-fold every event from the collection's start each time we extend the
      // tracked range. Cheaper than maintaining the partial state across calls
      // and removes the risk of drift if a state entry is mutated elsewhere.
      const fresh = foldListingEvents({
        listed: [...(state.eventsListed ?? []), ...listed],
        delisted: [...(state.eventsDelisted ?? []), ...delisted],
        sold: [...(state.eventsSold ?? []), ...sold],
        collection: col.address,
      });
      state.active = fresh;
      state.eventsListed = [...(state.eventsListed ?? []), ...listed];
      state.eventsDelisted = [...(state.eventsDelisted ?? []), ...delisted];
      state.eventsSold = [...(state.eventsSold ?? []), ...sold];
      state.upToBlock = head;
    }
    for (const v of state.active.values()) {
      all.push({ ...v, collectionName: col.name, creator: col.creator });
    }
  }
  all.sort((a, b) => Number(b.blockNumber - a.blockNumber));
  return all;
}

/**
 * Returns NFTs currently owned by `user` across all collections.
 * Reads Transfer-to-user events per collection and verifies current ownerOf.
 */
export async function getOwnedTokens(user, collections) {
  user = getAddress(user);
  const cacheKey = user;
  const cached = cache.ownedByUser.get(cacheKey);
  if (cached) return cached;

  const head = await getPublicClient().getBlockNumber();
  const candidates = [];
  for (const col of collections) {
    const logs = await getLogsChunked({
      address: col.address,
      event: transferEvent,
      args: { to: user },
      fromBlock: col.blockNumber,
      toBlock: head,
    });
    for (const l of logs) {
      candidates.push({
        collection: col.address,
        collectionName: col.name,
        tokenId: l.args.tokenId,
      });
    }
  }

  // Dedupe + verify current ownership.
  const seen = new Set();
  const owned = [];
  for (const c of candidates) {
    const key = `${c.collection}-${c.tokenId.toString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      const currentOwner = await getPublicClient().readContract({
        address: c.collection,
        abi: editionAbi,
        functionName: 'ownerOf',
        args: [c.tokenId],
      });
      if (getAddress(currentOwner) === user) owned.push(c);
    } catch {
      // Token may have been burned; skip.
    }
  }
  cache.ownedByUser.set(cacheKey, owned);
  return owned;
}

export async function fetchMetadata(tokenURI) {
  if (!tokenURI) return null;
  const url = tokenURI.startsWith('ipfs://')
    ? `https://${tokenURI.slice('ipfs://'.length)}.ipfs.dweb.link`
    : tokenURI;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}
