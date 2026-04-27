# Circles 2.0 - On-Chain Contracts

## Hub (`src/hub/Hub.sol`) - Core Contract

**Deployed**: v2 Hub `0xc12c1e50abb450d6205ea2c3fa861b3b834d13e8`

### Responsibilities

| Function | Description |
|----------|-------------|
| **Avatar registration** | `registerHuman(inviter, metadataDigest)` - creates human avatar (post-bootstrap: invite required)<br>`registerOrganization(name, metadataDigest)` - creates org avatar<br>`registerGroup(mint, name, symbol, metadataDigest)` - registers standard group<br>`registerCustomGroup(mint, treasury, ...)` - registers group with custom treasury |
| **Personal issuance & migration** | `personalMint()` - mint CRC for caller (subject to retro-window)<br>`calculateIssuance(address)` - view function for mintable amount<br>`calculateIssuanceWithCheck` - also updates internal state |
| **Trust relationships** | `trust(trustReceiver, expiry)` - directional trust expiring at Unix timestamp<br>`isTrusted(truster, trustee)` - returns true if non-expired entry exists |
| **Group minting** | `groupMint(group, collateralAvatars[], amounts[], data)` - explicit group mint<br>Internal `_groupMint` also called from path engine for implicit mints |
| **Path-matrix transfers** | `operateFlowMatrix(flowVertices[], flowEdges[], streams[], packedCoordinates)` - multi-hop payment system |
| **ERC-20 wrappers** | `wrap(avatar, amount, type)` - deploys/reuses proxy ERC-20 wrapper (Demurrage or Inflation) |
| **Stop / v1 compatibility** | `stop()` - marks caller as stopped v1 token<br>`stopped(address)` - returns stop state *(Known bug: uses msg.sender instead of argument)* |
| **Metadata** | `name()` and `symbol()` forward to ERC-1155 implementation |

### Post-Bootstrap Invitation Mechanics

- **WELCOME_BONUS**: 48 CRC - minted to newly registered human
- **INVITATION_COST**: 96 CRC - burned from inviter's personal balance
- **No self-invite**: Bootstrap period ended; every new human must be invited
- **Invitation Escrow**: `0x0956c08ad2dcc6f4a1e0cc5ffa3a08d2a6d85f29`

### Security Invariants

- **Transient storage guard**: `tload/tstore` prevents re-entrancy without persistent lock variable
- **Deferred transfers**: ERC-1155 acceptance checks batched per stream receiver, not per edge

## ERC-1155 Stack

### Layer Architecture

| Layer | Purpose |
|-------|---------|
| **ERC-1155 base** | Standard multi-token implementation (balances, approvals, batch ops) |
| **Discounted balances** | Overrides `balanceOf` to apply daily demurrage factor lazily<br>Provides `balanceOfOnDay(address, id, day)` - returns discounted balance and discount cost |
| **Demurrage logic** | Pre-computed per-day factors for up to a few years<br>Lookup table (~256 entries) with interpolation for later dates<br>Discount cost minted to `0x0` (burned) |
| **Token IDs** | Deterministic: `tokenId = uint256(uint160(avatarAddress))` |

### Personal Mint (`personalMint`)

- Computes full hours since last successful mint, caps at retro-window
- Applies daily demurrage to bring amount to "now"
- Mints CRC to avatar's ERC-1155 balance
- **Blocking rule**: If v1 token still active (`V1.stop()` not called), `personalMint` reverts

## ERC-20 Wrappers & Lift

**ERC-20 Lift address**: `0x5f99a795dd2743c36d63511f0d4bc667e6d3cdb5`

| Wrapper | Representation | Demurrage Treatment |
|---------|----------------|---------------------|
| **Demurrage ERC-20** | ERC-20 view of avatar's CRC balance<br>Balances decay like underlying ERC-1155 | `onERC1155Received` mints 1:1 demurraged amount<br>`unwrap(amountDemurraged)` burns ERC-20 and transfers ERC-1155 back |
| **Inflationary ERC-20** | Static-balance ERC-20 that doesn't decay on-chain<br>Conversion at deposit/withdraw using today's discount factor | Symbol prefix "s-" (e.g., `s-CRC`)<br>Useful for DeFi integrations |
| **Lift** | Helper contract that deploys wrapper via minimal proxy factory<br>Calls `wrap` on Hub to deposit amount | Returns ERC-20 contract address |

