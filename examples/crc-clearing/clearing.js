/**
 * clearing.js — Pure clearing algorithms for Circles CRC tokens.
 *
 * No imports, no I/O, no DOM. Pure functions only. Unit-testable.
 *
 * Ported from clearing.py — operates on Hub V2's operateFlowMatrix
 * with streamSinkId=0 and empty streams to bypass operator approval.
 */

// ─── Types (documented for reference) ─────────────────────────────────────
// Holding      = { tokenOwner: string, holder: string, amount: bigint }
// ClearingEdge = { tokenOwner: string, from: string, to: string, amount: bigint }
// FlowMatrix   = {
//   flowVertices: string[],
//   flow: Array<{ streamSinkId: number, amount: bigint }>,
//   packedCoordinates: Uint8Array
// }

/**
 * Convert address to uint256 tokenId (same as Hub.toTokenId).
 */
export function addressToTokenId(address) {
  return BigInt(address);
}

/**
 * Find pairwise clearing opportunities.
 * For each pair (A, B) where A holds B's CRC AND B holds A's CRC,
 * create two clearing edges with amount = min(both holdings).
 */
export function findPairwiseClearing(holdings) {
  // Build map: holdingsMap[tokenOwner.toLowerCase()][holder.toLowerCase()] = amount
  const map = {};
  for (const h of holdings) {
    const to = h.tokenOwner.toLowerCase();
    const ho = h.holder.toLowerCase();
    if (!map[to]) map[to] = {};
    map[to][ho] = (map[to][ho] || 0n) + h.amount;
  }

  const edges = [];
  const seen = new Set();

  for (const tokenOwner of Object.keys(map)) {
    for (const holder of Object.keys(map[tokenOwner])) {
      const pairKey = tokenOwner < holder ? `${tokenOwner}-${holder}` : `${holder}-${tokenOwner}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      // Check if holder also holds tokenOwner's CRC
      const fwd = map[tokenOwner]?.[holder] || 0n;  // holder holds tokenOwner's CRC
      const rev = map[holder]?.[tokenOwner] || 0n;   // tokenOwner holds holder's CRC

      if (fwd > 0n && rev > 0n) {
        const amount = fwd < rev ? fwd : rev;
        // Edge 1: holder returns tokenOwner's CRC (holder → tokenOwner, circlesId=tokenOwner)
        edges.push({
          tokenOwner: tokenOwner,
          from: holder,
          to: tokenOwner,
          amount: amount,
        });
        // Edge 2: tokenOwner returns holder's CRC (tokenOwner → holder, circlesId=holder)
        edges.push({
          tokenOwner: holder,
          from: tokenOwner,
          to: holder,
          amount: amount,
        });
      }
    }
  }

  return edges;
}

/**
 * Find multi-party clearing cycles via greedy DFS.
 * Builds a directed graph: edge from holder → tokenOwner for each holding.
 * Finds cycles where we return to start via the graph.
 */
export function findCycleClearing(holdings, maxCycleLength = 8) {
  // Build adjacency: for each address, who do they hold CRC of?
  // adj[holder] = [{ tokenOwner, amount }]
  const adj = {};
  for (const h of holdings) {
    const ho = h.holder.toLowerCase();
    if (!adj[ho]) adj[ho] = [];
    adj[ho].push({ tokenOwner: h.tokenOwner.toLowerCase(), amount: h.amount });
  }

  const allNodes = Object.keys(adj);
  const edges = [];
  const usedHoldings = {}; // track remaining amounts

  // Initialize used amounts tracking
  for (const h of holdings) {
    const key = `${h.holder.toLowerCase()}-${h.tokenOwner.toLowerCase()}`;
    usedHoldings[key] = h.amount;
  }

  function getRemaining(holder, tokenOwner) {
    const key = `${holder}-${tokenOwner}`;
    return usedHoldings[key] || 0n;
  }

  function subtractUsed(holder, tokenOwner, amount) {
    const key = `${holder}-${tokenOwner}`;
    usedHoldings[key] = (usedHoldings[key] || 0n) - amount;
  }

  // DFS from each node
  for (const start of allNodes) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const path = [start];
      const visited = new Set([start]);

      const found = dfs(start, path, visited, maxCycleLength, adj, getRemaining);

      if (found) {
        // Compute cycle amount = min of all holdings along the path
        let cycleAmount = null;
        for (let i = 0; i < found.length; i++) {
          const from = found[i];
          const to = found[(i + 1) % found.length];
          const remaining = getRemaining(from, to);
          if (cycleAmount === null || remaining < cycleAmount) {
            cycleAmount = remaining;
          }
        }

        if (cycleAmount && cycleAmount > 0n) {
          // Create clearing edges for this cycle
          for (let i = 0; i < found.length; i++) {
            const from = found[i];
            const to = found[(i + 1) % found.length];
            subtractUsed(from, to, cycleAmount);
            edges.push({
              tokenOwner: to,
              from: from,
              to: to,
              amount: cycleAmount,
            });
          }
        }
      }
    }
  }

  return edges;
}

function dfs(start, path, visited, maxLen, adj, getRemaining) {
  if (path.length > maxLen) return null;

  const current = path[path.length - 1];
  const neighbours = adj[current] || [];

  for (const { tokenOwner } of neighbours) {
    if (getRemaining(current, tokenOwner) <= 0n) continue;

    if (tokenOwner === start && path.length >= 3) {
      // Found a cycle
      return [...path];
    }

    if (!visited.has(tokenOwner) && path.length < maxLen) {
      visited.add(tokenOwner);
      path.push(tokenOwner);
      const result = dfs(start, path, visited, maxLen, adj, getRemaining);
      if (result) return result;
      path.pop();
      visited.delete(tokenOwner);
    }
  }

  return null;
}

/**
 * Combine pairwise and cycle clearing results.
 * Deduplicates by preferring cycle results.
 */
export function combineClearingResults(pairwise, cycles) {
  // Use pairwise as base; add cycle edges for pairs not already covered
  if (cycles.length === 0) return pairwise;
  if (pairwise.length === 0) return cycles;

  // Build set of already-covered pairs from pairwise
  const covered = new Set();
  for (const e of pairwise) {
    covered.add(`${e.tokenOwner}-${e.from}-${e.to}`);
  }

  // Add cycle edges that aren't duplicates
  const merged = [...pairwise];
  for (const e of cycles) {
    const key = `${e.tokenOwner}-${e.from}-${e.to}`;
    if (!covered.has(key)) {
      merged.push(e);
      covered.add(key);
    }
  }
  return merged;
}

/**
 * Verify that every participant's net flow is zero.
 * For each address, sum of incoming amounts must equal sum of outgoing.
 */
export function verifyZeroNet(edges) {
  const flows = {};
  for (const e of edges) {
    const from = e.from.toLowerCase();
    const to = e.to.toLowerCase();
    flows[from] = (flows[from] || 0n) - e.amount;
    flows[to] = (flows[to] || 0n) + e.amount;
  }
  for (const addr of Object.keys(flows)) {
    if (flows[addr] !== 0n) return false;
  }
  return true;
}

/**
 * Build the operateFlowMatrix parameters from clearing edges.
 * Returns FlowMatrix { flowVertices, flow, packedCoordinates }.
 */
export function buildFlowMatrix(edges) {
  if (edges.length === 0) {
    throw new Error('No edges to build flow matrix from');
  }

  // Collect all unique addresses, sort ascending
  const addrSet = new Set();
  for (const e of edges) {
    addrSet.add(e.tokenOwner.toLowerCase());
    addrSet.add(e.from.toLowerCase());
    addrSet.add(e.to.toLowerCase());
  }
  const flowVertices = [...addrSet].sort();

  // Build index lookup
  const idx = {};
  flowVertices.forEach((a, i) => { idx[a] = i; });

  // Build flow and packed coordinates
  const flow = [];
  const packedCoords = [];

  for (const e of edges) {
    flow.push({
      streamSinkId: 0,
      amount: e.amount,
    });

    const circlesIdIdx = idx[e.tokenOwner.toLowerCase()];
    const senderIdx = idx[e.from.toLowerCase()];
    const receiverIdx = idx[e.to.toLowerCase()];

    // Pack 3 uint16 big-endian (2 bytes each = 6 bytes)
    const buf = new ArrayBuffer(6);
    const view = new DataView(buf);
    view.setUint16(0, circlesIdIdx, false);   // big-endian
    view.setUint16(2, senderIdx, false);
    view.setUint16(4, receiverIdx, false);
    packedCoords.push(new Uint8Array(buf));
  }

  // Concatenate packed coordinates
  const totalLen = packedCoords.reduce((s, a) => s + a.length, 0);
  const packedCoordinates = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of packedCoords) {
    packedCoordinates.set(p, offset);
    offset += p.length;
  }

  const matrix = { flowVertices, flow, packedCoordinates };

  // Verify zero-net before returning
  if (!verifyZeroNet(edges)) {
    throw new Error('Zero-net verification failed — clearing edges are not balanced');
  }

  return matrix;
}

/**
 * ABI-encode the operateFlowMatrix call.
 * Returns hex string calldata.
 */
export function encodeOperateFlowMatrix(flowMatrix) {
  // We manually ABI-encode to avoid pulling in viem as a runtime dep.
  // operateFlowMatrix(address[] _flowVertices, uint256[] _flow, bytes32[] _streams, bytes _packedCoordinates)

  const { flowVertices, flow, packedCoordinates } = flowMatrix;

  // Pack FlowEdges as uint256: (streamSinkId << 192) | amount
  const packedFlow = flow.map(e =>
    (BigInt(e.streamSinkId) << 192n) | e.amount
  );

  // Encode the function selector (operateFlowMatrix)
  // keccak256("operateFlowMatrix(address[],uint256[],bytes32[],bytes)") first 4 bytes
  // = 0x3d3e5652
  const selector = '0x3d3e5652';

  // We'll use a simple ABI encoder
  const encoded = selector + encodeAbiParams(
    flowVertices,   // address[]
    packedFlow,     // uint256[]
    [],             // bytes32[] (empty)
    packedCoordinates  // bytes
  );

  return encoded;
}

// ─── Minimal ABI encoder ────────────────────────────────────────────────────

function encodeAbiParams(addresses, uints, bytes32Array, bytes) {
  // Static offsets: selector + 4 params = 4 * 32 = 128 bytes after selector
  // But we're computing from after selector, so offsets start at 0
  // Each head slot is 32 bytes

  const parts = [];

  // Head: 4 slots for offsets
  // Slot 0: offset to addresses[]
  // Slot 1: offset to uints[]
  // Slot 2: offset to bytes32[]
  // Slot 3: offset to bytes

  // Compute sizes first
  const addressesEncoded = encodeAddressArray(addresses);
  const uintsEncoded = encodeUint256Array(uints);
  const bytes32Encoded = encodeBytes32Array(bytes32Array);
  const bytesEncoded = encodeBytes(bytes);

  const headSize = 4 * 64; // 4 slots, each 64 hex chars (32 bytes)
  const offset0 = headSize;
  const offset1 = offset0 + addressesEncoded.length / 2;
  const offset2 = offset1 + uintsEncoded.length / 2;
  const offset3 = offset2 + bytes32Encoded.length / 2;

  parts.push(encodeUint256(offset0));
  parts.push(encodeUint256(offset1));
  parts.push(encodeUint256(offset2));
  parts.push(encodeUint256(offset3));
  parts.push(addressesEncoded);
  parts.push(uintsEncoded);
  parts.push(bytes32Encoded);
  parts.push(bytesEncoded);

  return parts.join('');
}

function encodeUint256(n) {
  return n.toString(16).padStart(64, '0');
}

function encodeAddress(addr) {
  // Remove 0x, pad to 32 bytes left-aligned
  return addr.replace('0x', '').toLowerCase().padStart(64, '0');
}

function encodeAddressArray(addrs) {
  // Dynamic array: length + elements
  const len = encodeUint256(addrs.length);
  const elems = addrs.map(a => encodeAddress(a)).join('');
  return len + elems;
}

function encodeUint256Array(vals) {
  const len = encodeUint256(vals.length);
  const elems = vals.map(v => encodeUint256(v)).join('');
  return len + elems;
}

function encodeBytes32Array(vals) {
  const len = encodeUint256(vals.length);
  const elems = vals.join('');
  return len + elems;
}

function encodeBytes(data) {
  // bytes: length (uint256) + data padded to 32 bytes
  const len = data.length;
  const lenEncoded = encodeUint256(len);
  // Pad data to multiple of 32 bytes
  const hexBytes = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join('');
  const padded = hexBytes.padEnd(Math.ceil(hexBytes.length / 64) * 64, '0');
  if (padded.length === 0) return lenEncoded; // empty bytes
  return lenEncoded + padded;
}

// ─── Formatting helpers ────────────────────────────────────────────────────

/**
 * Format attoCRC to human-readable CRC string.
 * Shows full precision: up to 12 decimal places, trimming trailing zeros.
 */
export function formatCRC(attoCircles) {
  if (attoCircles === 0n) return '0 CRC';
  const sign = attoCircles < 0n ? '-' : '';
  const absVal = attoCircles < 0n ? -attoCircles : attoCircles;
  const whole = absVal / 10n ** 18n;
  const frac = absVal % 10n ** 18n;

  if (frac === 0n) return `${sign}${whole} CRC`;

  // Show up to 12 decimal places, trim trailing zeros
  const fracStr = frac.toString().padStart(18, '0').slice(0, 12).replace(/0+$/, '');
  return `${sign}${whole}.${fracStr} CRC`;
}

/**
 * Format attoCRC with compact notation for very small amounts.
 * Shows "< 0.001 CRC" for tiny values, otherwise normal format.
 */
export function formatCRCCompact(attoCircles) {
  if (attoCircles === 0n) return '0 CRC';
  const absVal = attoCircles < 0n ? -attoCircles : attoCircles;
  if (absVal < 10n ** 15n) {
    // Less than 0.001 CRC
    const micro = Number(absVal / 10n ** 12n) / 1000000;
    return `< 0.001 CRC (${micro.toExponential(2)} CRC)`;
  }
  return formatCRC(attoCircles);
}

/**
 * Truncate address for display: 0x1234...5678
 * Preserves checksum casing if present.
 */
export function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * EIP-55 checksum address encoding (no dependencies needed).
 */
export function checksumAddress(address) {
  if (!address) return address;
  // Remove 0x prefix and lowercase
  const hex = address.toLowerCase().replace(/^0x/, '');
  // Simple keccak256 via SubtleCrypto (async) is unavailable in sync context.
  // Instead, use a lightweight JS implementation of keccak256.
  // For now, preserve original casing if already checksummed, or lowercase.
  // Full checksum requires keccak256 — we do a best-effort:
  const hash = keccak256Hex(hex);
  let result = '0x';
  for (let i = 0; i < hex.length; i++) {
    const c = hex[i];
    if (c >= '0' && c <= '9') {
      result += c;
    } else {
      // If hash char >= 8, uppercase; else lowercase
      result += parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c;
    }
  }
  return result;
}

// ─── Minimal Keccak-256 (for EIP-55 checksum) ─────────────────────────────
// This is a compact, self-contained keccak-f[1600] permutation + sponge.
// Only used for address checksumming — not security-critical.

const KECCAK_RC = [
  0x01, 0x8082, 0x808a, 0x80008000, 0x808b, 0x80000001, 0x80008081, 0x8009,
  0x8a, 0x88, 0x80008009, 0x8000000a, 0x8000808b, 0x8b, 0x8089, 0x8003,
  0x8002, 0x80, 0x800a, 0x8000000a, 0x80008081, 0x8080, 0x80000001, 0x80008008,
];

function keccak256Hex(hex) {
  // Convert hex string to byte array
  const bytes = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  const state = new BigInt64Array(25);
  // Padding: append 0x01, then zeros, then 0x80 at end of block (rate = 136 bytes for keccak-256)
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((bytes.length + 1) / rate) * rate);
  padded.set(bytes);
  padded[bytes.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;

  // Absorb
  for (let i = 0; i < padded.length; i += rate) {
    for (let j = 0; j < rate; j += 8) {
      let v = 0n;
      for (let k = 0; k < 8; k++) v |= BigInt(padded[i + j + k] || 0) << BigInt(k * 8);
      state[j >> 3] ^= v;
    }
    keccakF(state);
  }

  // Squeeze (rate bytes = 136, output = 32 bytes, so one squeeze)
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 8) {
    const v = state[i >> 3];
    for (let j = 0; j < 8; j++) out[i + j] = Number((v >> BigInt(j * 8)) & 0xFFn);
  }

  return Array.from(out).map(b => b.toString(16).padStart(2, '0')).join('');
}

function keccakF(s) {
  const R = [[0,1,2,3,4],[5,6,7,8,9],[10,11,12,13,14],[15,16,17,18,19],[20,21,22,23,24]];
  const ROT = [
    [0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14],
  ];
  for (let round = 0; round < 24; round++) {
    // θ
    const C = new BigInt64Array(5);
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x+5] ^ s[x+10] ^ s[x+15] ^ s[x+20];
    const D = new BigInt64Array(5);
    for (let x = 0; x < 5; x++) D[x] = C[(x+4)%5] ^ rotl64(C[(x+1)%5], 1n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[R[y][x]] ^= D[x];
    // ρ and π — combined
    const B = new BigInt64Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      B[R[(x*2+y*3)%5][x]] = rotl64(s[R[y][x]], BigInt(ROT[y][x]));
    }
    // χ
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      s[R[y][x]] = B[R[y][x]] ^ (~B[R[y][(x+1)%5]] & B[R[y][(x+2)%5]]);
    }
    // ι
    s[0] ^= BigInt(KECCAK_RC[round]);
  }
}

function rotl64(v, n) {
  n = n % 64n;
  if (n === 0n) return v;
  const mask = (1n << 64n) - 1n;
  return ((v << n) | (v >> (64n - n))) & mask;
}
