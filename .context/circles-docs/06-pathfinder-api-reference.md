# Circles Pathfinder API - Agent Reference

**Spec:** `https://staging.circlesubi.network/pathfinder/openapi/v1.json`
**Version:** 1.0.0 (OpenAPI 3.1.1)
**Interactive docs:** `https://staging.circlesubi.network/pathfinder/scalar/v1`
**Query builder:** `https://aboutcircles.github.io/CirclesTools/rpcQueryView.html?method=circlesV2_findPath`

---

## Overview

REST API for computing transitive transfer paths through the Circles trust network. Uses Google OR-Tools max-flow solver. The pathfinder maintains an in-memory graph of the full trust network, updated every ~5 seconds from on-chain state.

**Base URL (staging):** `https://staging.circlesubi.network/pathfinder`

---

## When to use this vs the RPC API

- Use the **RPC API** (`circlesV2_findPath`) for pathfinding within an existing JSON-RPC integration.
- Use **this REST API** directly when you want lower-latency pathfinding, need POST with complex simulation bodies, or are building a dedicated transfer/payment flow.

---

## Address Format

`0x`-prefixed, 40 hex chars. Checksummed or lowercase both accepted.

## Amount Format

All amounts in **CRC wei** as uint256 decimal strings.
- 1 CRC = 10^18 wei
- e.g. 96 CRC = `"96000000000000000000"`
- Max uint256 (send max) = `"115792089237316195423570985008687907853269984665640564039457584007913129639935"`

---

## Endpoints

### `GET /findMaxFlow`

Computes the **maximum transferable flow** between two addresses without computing the full transfer path. Faster than `/findPath` when you only need to know the achievable amount.

**Query parameters:**

| Param | Type | Required | Notes |
|---|---|---|---|
| `from` | string | Yes | Sender address |
| `to` | string | Yes | Receiver address |
| `amount` | string | Yes | Target flow in CRC wei. Use max uint256 for "how much can I send?" |
| `fromTokens` | string[] | No | Restrict tokens source can use |
| `toTokens` | string[] | No | Restrict tokens sink can receive |
| `excludedFromTokens` | string[] | No | Exclude specific tokens at source |
| `excludedToTokens` | string[] | No | Exclude specific tokens at sink |
| `withWrap` | boolean | No | Include ERC-20 wrapper paths. Default `false` |
| `simulatedBalances` | string | No | JSON string of hypothetical balances (see SimulatedBalance schema) |
| `simulatedConsentedAvatars` | string[] | No | Treat these addresses as having consented to ERC-1155 operator approval |
| `maxTransfers` | integer | No | Cap number of transfer steps (gas cost control) |
| `quantizedMode` | boolean | No | Enforce 96 CRC quantisation (invitation module) |
| `debugShowIntermediateSteps` | boolean | No | Include all pipeline stages in response |

**Array size limit:** 1000 entries per array parameter.

**Example:**
```
GET /findMaxFlow?from=0xde374ece6fa50e781e81aac78e811b33d16912c7&to=0x42cEDde51198D1773590311E2A340DC06B24cB37&amount=115792089237316195423570985008687907853269984665640564039457584007913129639935
```

**Response:** `MaxFlowResponse` - see schema below.

---

### `GET /findPath`

Computes a **full multi-hop transitive transfer path**. Response contains the exact transfer steps to submit on-chain via `Hub.sol operateFlowMatrix()`.

**Query parameters:** same as `GET /findMaxFlow`.

**Additional notes:**
- Use `maxTransfers` to limit path complexity for gas cost control
- Use `quantizedMode=true` for invitation flows (enforces N × 96 CRC per sink-bound transfer)
- Use `debugShowIntermediateSteps=true` to inspect the four pipeline stages

**Example - simple transfer:**
```
GET /findPath?from=0xde374ece6fa50e781e81aac78e811b33d16912c7&to=0x42cEDde51198D1773590311E2A340DC06B24cB37&amount=10000000000000000000
```