Both wrappers implement **EIP-2612** (`permit`, `nonces`, `DOMAIN_SEPARATOR`) with domain `{ name: "Circles", version: "v2" }`

## Trust (Directional)

- **Directional trust**: `trust(receiver, expiry)`
- **Flow check**: For transfer of `circlesAvatar` from `sender` to `receiver`:
  ```
  require(receiver trusts circlesAvatar);
  ```
- Same check enforced along each hop in path-matrix transfer
- No extra consent toggles

## Path-Based Transactions - Flow Matrices

### Data Types

| Type | Fields |
|------|--------|
| **FlowEdge** | `streamSinkId` (≥ 1 for terminal edges), `amount` (uint192) |
| **Stream** | `sourceCoordinate` (index into `_flowVertices`), list of `flowEdgeIds`, optional `data` |
| **PackedCoordinates** | Three uint16 values packed as 6 bytes: `(avatarIndex, senderIndex, receiverIndex)`<br>`_flowVertices` must be sorted strictly ascending by address |

### Execution Invariants

1. **Vertex ordering**: `_flowVertices` must be strictly ascending
2. **Operator approvals**: Each stream's `sourceCoordinate` avatar must have approved caller (`isApprovedForAll`)
3. **Permit checks**: Receiver must trust the avatar being moved
4. **Terminal edges**: Edges with `streamSinkId ≥ 1` are sinks; all sinks of same stream must point to same receiver
5. **Chunking & batching**: Transfers applied in two phases - net flow computation, then ERC-1155 updates/group mints<br>Acceptance (`onERC1155Received`) deferred per stream after all edges processed

### Order of Operations

1. Validate matrix (sorted vertices, approvals, permits)
2. Build netted flow: sum inbound/outbound per stream, ensure totals match
3. Apply edges:
   - Normal avatar → internal `_update` for ERC-1155 balances
   - Group receiver → internal `_groupMint(..., explicitCall = false)`
4. Run acceptance (`onERC1155Received`) per distinct stream receiver
5. Reconcile netted flows vs. matrix - discrepancy → revert

## Groups - Collateralized Local Currencies

**Standard Treasury**: `0x08f90ab73a515308f03a718257ff9887ed330c6e`

| Component | Description |
|-----------|-------------|
| **Registration** | `registerGroup` / `registerCustomGroup`<br>Associates mint address and optional custom treasury<br>Name/symbol stored in NameRegistry |
| **MintPolicy Interface** | Three hooks:<br>`beforeMintPolicy(minter, group, collateralIds[], amounts[], data)` → bool<br>`beforeRedeemPolicy(operator, redeemer, group, value, data)` → redemption & burn IDs/values<br>`beforeBurnPolicy(burner, group, value, data)` → bool |
| **Reference MintPolicy** | `beforeMintPolicy` and `beforeBurnPolicy` always return true<br>`beforeRedeemPolicy` validates redemption IDs sum and treasury collateral |
| **StandardTreasury** | Only callable by Hub via ERC-1155 hooks<br>On mint: receives collateral, forwards to per-group Vault<br>On redemption: validates policy, burns group tokens, returns/burns collateral from Vault |
| **StandardVault** | Holds ERC-1155 collateral for each group<br>Only Treasury can call `returnCollateral` or `burnCollateral` |
| **Mint Types** | **Explicit** (`groupMint`) - caller provides collateral, policy runs with user data<br>**Path-based** - group appears as receiver in flow matrix, trust checks apply, internal `_groupMint` called with `explicitCall = false` |
| **Economic meaning** | Group tokens minted 1:1 from member CRC, redeemable 1:1 back<br>Total base CRC outside vaults unchanged - enables local currencies without inflating global supply |

