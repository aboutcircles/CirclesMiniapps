# CRC Clearing — Tech Report & Migration Guide

## 1. What We Built

### Research Outcome
We proved that **CRC clearing is possible without deploying new smart contracts**, using only the existing `Hub.operateFlowMatrix()` function on Gnosis Chain.

### Key Discovery: No Operator Approval Needed
With `streamSinkId=0` (non-terminal) and empty `streams=[]`:
- The `_callAcceptanceChecks` loop in Hub.sol is **skipped entirely**
- `streamsNettedFlow` is all zeros
- `_matchNettedFlows` requires `matrixNettedFlow` to also be zero — guaranteed by symmetric clearing
- **ANY address can submit the clearing transaction** — no `setApprovalForAll` required

This works because:
1. Self-trust: everyone trusts their own token, so `isPermittedFlow` always passes when receiver == token owner
2. Zero-net: pairwise/cycle clearing ensures every participant's net flow is zero
3. Empty streams: bypasses all operator approval and acceptance callback checks

### Implementation: `clearing.py`
A Python CLI tool that:
1. Queries on-chain CRC balances via `ERC1155.balanceOf()` on the Hub contract
2. Finds pairwise clearing opportunities (A↔B where both hold each other's CRC)
3. Finds multi-party clearing cycles (A→B→C→A) via greedy DFS cycle detection (heuristic — not optimal; for maximum clearable volume on dense graphs, an LP/min-cost flow formulation would be needed)
4. Constructs the `operateFlowMatrix` flow matrix (sorted vertices, flow edges, packed coordinates)
5. Verifies zero-net constraint
6. Encodes ABI calldata for transaction submission
7. Estimates gas and cost via `eth_estimateGas`

### Current Limitations
- **One-directional holdings can't be cleared** — if A holds B's CRC but B doesn't hold A's CRC, pairwise clearing doesn't work (net flow ≠ 0)
- Need either: reciprocal holdings, a multi-party cycle, or the holder to manually send back
- **Cycle finder is a heuristic** — greedy DFS may not find the maximum clearable volume for dense graphs
- **O(n²) balance queries** — `balanceOf` called for every pair; subgraph recommended for >20 addresses
- **Concurrent state changes** — if balances change between query and submission, the tx reverts atomically (no partial execution risk, but needs re-query)
- **Demurrage at day boundary** — `balanceOf` returns post-demurrage values; amounts may drift ~0.02% at UTC day boundary
- Future: integrate with pathfinder2's trust graph data to discover cycles across the network

---

## 2.5 Phase 2: On-Chain Transaction Submission

### Overview
Phase 1 finds clearing opportunities and encodes the calldata. Phase 2 **executes the clearing on-chain** by submitting the `operateFlowMatrix` transaction.

### Who can submit?
**Any address** can submit the clearing transaction — you don't need to be one of the clearing participants. The signer is just the gas payer. You only need:
- A wallet with some xDAI for gas (~$0.01 per clearing on Gnosis Chain)
- The ABI-encoded calldata from the clearing computation

### `clearing.py` — `--submit` mode
Adds a `--submit` flag to the CLI tool:
```bash
# Submit directly (private key from env var)
PRIVATE_KEY=0x... python3 clearing.py --addresses 0xA 0xB --encode --submit
```
- Reads `PRIVATE_KEY` from environment variable
- Signs and sends the `operateFlowMatrix` transaction to Gnosis Chain
- Estimates gas before submission, re-queries balances if estimation fails
- Waits for confirmation and reports tx hash + status
- Reverts atomically on failure — no partial state changes

### Web App Submission Flow
```
1. User connects wallet (MetaMask / WalletConnect / Safe)
     ↓
2. App queries balances, computes clearing plan (Phase 1)
     ↓
3. User reviews clearing plan on screen
     ↓
4. User clicks "Execute Clearing" button
     ↓
5. App re-queries balances (guard against stale data)
     ↓
6. If balances changed → show warning, offer to recompute
     ↓
7. App encodes calldata + estimates gas via eth_estimateGas
     ↓
8. App sends operateFlowMatrix via wallet signer
     → MetaMask popup: "Confirm transaction"
     ↓
9. User confirms in wallet
     ↓
10. App watches for tx receipt (polling or WebSocket)
     ↓
11. On confirmation: show success + block explorer link
    On revert: show error, offer to re-query and retry
```

### Safety Guards
- **Re-query before submit**: Balances are re-queried immediately before tx submission to catch concurrent state changes
- **Gas estimation**: `eth_estimateGas` is called first — if it fails, the tx would revert, so we stop before wasting gas
- **Atomic execution**: All transfers succeed or all revert — no partial clearing possible
- **Demurrage tolerance**: The script accounts for demurrage by using the live `balanceOf` values at query time

### `--submit` implementation details
```python
# Pseudocode for submit flow
if args.submit:
    private_key = os.environ.get("PRIVATE_KEY")
    account = w3.eth.account.from_key(private_key)
    
    # Re-query balances to ensure freshness
    fresh_positions = query_all_non_personal_balances(w3, hub, addresses)
    fresh_edges = find_clearing(fresh_positions)
    fresh_matrix = build_flow_matrix(fresh_edges)
    
    # Encode and estimate
    calldata = encode_operate_flow_matrix(w3, hub, fresh_matrix)
    gas = w3.eth.estimate_gas({"to": hub, "data": calldata, "from": account.address})
    
    # Sign and send
    tx = account.sign_transaction({
        "to": hub_address,
        "data": calldata,
        "gas": int(gas * 1.2),  # 20% buffer
        "gasPrice": w3.eth.gas_price,
        "nonce": w3.eth.get_transaction_count(account.address),
        "chainId": 100,
    })
    tx_hash = w3.eth.send_raw_transaction(tx.raw_transaction)
    
    # Wait for confirmation
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    print(f"TX: https://gnosisscan.io/tx/{tx_hash.hex()}")
    print(f"Status: {'✅ Success' if receipt.status == 1 else '❌ Reverted'}")
```

---

## 2. Files to Migrate

### Core file
| File | Purpose | Lines |
|------|---------|-------|
| `clearing.py` | Complete clearing tool (balance queries, clearing algorithms, flow matrix construction, ABI encoding, gas estimation) | ~570 |

### What to extract for a web app
The following functions from `clearing.py` are the core logic needed:

| Function | Purpose |
|----------|---------|
| `address_to_token_id()` | Convert address → uint256 tokenId |
| `find_pairwise_clearing()` | Detect pairwise clearing opportunities |
| `find_cycle_clearing()` | Detect multi-party clearing cycles |
| `build_flow_matrix()` | Construct `operateFlowMatrix` parameters |
| `verify_zero_net()` | Validate zero-net constraint |
| `encode_operate_flow_matrix()` | ABI-encode the transaction calldata |

### Constants needed
| Constant | Value |
|----------|-------|
| Hub address | `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8` |
| Gnosis Chain RPC | `https://rpc.gnosischain.com` |
| Chain ID | 100 |

### ABI snippets needed
- `operateFlowMatrix` function ABI
- `balanceOf` function ABI
- Both are included in the `HUB_ABI` variable in `clearing.py`

---

## 3. Python on Web Hosting — Dependencies

### Python is NOT automatically available on web hosts
- **Static hosting** (Vercel, Netlify, GitHub Pages): No Python — JavaScript only
- **Shared hosting** (cPanel): May have Python but not reliably, no pip access
- **PaaS** (Heroku, Railway, Render): Python supported, `requirements.txt` works
- **VPS** (Digital Ocean, AWS EC2): Full control, install anything

### Python dependencies for `clearing.py`
```
web3>=6.0.0
```
This pulls in: `eth-account`, `eth-utils`, `eth-abi`, `websockets`, `requests`, etc.

### Recommended approach for a web app

**Option A: JavaScript/TypeScript rewrite (RECOMMENDED)**
- Rewrite core logic in TypeScript/JavaScript
- Use `ethers.js` (v6) for on-chain interaction
- Runs in browser or Node.js
- Deploy on Vercel/Netlify as a static dApp
- No server-side Python needed
- Dependencies: `ethers`, `react`/`next`/`svelte`

**Option B: Python backend API**
- Keep `clearing.py` logic as a Flask/FastAPI backend
- Frontend calls API for balance queries and calldata generation
- Deploy on Railway, Render, or Heroku
- Dependencies: `web3`, `fastapi`, `uvicorn`, `cors`

**Option C: Hybrid**
- Frontend in JS framework (React/Svelte)
- Use ethers.js directly in the browser for balance queries and tx submission
- Clearing algorithm (pairwise/cycle detection) ported to JS — pure math, no blockchain dependency
- No backend needed

---

## 4. Recommended Tech Stack for Web App

```
Frontend:  SvelteKit or Next.js
Blockchain: ethers.js v6 (browser-side wallet connection)
Styling:   Tailwind CSS
Hosting:   Vercel or Netlify (static)
Network:   Gnosis Chain (Chain ID 100)
Wallet:    MetaMask / WalletConnect / Safe wallet
```

### No backend needed if:
- Balance queries go directly from browser → RPC via ethers.js
- Clearing algorithm runs client-side in JavaScript
- Transaction signing happens in the user's wallet (MetaMask etc.)
- ABI encoding done client-side with ethers.js

### Key ethers.js equivalents
| Python (web3.py) | JavaScript (ethers.js v6) |
|-------------------|---------------------------|
| `Web3(HTTPProvider(rpc))` | `new ethers.JsonRpcProvider(rpc)` |
| `hub.functions.balanceOf(addr, id).call()` | `hub.balanceOf(addr, id)` |
| `tx.encodeABI()` | `hub.interface.encodeFunctionData("operateFlowMatrix", [...])` |
| `address_to_token_id(addr)` | `BigInt(addr)` |

---

## 5. Smart Contract Details

### Hub Contract
- **Address**: `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8` (Gnosis Chain mainnet v2, verified 2026-04-23)
- **Network**: Gnosis Chain (Chain ID 100)
- **Type**: ERC1155 with custom flow matrix operations

### `operateFlowMatrix` Signature
```solidity
function operateFlowMatrix(
    address[] calldata _flowVertices,  // sorted ascending
    FlowEdge[] calldata _flow,          // { streamSinkId: uint16, amount: uint192 }
    Stream[] calldata _streams,         // { sourceCoordinate: uint16, flowEdgeIds: uint16[], data: bytes }
    bytes calldata _packedCoordinates   // 3×uint16 per edge: [circlesId_idx, sender_idx, receiver_idx]
) external;
```

### Clearing-specific parameters
- `_flowVertices`: All unique participant addresses, sorted ascending
- `_flow`: One entry per clearing edge, all with `streamSinkId=0`
- `_streams`: **Empty array `[]`** — this is what bypasses operator approval
- `_packedCoordinates`: 6 bytes per edge (3 × uint16 big-endian)

### Flow matrix construction for pairwise A↔B
```
flowVertices: [A, B]  (sorted ascending)
flow: [
  { streamSinkId: 0, amount: min(holdings) },  // A returns B-CRC
  { streamSinkId: 0, amount: min(holdings) },  // B returns A-CRC
]
streams: []
packedCoordinates: [
  circlesId_idx(B), sender_idx(A), receiver_idx(B),  // edge 0
  circlesId_idx(A), sender_idx(B), receiver_idx(A),  // edge 1
]
```

### Why self-trust works
In Hub.sol's `_verifyFlowMatrix`:
```solidity
// For each edge, check isPermittedFlow(circlesId, sender, receiver)
// circlesId = token_owner, sender = holder, receiver = token_owner
// Since circlesId == receiver, this is "am I receiving my own token?"
// Self-trust is always true → check passes ✓
```

### Why empty streams bypass approval
In Hub.sol's `operateFlowMatrix`:
```solidity
// _callAcceptanceChecks iterates over _streams
// If _streams is empty, the loop body never executes
// No operator approval check, no onERC1155Received callback
// Just the matrix verification (zero-net) and effect transfers
```

---

## 6. Gas Estimation

- Each flow edge costs ~50-80k gas
- Pairwise clearing (2 edges): ~150k gas
- 5-party cycle (5 edges): ~400k gas
- Gnosis Chain block gas limit: ~30M gas
- At current GC gas prices (~1 gwei), clearing costs are negligible (< $0.01)
- `clearing.py` now calls `eth_estimateGas` when `--encode` is used and reports estimated gas + xDAI cost
- If gas estimation fails, it likely means balances have changed since query and the tx would revert

---

## 7. Testing Addresses (verified on-chain)

- `0xc175a0c71f1eDA836ebbF3Ab0e32Fc8865FdEe91` — registered avatar (holds no non-personal CRC from the tested peer)
- `0x457ece12084cb7ab908623cbedd1843a6dc958d1` — registered avatar (holds ~4.05 CRC of the above)

---

## 8. Migration Checklist

- [ ] Port `find_pairwise_clearing()` to JavaScript/TypeScript
- [ ] Port `find_cycle_clearing()` to JavaScript/TypeScript
- [ ] Port `build_flow_matrix()` to JavaScript/TypeScript
- [ ] Port `verify_zero_net()` to JavaScript/TypeScript
- [ ] Set up ethers.js contract instance with Hub ABI
- [ ] Implement `balanceOf` queries via ethers.js
- [ ] Implement `operateFlowMatrix` calldata encoding via ethers.js
- [ ] Add wallet connection (MetaMask/WalletConnect)
- [ ] Add address input UI
- [ ] Add clearing results display
- [ ] Add "Execute Clearing" button with gas estimation
- [ ] Implement re-query guard: re-check balances immediately before tx submission
- [ ] Implement tx submission via wallet signer (ethers.js `signer.sendTransaction`)
- [ ] Add tx confirmation monitoring (receipt polling)
- [ ] Add success/error UI with block explorer link
- [ ] Add `--submit` flag to `clearing.py` (env var `PRIVATE_KEY`)
- [ ] Deploy to Vercel/Netlify