**Example - invitation (2 units = 192 CRC):**
```
GET /findPath?from=0x...&to=0x...&amount=192000000000000000000&quantizedMode=true
```

---

### `POST /findPath`

**Preferred for complex requests.** Accepts a JSON body (`FlowRequest`) instead of query parameters. Use this when sending `simulatedBalances`, `simulatedTrusts`, or many token filters.

**Request body:** `FlowRequest` JSON object.

**Solver timeout:** 30 seconds (configurable via `PATHFINDER_SOLVER_TIMEOUT_SECONDS`).
**Request body limit:** 1 MB.

**FlowRequest schema:**

| Field | Type | Required | Notes |
|---|---|---|---|
| `source` | string | Yes | Sender address (0x-prefixed, 40 hex chars) |
| `sink` | string | Yes | Receiver address |
| `targetFlow` | string | Yes | Amount in CRC wei. Max uint256 = discover max flow |
| `fromTokens` | string[] | No | Restrict tokens source can send |
| `toTokens` | string[] | No | Restrict tokens sink can receive |
| `excludedFromTokens` | string[] | No | Exclude specific tokens at source |
| `excludedToTokens` | string[] | No | Exclude specific tokens at sink |
| `withWrap` | boolean | No | Include ERC-20 wrapper paths. Default `false` |
| `simulatedBalances` | SimulatedBalance[] | No | Hypothetical balances for what-if testing |
| `simulatedTrusts` | SimulatedTrust[] | No | Hypothetical trust edges |
| `simulatedConsentedAvatars` | string[] | No | Treat as having consented to ERC-1155 operator approval |
| `maxTransfers` | integer | No | Cap transfer steps (gas cost control). Max 1000 array entries. |
| `quantizedMode` | boolean | No | Enforce 96 CRC quantisation. Invitation count = `targetFlow / 96 CRC`. Use max uint256 to discover all possible invitations. |
| `debugShowIntermediateSteps` | boolean | No | Include pipeline stages: rawPaths, collapsed, routerInserted, sorted |

**Example - simple transfer:**
```json
POST /findPath
{
  "source": "0xde374ece6fa50e781e81aac78e811b33d16912c7",
  "sink": "0x42cEDde51198D1773590311E2A340DC06B24cB37",
  "targetFlow": "10000000000000000000"
}
```

**Example - maximum possible flow:**
```json
POST /findPath
{
  "source": "0xde374ece6fa50e781e81aac78e811b33d16912c7",
  "sink": "0x42cEDde51198D1773590311E2A340DC06B24cB37",
  "targetFlow": "115792089237316195423570985008687907853269984665640564039457584007913129639935"
}
```

**Example - invitation flow (2 invitations = 2 x 96 CRC):**
```json
POST /findPath
{
  "source": "0xde374ece6fa50e781e81aac78e811b33d16912c7",
  "sink": "0x42cEDde51198D1773590311E2A340DC06B24cB37",
  "targetFlow": "192000000000000000000",
  "quantizedMode": true
}
```

**Example - with simulated balances (what-if):**
```json
POST /findPath
{
  "source": "0x...",
  "sink": "0x...",
  "targetFlow": "96000000000000000000",
  "simulatedBalances": [
    {
      "holder": "0x...",
      "token": "0x...",
      "amount": "96000000000000000000",
      "isWrapped": false,
      "isStatic": false
    }
  ],
  "simulatedTrusts": [
    { "truster": "0x...", "trustee": "0x..." }
  ]
}
```

**Example - debug mode:**
```json
POST /findPath
{
  "source": "0x...",
  "sink": "0x...",
  "targetFlow": "10000000000000000000",
  "debugShowIntermediateSteps": true,
  "maxTransfers": 5
}
```

---

### `GET /snapshot`

Returns a snapshot of the **full Circles trust graph**: all avatars, trust edges, and token balances.

**Warning:** Large response (can be several MB compressed). Use sparingly and cache.

