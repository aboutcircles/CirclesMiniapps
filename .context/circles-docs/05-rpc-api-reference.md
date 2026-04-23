# Circles RPC API - Agent Reference

**Spec:** `https://staging.circlesubi.network/openrpc.json`
**Version:** 1.0.0 (OpenRPC 1.3.2)
**Interactive playground:** `https://aboutcircles.github.io/CirclesTools/rpcQueryView.html`

---

## Transport

JSON-RPC 2.0 over HTTP POST. All requests go to the root endpoint.

```
POST https://staging.circlesubi.network/
Content-Type: application/json
```

**Production base URL:** `https://rpc.aboutcircles.com`

### Request envelope

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "circles_getTotalBalance",
  "params": ["0xde374ece6fa50e781e81aac78e811b33d16912c7", true]
}
```

---

## Pagination

Methods returning large result sets use **cursor-based pagination**.

- Response includes `hasMore` (boolean) and `nextCursor` (opaque string)
- Pass `nextCursor` as the final param in subsequent calls
- Never construct cursors manually

---

## WebSocket Subscriptions

Real-time event notifications via WebSocket at `/ws/subscribe`:

```json
{
  "jsonrpc": "2.0",
  "method": "circles_subscribe",
  "params": ["circles", { "address": "0x..." }]
}
```

---

## Ethereum RPC Proxy

Standard `eth_*`, `net_*`, `web3_*` methods are proxied to the underlying Nethermind node at the same endpoint.

---

## Address Format

All addresses: `0x`-prefixed, 40 hex chars. Pattern: `^0x[0-9a-fA-F]{40}$`

---

## Amount Format

CRC amounts use two denominations:
- **CRC wei** (raw): uint256 string, e.g. `"10000000000000000000"` = 10 CRC
- **TimeCircles**: human-readable float string, accounts for demurrage/inflation
- **1 CRC = 10^18 wei**
- **Max uint256** = `"115792089237316195423570985008687907853269984665640564039457584007913129639935"` (use for "send max")

---

## Method Reference

### Balances

#### `circles_getTotalBalance` (V1)
Returns aggregated V1 Circles balance.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | Registered V1 avatar |
| `asTimeCircles` | boolean | No | Default `true`. `false` returns raw CRC wei. |

```json
// Example
{"jsonrpc":"2.0","id":1,"method":"circles_getTotalBalance","params":["0xde374ece6fa50e781e81aac78e811b33d16912c7", true]}
// Response: {"totalBalance": "142.5678", "version": 1, "asTimeCircles": true}
```

---

#### `circlesV2_getTotalBalance` (V2)
Returns aggregated V2 balance. V2 uses ERC-1155 with ~7%/year demurrage decay.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | Registered V2 avatar |
| `asTimeCircles` | boolean | No | Default `true`. `false` returns raw CRC wei with demurrage applied. |

**Note:** V2 balances include both personal tokens and group tokens held by the address.

---

#### `circles_getTokenBalances`
Returns every individual Circles token held by an address: V1 CRC, V2 personal, V2 group, and ERC-20 wrapped tokens.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | Address to query |

**Token balance fields:**
- `tokenAddress` - on-chain contract address
- `tokenOwner` - avatar that minted the token
- `tokenType` - `RegisterHuman`, `RegisterGroup`, or `RegisterOrganization`
- `version` - `1` or `2`
- `attoCircles` / `circles` - inflationary denomination
- `staticAttoCircles` / `staticCircles` - demurrage-adjusted denomination
- `attoCrc` / `crc` - aliases for V2 context
- `isErc20`, `isErc1155`, `isWrapped`, `isInflationary`, `isGroup` - boolean flags

---

### Tokens

#### `circles_getTokenInfo`
Returns metadata for a single token. Returns `null` if unknown to the indexer.

| Param | Type | Required | Notes |
|---|---|---|---|
| `tokenAddress` | string | Yes | V1 contract address or V2 ERC-1155 token ID |

**Response fields:** `tokenAddress`, `tokenOwner`, `tokenType`, `version`, `isErc20`, `isErc1155`, `isWrapped`, `isInflationary`, `isGroup`

---

#### `circles_getTokenInfoBatch`
Batch version of `circles_getTokenInfo`. Returns array of same length; unknown tokens return `null`. Max recommended batch: 100.

| Param | Type | Required |
|---|---|---|
| `tokenAddresses` | string[] | Yes |

---

#### `circles_getTokenHolders`
Returns all addresses holding a specific token with their balances. Cursor-paginated.

| Param | Type | Required | Notes |
|---|---|---|---|
| `tokenAddress` | string | Yes | Token to query |
| `limit` | integer | No | Default 100, max 200 |
| `cursor` | string | No | Pagination cursor |

---

### Avatars

#### `circles_getAvatarInfo`
Returns registration info for a Circles avatar. **Throws if address is not registered.**

| Param | Type | Required |
|---|---|---|
| `address` | string | Yes |

**Response fields:**
- `version` - `1` or `2`
- `type` - `CrcV2_RegisterHuman`, `CrcV2_RegisterGroup`, or `CrcV2_RegisterOrganization`
- `avatar` - address (lowercase)
- `tokenId` - personal token address
- `hasV1` - boolean; true if also has V1 registration
- `v1Token` - V1 CRC token address (if applicable)
- `cidV0` - IPFS CIDv0 pointing to profile JSON
- `isHuman`, `name`, `symbol`

```json
// Example response
{
  "version": 2,
  "type": "CrcV2_RegisterHuman",
  "avatar": "0xde374ece6fa50e781e81aac78e811b33d16912c7",
  "tokenId": "0xc5d024cb3218c4bfb3cdf1178e04c87742123708",
  "hasV1": true,
  "v1Token": "0xc5d024cb3218c4bfb3cdf1178e04c87742123708",
  "cidV0": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG",
  "isHuman": true,
  "name": "Alice",
  "symbol": "ALICE"
}
```

---

#### `circles_getAvatarInfoBatch`
Batch version of `circles_getAvatarInfo`. Throws for unregistered addresses. Max recommended batch: 100.

| Param | Type | Required |
|---|---|---|
| `addresses` | string[] | Yes |

---

### Profiles

#### `circles_getProfileByAddress` *(recommended single-address lookup)*
Combines CID lookup + IPFS fetch in one call. Returns full profile JSON enriched with `avatarType` and `name` from V2 registration.

| Param | Type | Required |
|---|---|---|
| `address` | string | Yes |

Replaces: `circles_getProfileCid` + `circles_getProfileByCid` + `circles_getAvatarInfo`

---

#### `circles_getProfileByAddressBatch`
Batch version. Each profile enriched with avatar type and name. Max recommended batch: 50.

| Param | Type | Required |
|---|---|---|
| `addresses` | string[] | Yes |

---

#### `circles_getProfileCid`
Returns IPFS CIDv0 for an avatar's profile JSON (without fetching profile content).

| Param | Type | Required |
|---|---|---|
| `address` | string | Yes |

---

#### `circles_getProfileCidBatch`
Returns map of `address → CIDv0` (null if no profile set).

| Param | Type | Required |
|---|---|---|
| `addresses` | string[] | Yes |

---

#### `circles_getProfileByCid`
Fetches profile JSON stored at an IPFS CID. Server-side cached.

| Param | Type | Required |
|---|---|---|
| `cid` | string | Yes | CIDv0, e.g. `QmYwAPJzv5...` |

---

#### `circles_getProfileByCidBatch`
Batch profile fetch by CIDs. Returns array in same order; `null` for unresolvable CIDs.

| Param | Type | Required |
|---|---|---|
| `cids` | string[] | Yes |

---

#### `circles_searchProfiles`
Full-text search across avatar profiles by name and description.

| Param | Type | Required | Notes |
|---|---|---|---|
| `text` | string | Yes | Max 3 tokens (split by whitespace); each must be >1 char |
| `limit` | integer | No | Default 20, max 100 |
| `offset` | integer | No | For offset-based pagination |
| `types` | string[] | No | Filter: `CrcV2_RegisterHuman`, `CrcV2_RegisterGroup`, `CrcV2_RegisterOrganization` |

---

#### `circles_searchProfileByAddressOrName` *(recommended search)*
Auto-detects query type: if starts with `0x`, searches by address prefix; otherwise full-text search on name/description.

| Param | Type | Required | Notes |
|---|---|---|---|
| `query` | string | Yes | Address prefix (0x...) or name text |
| `limit` | integer | No | Default 20, max 100 |
| `cursor` | string | No | Pagination cursor |
| `types` | string[] | No | Avatar type filter |

---

### Trust

#### `circles_getTrustRelations` (V1)
Returns `trusts` (outgoing) and `trustedBy` (incoming) arrays, each with trust limit (0-100).

| Param | Type | Required |
|---|---|---|
| `address` | string | Yes |

**Note:** Returns V1 trust relations. For V2 use `circles_getAggregatedTrustRelations`.

---

#### `circles_getAggregatedTrustRelations` (V2)
Returns trust relations categorised as `mutuallyTrusts`, `trusts`, or `trustedBy`, with `expiryTime` and counterpart avatar type.

| Param | Type | Required |
|---|---|---|
| `avatar` | string | Yes |

**AggregatedTrustRelation fields:** `subjectAvatar`, `relation` (`mutuallyTrusts`/`trusts`/`trustedBy`), `objectAvatar`, `timestamp`, `expiryTime` (0 = no expiry), `objectAvatarType` (`Human`/`Group`/`Organization`)

---

#### `circles_getAggregatedTrustRelationsEnriched`
Like `circles_getAggregatedTrustRelations` but includes full profile data for each counterpart. Cursor-paginated.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | |
| `limit` | integer | No | Default 50, max 200 |
| `cursor` | string | No | |

---

#### `circles_getCommonTrust`
Finds addresses that both users trust (potential transfer intermediaries).

| Param | Type | Required | Notes |
|---|---|---|---|
| `address1` | string | Yes | Outgoing trust side (V2 humans) |
| `address2` | string | Yes | Incoming trust side (V2 humans) |
| `version` | integer | No | `1` = V1 only, `2` = V2 only, omit = both |

**Tip:** If no common trust exists, `circlesV2_findPath` will likely return no path.

---

#### `circles_getTrustNetworkSummary`
Returns trust network metrics: trusting count, trusted-by count, mutual count, and optional network reach.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | |
| `maxDepth` | integer | No | Hops for network reach calculation. Higher = more expensive. |

---

### Groups

#### `circles_findGroups`
Discovers Circles groups with optional filters. Cursor-paginated.

| Param | Type | Required | Notes |
|---|---|---|---|
| `limit` | integer | No | Default 50 |
| `queryParams` | object | No | `{ nameStartsWith, symbolStartsWith, ownerIn }` - combine for AND logic |
| `cursor` | string | No | |

**GroupRow fields:** `group`, `name`, `symbol`, `mint` (mint policy contract), `treasury`, `blockNumber`, `timestamp`

---

#### `circles_getGroupMembers`
Returns members of a group (avatars trusted by the group). Cursor-paginated.

| Param | Type | Required | Notes |
|---|---|---|---|
| `groupAddress` | string | Yes | |
| `limit` | integer | No | Default 100, max 200 |
| `cursor` | string | No | |

---

#### `circles_getGroupMemberships`
Inverse of `circles_getGroupMembers` - returns all groups that trust a given avatar.

| Param | Type | Required | Notes |
|---|---|---|---|
| `memberAddress` | string | Yes | |
| `limit` | integer | No | Default 50, max 200 |
| `cursor` | string | No | |

---

### Transactions

#### `circles_getTransactionHistory`
Returns Circles transfers involving an avatar (as sender or receiver). Cursor-paginated.

| Param | Type | Required | Notes |
|---|---|---|---|
| `avatarAddress` | string | Yes | |
| `limit` | integer | No | Default 50, max 200 |
| `cursor` | string | No | |
| `version` | integer | No | `1` = V1 only, `2` = V2 only, omit = both |
| `excludeIntermediary` | boolean | No | Default `true`. Collapses multi-hop transfers to source-destination pairs. |

**TransactionHistoryRow fields:** `blockNumber`, `timestamp`, `transactionHash`, `version`, `from`, `to`, `operator` (V2), `id` (V2 ERC-1155 token ID), `value` (CRC wei), `circles`, `attoCircles`

---

#### `circles_getTransactionHistoryEnriched`
Like `circles_getTransactionHistory` but includes full participant profiles inline.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | |
| `fromBlock` | integer | **Yes** | Starting block (required) |
| `toBlock` | integer | No | Null = latest |
| `limit` | integer | No | Default 20 |
| `cursor` | string | No | |
| `version` | integer | No | Null = V2 only (backward compat), `1` = V1, `2` = V2 |
| `excludeIntermediary` | boolean | No | Default `true` |

---

#### `circles_getTransferData`
Returns raw ERC-1155 transfer calldata for an address. For debugging and advanced analysis.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | |
| `direction` | string | No | `sent`, `received`, or omit for both |
| `counterparty` | string | No | Filter by specific counterparty |
| `fromBlock` | integer | No | |
| `toBlock` | integer | No | |
| `limit` | integer | No | Default 50, max 1000 |
| `cursor` | string | No | |

---

### Events

#### `circles_events`
Query indexed protocol events with flexible filtering.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | No | Filter by involved address. Case-insensitive. |
| `fromBlock` | integer | No | Gnosis Chain: ~1 block per 5 seconds |
| `toBlock` | integer | No | Null = latest indexed block |
| `eventTypes` | string[] | No | See event types below |
| `filterPredicates` | object | No | SQL-like filtering (see FilterPredicateDto) |
| `sortAscending` | boolean | No | Default `false` (newest first) |
| `limit` | integer | No | Default 100, max 1000 |
| `cursor` | string | No | |

**Known event types:**
`CrcV1_Trust`, `CrcV1_Transfer`, `CrcV2_Trust`, `CrcV2_TransferSingle`, `CrcV2_TransferBatch`, `CrcV2_RegisterHuman`, `CrcV2_RegisterGroup`, `CrcV2_RegisterOrganization`

Use `circles_tables` to discover all event types.

---

### Invitations

#### `circles_getAllInvitations` *(recommended)*
Aggregates all invitation types in one call: trust-based, escrow-based, and at-scale.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | |
| `minimumBalance` | string | No | Min CRC balance for trust-based inviters. Default 96 CRC = `"96000000000000000000"` |

---

#### `circles_getTrustInvitations`
Subset of `circles_getAllInvitations` - returns only trust-based invitations (addresses that trust target + have sufficient balance).

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | |
| `minimumBalance` | string | No | Default 96 CRC |

---

#### `circles_getEscrowInvitations`
Returns CRC amounts escrowed for the target address. Filters out redeemed, revoked, and refunded escrows server-side.

| Param | Type | Required |
|---|---|---|
| `address` | string | Yes |

---

#### `circles_getAtScaleInvitations`
Returns pre-created accounts not yet claimed, associated with the target address.

| Param | Type | Required |
|---|---|---|
| `address` | string | Yes |

---

#### `circles_getValidInviters`
Finds addresses that trust the target AND have sufficient CRC balance to invite.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | |
| `minimumBalance` | string | No | Default 96 CRC = `"96000000000000000000"` |
| `limit` | integer | No | Default 50, max 200 |
| `cursor` | string | No | |

---

#### `circles_getInvitationsFrom`
Returns accounts invited by a specific avatar.

| Param | Type | Required | Notes |
|---|---|---|---|
| `address` | string | Yes | Inviter address |
| `accepted` | boolean | No | `true` = registered invitations; `false` (default) = pending (trusted but not yet registered) |

---

#### `circles_getInvitationOrigin`
Returns how an address was invited: type (`V1 Signup`, `V2 Standard`, `V2 Escrow`, `V2 At Scale`), inviter address, and transaction details. Returns `null` if not registered.

| Param | Type | Required |
|---|---|---|
| `address` | string | Yes |

---

### Pathfinder (via RPC)

#### `circlesV2_findPath`
**Primary method for executing Circles transfers.** Computes a multi-hop path through the trust network. Returns transfer steps ready for on-chain submission via `Hub.sol operateFlowMatrix()`.

| Param | Type | Required | Notes |
|---|---|---|---|
| `flowRequest` | object | Yes | See FlowRequest schema below |

**FlowRequest fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string | Yes | Sender address |
| `sink` | string | Yes | Receiver address |
| `targetFlow` | string | Yes | Amount in CRC wei. Use max uint256 for "send max" |
| `fromTokens` | string[] | No | Restrict tokens source can send |
| `toTokens` | string[] | No | Restrict tokens sink can receive |
| `excludedFromTokens` | string[] | No | Exclude specific tokens at source |
| `excludedToTokens` | string[] | No | Exclude specific tokens at sink |
| `withWrap` | boolean | No | Include ERC-20 wrapper paths. Default `false` |
| `simulatedBalances` | object[] | No | Hypothetical balances for what-if testing |
| `simulatedTrusts` | object[] | No | Hypothetical trust edges |
| `simulatedConsentedAvatars` | string[] | No | Treat as having consented to ERC-1155 operator approval |
| `maxTransfers` | integer | No | Cap transfer steps (controls gas cost) |
| `quantizedMode` | boolean | No | Enforce 96 CRC quantisation per transfer (invitation module) |
| `debugShowIntermediateSteps` | boolean | No | Include pipeline stages in response |

**Common patterns:**

```json
// Simple transfer - 10 CRC
{"source":"0x...","sink":"0x...","targetFlow":"10000000000000000000"}

