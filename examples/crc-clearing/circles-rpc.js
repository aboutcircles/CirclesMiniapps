/**
 * circles-rpc.js — CirclesRPC data fetching for CRC Clearing.
 *
 * Fetches profiles, token holders, and cross-holdings using
 * the @aboutcircles/sdk and CirclesRPC API.
 */

import { Sdk } from '@aboutcircles/sdk';

// ─── Constants ──────────────────────────────────────────────────────────────
const CIRCLES_RPC_URL = 'https://rpc.aboutcircles.com/';
const HUB_V2_ADDRESS = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';
const GNOSIS_RPC_URLS = [
  'https://rpc.aboutcircles.com/',
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

// ─── SDK Instance ────────────────────────────────────────────────────────────
// Sdk() with no args defaults to Gnosis Chain mainnet
const sdk = new Sdk();

// ─── Profile ────────────────────────────────────────────────────────────────

/**
 * Fetch profile name and avatar for an address.
 * Uses @aboutcircles/sdk rpc.profile.getProfileByAddress → Profile { name, imageUrl, ... }
 */
export async function getProfile(address) {
  try {
    const profile = await sdk.rpc.profile.getProfileByAddress(address);
    if (!profile) return null;
    return {
      name: profile.name || null,
      avatarUrl: profile.imageUrl || null,
      address: address,
    };
  } catch {
    return null;
  }
}

// ─── Circles Query (balances) ───────────────────────────────────────────────

/**
 * Execute a circles_query RPC call.
 */
async function circlesQuery(namespace, table, columns, filter, order) {
  const body = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 100000),
    method: 'circles_query',
    params: [{
      Namespace: namespace,
      Table: table,
      Columns: columns,
      Filter: filter || [],
      Order: order || [],
      Limit: 500,
    }],
  };

  const resp = await fetch(CIRCLES_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) throw new Error(`circles_query failed: ${resp.status}`);
  const json = await resp.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json.result;
}

/**
 * Find all addresses that hold the given user's personal CRC token.
 * Returns array of { holderAddress, demurragedBalance } sorted by balance DESC.
 */
export async function getHoldersOfToken(tokenOwnerAddress) {
  const result = await circlesQuery(
    'V_CrcV2',
    'BalancesByAccountAndToken',
    [],
    [{
      Type: 'FilterPredicate',
      FilterType: 'Equals',
      Column: 'tokenAddress',
      Value: tokenOwnerAddress.toLowerCase(),
    }],
    [{ Column: 'demurragedTotalBalance', SortOrder: 'DESC' }]
  );

  const cols = result.columns;
  const rows = result.rows;
  const accountIdx = cols.indexOf('account');
  const balanceIdx = cols.indexOf('demurragedTotalBalance');

  return rows
    .filter(row => row[accountIdx]?.toLowerCase() !== tokenOwnerAddress.toLowerCase())
    .map(row => {
      const rawBalance = row[balanceIdx];
      const balance = typeof rawBalance === 'string' ? BigInt(rawBalance) : BigInt(Math.floor(Number(rawBalance || 0)));
      return {
        holderAddress: row[accountIdx],
        demurragedBalance: balance,
      };
    })
    .filter(h => h.demurragedBalance > 0n);
}

/**
 * Check how much of a given token an account holds.
 * Returns bigint (demurraged balance) or 0n.
 */
export async function getTokenBalance(accountAddress, tokenOwnerAddress) {
  try {
    const result = await circlesQuery(
      'V_CrcV2',
      'BalancesByAccountAndToken',
      [],
      [
        { Type: 'FilterPredicate', FilterType: 'Equals', Column: 'account', Value: accountAddress.toLowerCase() },
        { Type: 'FilterPredicate', FilterType: 'Equals', Column: 'tokenAddress', Value: tokenOwnerAddress.toLowerCase() },
      ],
      []
    );

    const cols = result.columns;
    const rows = result.rows;
    if (rows.length === 0) return 0n;
    const balanceIdx = cols.indexOf('demurragedTotalBalance');
    const rawBalance = rows[0][balanceIdx];
    return typeof rawBalance === 'string' ? BigInt(rawBalance) : BigInt(Math.floor(Number(rawBalance || 0)));
  } catch {
    return 0n;
  }
}

/**
 * Find cross-holdings between user and a list of holders.
 * For each holder, checks if user also holds that holder's CRC.
 * Returns only reciprocal holdings (both sides > 0).
 */
export async function findCrossHoldings(userAddress, holders) {
  const results = [];

  // Process in batches of 5
  for (let i = 0; i < holders.length; i += 5) {
    const batch = holders.slice(i, i + 5);
    const promises = batch.map(async (holder) => {
      const userHoldsOfTheirs = await getTokenBalance(userAddress, holder.holderAddress);
      return {
        holderAddress: holder.holderAddress,
        theyHoldOfUser: holder.demurragedBalance,
        userHoldsOfTheirs,
      };
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return results.filter(ch => ch.userHoldsOfTheirs > 0n && ch.theyHoldOfUser > 0n);
}

/**
 * Re-query balances for a set of clearing edges immediately before tx submission.
 * Returns fresh edges or null if balances changed significantly (>1%).
 */
export async function refreshBalancesForEdges(originalEdges) {
  try {
    const freshEdges = [];

    for (const edge of originalEdges) {
      const balance = await getTokenBalance(edge.from, edge.tokenOwner);
      // Allow 0.1% tolerance for demurrage
      const tolerance = edge.amount / 1000n;
      const diff = balance > edge.amount ? balance - edge.amount : edge.amount - balance;
      if (diff > tolerance && tolerance > 0n) {
        console.warn(`Balance changed for ${edge.from} → ${edge.tokenOwner}: was ${edge.amount}, now ${balance}`);
        return null; // Signal that balances changed
      }
      freshEdges.push({ ...edge, amount: balance < edge.amount ? balance : edge.amount });
    }

    return freshEdges;
  } catch (err) {
    console.error('Refresh balances failed:', err);
    return null;
  }
}

// ─── Gas Estimation ─────────────────────────────────────────────────────────

/**
 * Estimate gas for a transaction via RPC.
 */
export async function estimateGas(from, to, data) {
  for (const rpc of GNOSIS_RPC_URLS) {
    try {
      const resp = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'eth_estimateGas',
          params: [{ from, to, data }],
        }),
      });
      const json = await resp.json();
      if (json.error) throw new Error(json.error.message);
      return BigInt(json.result);
    } catch {
      continue;
    }
  }
  throw new Error('Gas estimation failed on all RPCs');
}

/**
 * Wait for a transaction receipt.
 */
export async function waitForReceipt(txHash, timeoutMs = 12 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const rpc of GNOSIS_RPC_URLS) {
      try {
        const resp = await fetch(rpc, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'eth_getTransactionReceipt',
            params: [txHash],
          }),
        });
        const json = await resp.json();
        if (json.result) {
          return {
            status: json.result.status === '0x1' ? 'success' : 'reverted',
            blockNumber: json.result.blockNumber,
            gasUsed: json.result.gasUsed,
          };
        }
      } catch { /* try next */ }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  throw new Error('Timed out waiting for transaction receipt');
}