## Name Registry (`INameRegistry`)

**v2 Name Registry**: `0xa27566fd89162cc3d40cb59c87aaaa49b85f3474`

- **Read**: `GetProfileCidAsync(avatar)` - returns current IPFS CID or null
- **Write**: `UpdateProfileCidAsync(avatar, metadataDigest32)` - updates mapping<br>Protected: only `avatar` may call unless `strict = false` (for Gnosis Safe exec transactions)

ABI includes `updateMetadataDigest(bytes32)` and `getMetadataDigest(address)`

## Migration v1 → v2

### Conversion Process

| Step | Action |
|------|--------|
| **Convert amount** | `convertFromV1ToDemurrage(v1Amount)`<br>Linear interpolation across old yearly steps, then ×3 correction (8→24 CRC/day) |
| **Migrate** | `Migration.migrate(avatars, amounts)`<br>Pulls v1 ERC-20 balances, converts, calls `Hub.migrate` |
| **Hub migration** | `migrate(owner, avatars, demurragedAmounts)`<br>Registers missing humans (auto-trust self)<br>Post-bootstrap: burns `INVITATION_COST` for each new human<br>Mints converted amounts to owner |

### Blocking Rule
While v1 token active (`V1.stop()` not called), v2 `personalMint` is disabled. Migration only way to obtain v2 balances before stopping v1.

## Operators

| Contract | Role |
|----------|------|
| **InflationaryCirclesOperator** | Transfers ERC-1155 tokens by inflationary (static) values<br>Converts static amount to today's demurraged value before transfer<br>Enforces `OnlyActOnBalancesOfSender` |
| **SignedPathOperator** | Guarantees all streams in path matrix share single source coordinate equal to `msg.sender`<br>Forwards to `Hub.operateFlowMatrix` |

## Known Bugs / Gotchas

| Bug | Symptom | Fix/Workaround |
|-----|---------|----------------|
| **Hub.stopped(address) uses msg.sender** | Querying third-party stop state returns result for caller, not argument | Use internal mapping directly or fix contract to use `mintTimes[_human]` |
| **Path-matrix coordinate packing overflow** | >65,535 vertices causes uint16 truncation → wrong routing | Keep `_flowVertices` ≤ 65535 (practically never hit) |
| **Group mint without explicit collateral trust** | Group doesn't trust collateral avatar → `groupMint` reverts | Ensure `group.trust(collateralAvatar)` before minting |
| **Demurrage rounding on very old balances** | Discount cost may overflow uint256 when applying many years of decay | Contract caps discount to `type(uint256).max` and burns excess |

## Additional Contract Addresses

- **Token Offer Factory**: `0x43c8e7cb2fea3a55b52867bb521ebf8cb072feca`
- **LBP Factory allowlist**: `0xd10d53ec77ce25829b7d270d736403218af22ad9`, `0x4bb5a425a68ed73cf0b26ce79f5eead9103c30fc`, `0xeced91232c609a42f6016860e8223b8aecaa7bd0`
- **CM Group Deployer allowlist**: `0x55785b41703728f1f1f05e77e22b13c3fcc9ce65`, `0xfeca40eb02fb1f4f5f795fc7a03c1a27819b1ded`
- **Safe Proxy Factory (recognized)**: `0x8b4404de0caece4b966a9959f134f0efda636156`, `0x12302fe9c02ff50939baaaaf415fc226c078613c`, `0x76e2cfc1f5fa8f6a5b3fc4c8f4788f0116861f9b`, `0xa6b71e26c5e0845f74c812102ca7114b6a896ab2`, `0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67`
- **Affiliate Group Registry**: `0xca8222e780d046707083f51377b5fd85e2866014`
- **OIC module**: `0x6fff09332ae273ba7095a2a949a7f4b89eb37c52`
- **Base Group Router**: `0xdc287474114cc0551a81ddc2eb51783fbf34802f`
- **Base Group Deployer**: `0xd0b5bd9962197beac4cba24244ec3587f19bd06d`