// Maximum possible transfer
{"source":"0x...","sink":"0x...","targetFlow":"115792089237316195423570985008687907853269984665640564039457584007913129639935"}

// Invitation transfer - 2 units (2 x 96 CRC)
{"source":"0x...","sink":"0x...","targetFlow":"192000000000000000000","quantizedMode":true}
```

**Response (MaxFlowResponse):**
- `maxFlow` (string) - actual achievable amount in CRC wei
- `transfers` (array) - ordered transfer steps: `[{from, to, tokenOwner, value}]`
- `debug` (object, optional) - pipeline stages if `debugShowIntermediateSteps=true`

---

### Query (Low-level)

#### `circles_tables`
Lists all available table namespaces and column definitions. Use to discover what's queryable before building `circles_query` requests.

No params.

---

#### `circles_query`
Low-level structured query interface for direct table access. Returns `{columns, rows}`.

| Param | Type | Required | Notes |
|---|---|---|---|
| `query` | SelectDto | Yes | `{namespace, table, columns[], filter[], limit, orderBy}` |
| `cursor` | string | No | |

**Warning:** Non-paginated. For large result sets use `circles_paginated_query`.

```json
// Example: V2 trust relations for an address
{
  "namespace": "CrcV2",
  "table": "CrcV2_Trust",
  "columns": ["truster", "trustee", "expiryTime"],
  "filter": [{"Type":"FilterPredicate","Column":"truster","FilterType":"Equals","Value":"0xde374ece6fa50e781e81aac78e811b33d16912c7"}],
  "limit": 100
}
```

---

#### `circles_paginated_query`
Cursor-paginated version of `circles_query`. Returns `{columns, rows, hasMore, nextCursor}`.

| Param | Type | Required |
|---|---|---|
| `query` | SelectDto | Yes |
| `cursor` | string | No |

---

### SDK Convenience Methods

These methods combine multiple lower-level calls server-side for better performance.

#### `circles_getProfileView`
Single-call replacement for 6-7 separate RPC calls. Returns avatar info + IPFS profile + trust statistics + V1/V2 balance summary. Parallel execution server-side.

| Param | Type | Required |
|---|---|---|
| `address` | string | Yes |

---

### System

#### `circles_health`
Returns database connectivity, blockchain sync status, current block number, and sync state. Use for health monitoring or verifying indexer sync before querying.

No params.

---

## Related Services

| Service | URL |
|---|---|
| Pathfinder REST API (interactive) | `https://staging.circlesubi.network/pathfinder/scalar/v1` |
| Auth / SIWE docs | `https://staging.circlesubi.network/auth/docs` |
| All docs portal | `https://staging.circlesubi.network/docs` |
| Interactive query builder | `https://aboutcircles.github.io/CirclesTools/rpcQueryView.html` |