**ETag support:** Responses include an `ETag` header. Send `If-None-Match` with the previous ETag to receive `304 Not Modified` if the graph is unchanged. The graph updates every ~5 seconds.

**Cache-Control:** `public, max-age=5`

**503:** Returned if the graph has not been built yet (service starting up).

**Use cases:** Pre-loading the trust graph for client-side pathfinding, graph visualisation, analytics.

---

## Response Schemas

### MaxFlowResponse

Returned by `/findMaxFlow` and `/findPath`.

```json
{
  "maxFlow": "10000000000000000000",
  "transfers": [
    {
      "from": "0x...",
      "to": "0x...",
      "tokenOwner": "0x...",
      "value": "10000000000000000000"
    }
  ],
  "debug": null
}
```

| Field | Type | Notes |
|---|---|---|
| `maxFlow` | string | Actual achievable flow in CRC wei. May be less than `targetFlow`. |
| `transfers` | TransferPathStep[] | Ordered steps to submit on-chain via `Hub.sol operateFlowMatrix()`. |
| `debug` | DebugPipelineStages \| null | Only present if `debugShowIntermediateSteps=true`. |

### TransferPathStep

A single on-chain token transfer step.

| Field | Type | Notes |
|---|---|---|
| `from` | string | Sender address (0x-prefixed, lowercase) |
| `to` | string | Receiver address |
| `tokenOwner` | string | Identifies which Circles token is transferred |
| `value` | string | Transfer amount in CRC wei |

### SimulatedBalance

For injecting hypothetical balances into the graph via `simulatedBalances`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `holder` | string | Yes | Avatar holding the tokens |
| `token` | string | Yes | Token-owner avatar address or ERC-20 wrapper address |
| `amount` | string | Yes | Balance in CRC wei. e.g. `"96000000000000000000"` = 96 CRC |
| `isWrapped` | boolean | No | Treat as ERC-20 wrapped token balance |
| `isStatic` | boolean | No | If `true`, balance is not subject to demurrage decay |

### SimulatedTrust

For injecting hypothetical trust edges via `simulatedTrusts`.

| Field | Type | Notes |
|---|---|---|
| `truster` | string | Address granting trust |
| `trustee` | string | Address receiving trust |

### DebugPipelineStages

Returned when `debugShowIntermediateSteps=true`. Shows the four transformation stages:

| Stage | Field | Description |
|---|---|---|
| 1 | `rawPaths` | Raw paths from MaxFlowSolver with token pools (`tpool-0x...`). Shows Avatar → TokenPool → Avatar paths before collapsing. |
| 2 | `collapsed` | Token pools collapsed. Shows Avatar → Avatar flows with intermediary pool nodes removed. |
| 3 | `routerInserted` | Router inserted for group mints. Avatar → Group becomes Avatar → Router → Group. |
| 4 | `sorted` | Final sorted order for contract execution. Ensures mint dependencies are satisfied (collateral before mints). |

---

## Key Concepts

### Quantized Mode (Invitation Module)

When `quantizedMode=true`, each sink-bound transfer is enforced at exactly N × 96 CRC.

- Number of invitations = `targetFlow / 96 CRC`
- Use max uint256 as `targetFlow` to discover the maximum possible invitation count
- 1 invitation = `"96000000000000000000"` (96 CRC)
- 2 invitations = `"192000000000000000000"` (192 CRC)

### maxTransfers

Caps the number of transfer steps in the result. Directly controls on-chain gas cost. Lower values produce simpler (but potentially smaller) transfers. Recommended: start without a cap, then reduce if gas is a concern.

### withWrap

When `true`, the pathfinder includes paths that involve ERC-20 wrapped Circles tokens in addition to native ERC-1155 paths. Off by default.

### simulatedBalances + simulatedTrusts

Inject hypothetical state into the graph for "what-if" scenarios without making any on-chain changes. Useful for testing invitation flows before executing, or validating whether a transfer will succeed given a proposed trust relationship.