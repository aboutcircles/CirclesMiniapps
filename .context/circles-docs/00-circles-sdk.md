# Circles SDK v2 - Agent Reference

> **Purpose**: Complete self-contained reference for a Claude agent working with the Circles SDK v2. No external context required.
>
> **Source**: `@aboutcircles/sdk` packages via Context7 + internal project knowledge.
>
> **Last updated**: March 2026

> **IMPORTANT**: as of March 2026 SDK "v2" actually == release v0.1.24

---

## 1. What is the Circles SDK?

The Circles SDK v2 is a TypeScript SDK for interacting with the **Circles protocol** - a decentralised universal basic income (UBI) system on the **Gnosis blockchain** (chain ID `100`). It provides modular packages for contract interactions, RPC queries, pathfinding for token transfers, profile management, and transaction execution through Safe multisig wallets.

### Key protocol concepts

- **Circles (CRC)**: Personal tokens minted at 1 CRC/hour per registered human. Subject to demurrage (time-decay), which structurally encourages circulation over hoarding.
- **Trust**: Bilateral relationships between avatars. If Alice trusts Bob, Alice accepts Bob's personal tokens. Mutual trust enables transitive transfers.
- **Avatars**: Registered entities (humans, groups, organisations) in the Circles protocol.
- **Groups**: Collectives that can mint group tokens backed by member CRC. Created via `BaseGroupFactory`.
- **Flow matrix / operateFlowMatrix**: The on-chain mechanism for executing multi-hop transitive transfers. The SDK's pathfinder computes optimal routes, then the flow matrix encodes them for a single contract call.
- **Demurrage vs Static (Inflationary)**: Two representations of the same value. Demurrage amounts decay over time; static amounts are inflation-adjusted and stable. The `CirclesConverter` utility handles conversions with bit-identical precision to the on-chain Solidity implementation.
- **Safe multisig**: All Circles accounts are Safe smart accounts. The `SafeContractRunner` package handles transaction execution through these wallets.

---

## 2. Package architecture

| Package | Import | Purpose |
|---|---|---|
| `@aboutcircles/sdk-core` | `Core`, `circlesConfig`, `BaseGroupContract` | Contract wrappers for HubV2, BaseGroupFactory. Direct blockchain interaction. |
| `@aboutcircles/sdk-rpc` | `CirclesRpc`, `Observable` | RPC client for querying data, pathfinding, event subscriptions. Main data layer. |
| `@aboutcircles/sdk-transfers` | `TransferBuilder` | Advanced transfer construction: pathfinding, wrapped tokens, flow matrices. |
| `@aboutcircles/sdk-profiles` | `Profiles`, `Profile` | IPFS-based user profile create/read/search. |
| `@aboutcircles/sdk-pathfinder` | `createFlowMatrix` | Converts pathfinder results into flow matrix parameters for `operateFlowMatrix`. |
| `@aboutcircles/sdk-runner` | `SafeContractRunner`, `SafeBatchRun` | Transaction execution via Safe multisig wallets. Supports batching. |
| `@aboutcircles/sdk-utils` | `CirclesConverter` | Currency conversion: demurrage/static, atto/human-readable, V1-to-V2 migration. |
| `@aboutcircles/sdk-types` | `CirclesConfig`, `Address`, `Hex` | Shared type definitions. |

---

## 3. Installation and build

```bash
# Uses Bun as package manager/runtime
bun install
bun run build
```

---

## 4. Configuration and initialisation

### 4.1 Core SDK (contract interactions)

```typescript
import { Core, circlesConfig, BaseGroupContract } from '@aboutcircles/sdk-core';

// Default Gnosis Chain configuration
const core = new Core();

// Custom RPC URL
const core = new Core(
  circlesConfig[100],  // Gnosis Chain config (chainId 100)
  'https://custom-rpc.example.com'
);

// Available contract instances after init:
core.hubV2              // HubV2 contract wrapper
core.baseGroupFactory   // BaseGroupFactory contract wrapper
core.rpcUrl             // Current RPC URL
core.config             // Full CirclesConfig object
```

**Key config properties** (from `circlesConfig[100]`):

- `v2HubAddress`: `0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8`
- `baseGroupFactoryAddress`: address of the BaseGroupFactory
- `nameRegistryAddress`: address of the NameRegistry
- `liftERC20Address`: `0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5`

### 4.2 RPC Client (data queries)

```typescript
import { CirclesRpc } from '@aboutcircles/sdk-rpc';

// Production endpoints
const rpc = new CirclesRpc('https://rpc.circlesubi.network/');
// or
const rpc = new CirclesRpc('https://rpc.aboutcircles.com/');

// Dynamic URL change
rpc.setRpcUrl('https://rpc.aboutcircles.com/');
console.log(rpc.getRpcUrl());
```

**RPC method groups** (all accessed as `rpc.<group>.<method>`):

| Group | Purpose |
|---|---|
| `rpc.circlesV2` | Core V2 operations (balance, pathfinding) |
| `rpc.query` | Custom table queries, events, schema discovery |
| `rpc.trust` | Trust relationship queries |
| `rpc.balance` | Token balance queries |
| `rpc.avatar` | Avatar info and network snapshots |
| `rpc.profile` | Profile lookups by address |
| `rpc.pathfinder` | Pathfinding for transfers |
| `rpc.transaction` | Transaction history |
| `rpc.group` | Group operations |

### 4.3 Known endpoints

| Service | URL | Notes |
|---|---|---|
| Circles RPC (production) | `https://rpc.circlesubi.network/` | Primary |
| Circles RPC (alt) | `https://rpc.aboutcircles.com/` | Alternative |
| Profiles | `https://rpc.aboutcircles.com/profiles/` | IPFS profile pinning |
| Staging | `https://staging.circlesubi.network` | Fetch `/docs` to confirm live specs |
| Pathfinder REST | `https://staging.circlesubi.network/pathfinder/openapi/v1.json` | OpenAPI spec |
| Circles RPC (OpenRPC) | `https://staging.circlesubi.network/openrpc.json` | OpenRPC spec |

---

## 5. HubV2 contract operations

All methods return a transaction object `{ to: Address, data: Hex, value: bigint }` ready to be sent via a wallet or Safe.

### 5.1 Trust operations

```typescript
// Trust an address (1-year expiry)
const oneYearFromNow = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
const trustTx = core.hubV2.trust('0xTrusteeAddress', oneYearFromNow);

// Untrust an address (set expiry to 0)
const untrustTx = core.hubV2.trust('0xAddressToUntrust', BigInt(0));

// Check trust status (read call)
const isTrusted: boolean = await core.hubV2.isTrusted('0xTruster', '0xTrustee');

// Operator approval (ERC1155 pattern)
const approvalTx = core.hubV2.setApprovalForAll('0xOperator', true);
const isApproved: boolean = await core.hubV2.isApprovedForAll('0xOwner', '0xOperator');
```

**Important**: `expiry = BigInt(0)` means untrust. Any future timestamp means trust until that time.

### 5.2 Group mint

```typescript
const groupMintTx = core.hubV2.groupMint(
  '0xGroupAddress',           // group address
  ['0xRecipient1', '0xRecipient2'],  // recipients array
  [BigInt(100), BigInt(200)],        // amounts array (must match recipients length)
  '0x'                               // data (usually empty)
);
// Returns: { to: Address, data: Hex, value: bigint }
```

---

## 6. BaseGroup operations

### 6.1 Create a group

```typescript
const createGroupTx = core.baseGroupFactory.createBaseGroup(
  '0xOwnerAddress',       // owner
  '0xServiceAddress',     // service
  '0xFeeCollector',       // feeCollection address
  [],                     // initial conditions array
  'MyGroup',              // name
  'MYG',                  // symbol
  '0x00...00'             // mint policy (bytes32)
);
```

### 6.2 Manage group membership

```typescript
const baseGroup = new BaseGroupContract({
  address: '0xExistingGroupAddress',
  rpcUrl: core.rpcUrl
});

// Trust multiple members with conditions
const oneYearFromNow = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
const trustBatchTx = baseGroup.trustBatchWithConditions(
  ['0xMember1', '0xMember2'],  // members to trust
  oneYearFromNow               // expiry timestamp
);
```

---

## 7. Pathfinding and transfers

### 7.1 Find a transfer path

```typescript
const path = await rpc.circlesV2.findPath({
  from: '0xSenderAddress',
  to: '0xRecipientAddress',
  targetFlow: 99999999999999999999999999999999999n  // large number = find max flow
});

// Result:
// path.transfers - array of individual transfer steps
// path.maxFlow   - maximum transferable amount
```

### 7.2 Find a circular path (token swap)

```typescript
const swapPath = await rpc.circlesV2.findPath({
  from: '0xAddress',
  to: '0xAddress',              // same address = circular/swap
  targetFlow: 100000000000000000000n,  // 100 tokens
  fromTokens: ['0xSourceToken'],
  toTokens: ['0xTargetToken'],
  simulatedBalances: [{
    holder: '0xAddress',
    token: '0xSourceToken',
    amount: 100000000000000000000n,
    isWrapped: false
  }]
});
```

### 7.3 Alternative pathfinder interface

```typescript
const pathResult = await rpc.pathfinder.findPath({
  from: '0xSender',
  to: '0xRecipient',
  targetFlow: 100000000000000000000n,
  useWrappedBalances: false
});

// pathResult.transfers[] contains:
// - from: Address
// - to: Address
// - tokenOwner: Address
// - value: bigint
```

### 7.4 Create flow matrix from path

```typescript
import { createFlowMatrix } from '@aboutcircles/sdk-pathfinder';

const flowMatrix = createFlowMatrix(
  from,                       // sender address
  to,                         // recipient address
  pathResult.maxFlow,         // max flow from pathfinder
  pathResult.transfers        // transfer steps from pathfinder
);

// flowMatrix contains:
// - flowVertices: Address[]
// - flowEdges: ...
// - streams: ...
// - packedCoordinates: ...
// - sourceCoordinate: ...

// Execute via HubV2:
// const tx = hubV2Contract.operateFlowMatrix(
//   flowMatrix.flowVertices,
//   flowMatrix.flowEdges,
//   flowMatrix.streams,
//   flowMatrix.packedCoordinates
// );
```

### 7.5 TransferBuilder (high-level)

```typescript
import { TransferBuilder } from '@aboutcircles/sdk-transfers';
import type { CirclesConfig, Address } from '@aboutcircles/sdk-types';

const config: CirclesConfig = {
  circlesRpcUrl: 'https://rpc.aboutcircles.com/',
  v2HubAddress: '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8' as Address,
  liftERC20Address: '0x5F99a795dD2743C36D63511f0D4bc667e6d3cDB5' as Address,
  // ... other config properties
};

const transferBuilder = new TransferBuilder(config);
```

#### Construct an advanced transfer

```typescript
const transactions = await transferBuilder.constructAdvancedTransfer(
  from,           // sender Address
  to,             // recipient Address
  amount,         // bigint (in atto-circles, 18 decimals)
  {
    useWrappedBalances: true,     // allow wrapped tokens in path
    fromTokens: ['0xToken'],      // optional: specific source tokens
    toTokens: ['0xTargetToken'],  // optional: specific target tokens
  },
  false  // aggregate flag
);
// Returns: Transaction[] - array of { to, data, value } objects
```

#### Build flow matrix from pre-computed path

```typescript
const transactions = await transferBuilder.buildFlowMatrixTx(
  from,
  to,
  pathResult,                    // from rpc.pathfinder.findPath()
  { useWrappedBalances: false }
);
```

#### Construct replenish transaction

```typescript
const transactions = await transferBuilder.constructReplenish(
  from,              // your address
  tokenId,           // target token owner address
  targetAmount       // desired unwrapped amount (bigint)
);
```

---

## 8. Trust relations

### 8.1 Query trust relationships

```typescript
const address = '0xYourAddress';

// All V2 trust relations
const allRelations = await rpc.trust.getTrustRelations(address);

// Aggregated (categorised) trust relations
const aggregated = await rpc.trust.getAggregatedTrustRelations(address);
// Each entry has: .relation = 'mutuallyTrusts' | 'trusts' | 'trustedBy'

// Filter by relation type
const mutual = aggregated.filter(r => r.relation === 'mutuallyTrusts');
const trusts = aggregated.filter(r => r.relation === 'trusts');
const trustedBy = aggregated.filter(r => r.relation === 'trustedBy');

// Directional queries
const whoTrustsMe = await rpc.trust.getTrustedBy(address);     // incoming
const whoITrust = await rpc.trust.getTrusts(address);            // outgoing
const mutualTrusts = await rpc.trust.getMutualTrusts(address);   // mutual

// Common trust between two addresses
const common = await rpc.trust.getCommonTrust(address1, address2);
```

---

## 9. Token balances

```typescript
const balances = await rpc.balance.getTokenBalances(address);

// Filter by version
const v2Balances = balances.filter(b => b.version === 2);
```

**Balance object properties**:

| Property | Type | Description |
|---|---|---|
| `tokenAddress` | Address | The ERC1155 token contract address |
| `tokenOwner` | Address | Who minted/owns the token type |
| `tokenType` | string | Token classification |
| `attoCircles` | bigint | Raw demurraged balance (18 decimals) |
| `circles` | number | Human-readable demurraged balance |
| `staticAttoCircles` | bigint | Raw inflation-adjusted balance (18 decimals) |
| `staticCircles` | number | Human-readable inflation-adjusted balance |
| `isErc1155` | boolean | Is ERC1155 token |
| `isWrapped` | boolean | Is wrapped (ERC20-lifted) token |
| `isGroup` | boolean | Is a group token |
| `version` | number | Protocol version (1 or 2) |

---

## 10. Avatar information

```typescript
const avatarInfo = await rpc.avatar.getAvatarInfo('0xAddress');

// avatarInfo properties:
// - type: 'human' | 'group' | 'organization' | etc.
// - version: number
// - tokenAddress: Address (if registered)
// - cidV0: string (IPFS CID for profile, if set)
```

### Network snapshot

```typescript
const snapshot = await rpc.avatar.getNetworkSnapshot();

// snapshot properties:
// - trustRelations: array of { truster/from, trustee/to }
// - balances: array of balance objects
// - blockNumber: number
// - timestamp: bigint (unix seconds)
```

---

## 11. Profiles (IPFS)

```typescript
import { Profiles, type Profile } from '@aboutcircles/sdk-profiles';
import { CirclesRpc } from '@aboutcircles/sdk-rpc';

const profiles = new Profiles('https://rpc.aboutcircles.com/profiles/');
const rpc = new CirclesRpc('https://rpc.circlesubi.network/');
```

### Create and pin a profile

```typescript
const profile: Profile = {
  name: 'Alice',
  description: 'Developer and designer',
  location: 'Berlin, Germany',
  // imageUrl: optional
};

const cid: string = await profiles.create(profile);
// Returns IPFS CID string
```

### Retrieve profiles

```typescript
// By CID
const profile = await profiles.get(cid);

// By address (via RPC)
const profile = await rpc.profile.getProfileByAddress('0xAddress');

// Batch by addresses
const profilesBatch = await rpc.profile.getProfileByAddressBatch([
  '0xAddress1',
  '0xAddress2',
  '0xAddress3'
]);

// Search profiles
const results = await rpc.profile.searchProfiles('0xAddress', 10, 0);
// Returns array of { name, address, ... }
```

**Profile properties**: `name`, `description`, `location`, `imageUrl`

---

## 12. Query API (custom queries and events)

### 12.1 Discover available tables

```typescript
const tables: string[] = await rpc.query.tables();
```

### 12.2 Custom queries

```typescript
const results = await rpc.query.query({
  Namespace: 'V_CrcV2',          // Schema namespace
  Table: 'TrustRelations',       // Table name
  Columns: [],                    // Empty = all columns
  Filter: [{
    Type: 'Conjunction',
    ConjunctionType: 'Or',
    Predicates: [
      {
        Type: 'FilterPredicate',
        FilterType: 'Equals',
        Column: 'truster',
        Value: '0xAddress'
      },
      {
        Type: 'FilterPredicate',
        FilterType: 'Equals',
        Column: 'trustee',
        Value: '0xOtherAddress'
      }
    ]
  }],
  Order: [{
    Column: 'demurragedTotalBalance',
    SortOrder: 'DESC'             // or 'ASC'
  }]
});
```

**Filter types**:

- `FilterPredicate` with `FilterType`: `'Equals'`, and likely `'GreaterThan'`, `'LessThan'`, `'Contains'`, etc.
- `Conjunction` with `ConjunctionType`: `'Or'`, `'And'`

**Known tables** (namespace `V_CrcV2`):

- `TrustRelations`
- `BalancesByAccountAndToken`
- (Discover more via `rpc.query.tables()`)

### 12.3 Query blockchain events

```typescript
const events = await rpc.query.events(
  38000000,           // fromBlock
  null,               // toBlock (null = latest)
  ['CrcV1_Trust'],    // event type names
  null,               // filter (null = no filter)
  false               // includeLogs
);
```

**Known event types**:

- `CrcV1_Trust`
- `CrcV2_Trust`
- `CrcV2_TransferSingle`
- `CrcV2_PersonalMint`
- `CrcV2_GroupMint`
- `CrcV2_RegisterHuman`
- `CrcV2_RegisterGroup`

---

## 13. Transaction history

```typescript
const recentTxs = await rpc.transaction.getTransactionHistory(address, 10);
// limit parameter controls number of results
```

**Transaction object properties**:

| Property | Type | Description |
|---|---|---|
| `blockNumber` | number | Block containing this transaction |
| `timestamp` | number | Unix timestamp (seconds) |
| `from` | Address | Sender address |
| `to` | Address | Recipient address |
| `tokenAddress` | Address | Token contract address |
| `value` | string/bigint | Transfer amount |
| `version` | number | Protocol version (1 or 2) |
| `transactionHash` | Hex | On-chain tx hash |

**Classify transactions**:

```typescript
// Incoming
const incoming = txs.filter(tx => tx.to.toLowerCase() === myAddress.toLowerCase());

// Outgoing
const outgoing = txs.filter(tx => tx.from.toLowerCase() === myAddress.toLowerCase());

// Minting (from zero address)
const minting = txs.filter(tx =>
  tx.from === '0x0000000000000000000000000000000000000000' &&
  tx.to.toLowerCase() === myAddress.toLowerCase()
);
```

---

## 14. Safe runner (transaction execution)

### 14.1 Initialise

```typescript
import { SafeContractRunner } from '@aboutcircles/sdk-runner';
import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';

const PRIVATE_KEY = '0xYourPrivateKey' as `0x${string}`;
const SAFE_ADDRESS = '0xYourSafeAddress' as `0x${string}`;
const RPC_URL = 'https://rpc.aboutcircles.com/';

// Method 1: Manual init
const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(RPC_URL),
});

const runner = new SafeContractRunner(publicClient, PRIVATE_KEY, RPC_URL, SAFE_ADDRESS);
await runner.init();

// Method 2: Static factory (recommended)
const runner = await SafeContractRunner.create(
  'https://rpc.gnosischain.com',
  '0xYourPrivateKey...',
  '0xYourSafeAddress...',
  gnosis
);
```

### 14.2 Send a single transaction

```typescript
const tx = core.hubV2.trust('0xAddress', BigInt(0));

// Estimate gas
const gas = await runner.estimateGas!(tx);

// Send
const response = await runner.sendTransaction!([tx]);
console.log(response.hash);
console.log(response.blockNumber);
```

### 14.3 Batch transactions (atomic)

```typescript
const batch = runner.sendBatchTransaction();

batch.addTransaction(core.hubV2.trust('0xAddr1', expiry));
batch.addTransaction(core.hubV2.trust('0xAddr2', expiry));

const receipt = await batch.run();
console.log(receipt.transactionHash);
```

---

## 15. Currency converter

```typescript
import { CirclesConverter } from '@aboutcircles/sdk-utils';
```

### 15.1 Basic conversions

```typescript
// Atto-circles (bigint, 18 decimals) <-> human-readable (number)
const circles = CirclesConverter.attoCirclesToCircles(1000000000000000000n);  // 1.0
const atto = CirclesConverter.circlesToAttoCircles(1.5);  // 1500000000000000000n
```

### 15.2 Demurrage <-> Static (inflationary)

```typescript
const demurraged = 100n * 10n ** 18n;

// Demurraged -> Static
const staticAmount = CirclesConverter.attoCirclesToAttoStaticCircles(demurraged);

// Static -> Demurraged
const backToDemurraged = CirclesConverter.attoStaticCirclesToAttoCircles(staticAmount);

// Exact (lossless) variants for higher precision
const staticExact = CirclesConverter.attoCirclesToAttoStaticCirclesExact(demurraged);
const demurragedExact = CirclesConverter.attoStaticCirclesToAttoCirclesExact(staticExact);
```

### 15.3 V1 to V2 migration

```typescript
const v1Amount = 100n * 10n ** 18n;
const blockTimestamp = BigInt(Math.floor(Date.now() / 1000));
const v2Amount = CirclesConverter.attoCrcToAttoCircles(v1Amount, blockTimestamp);
```

### 15.4 Utility

```typescript
// Current day index
const dayIndex = CirclesConverter.dayFromTimestamp(BigInt(Math.floor(Date.now() / 1000)));

// Truncate to 6 decimals (pathfinder precision)
const truncated = CirclesConverter.truncateToSixDecimals(amount);
```

### 15.5 Token denomination cheat sheet

| Unit | Decimals | Type | Example |
|---|---|---|---|
| atto-circles | 18 | bigint | `1000000000000000000n` = 1 CRC |
| circles | 0 | number | `1.0` |
| static atto-circles | 18 | bigint | Inflation-adjusted, time-stable |
| static circles | 0 | number | Inflation-adjusted, time-stable |

---

## 16. WebSocket subscriptions (real-time events)

```typescript
import { CirclesRpc, Observable } from '@aboutcircles/sdk-rpc';

const rpc = new CirclesRpc('https://rpc.circlesubi.network/');

// Subscribe to all events
const observable = await rpc.subscribe();

// Subscribe to events for a specific address
const addressObservable = await rpc.subscribe('0xYourAddress');

// Handle events
observable.subscribe((event) => {
  console.log(event.event);   // Event type string
  console.log(event.values);  // Event-specific data
});
```

**Event types emitted**:

- `CrcV2_Trust` - Trust relationship created/updated
- `CrcV2_TransferSingle` - Token transfer
- `CrcV2_PersonalMint` - Personal token minting
- `CrcV2_GroupMint` - Group token minting
- `CrcV2_RegisterHuman` - New human avatar registered
- `CrcV2_RegisterGroup` - New group registered

---

## 17. Common patterns and recipes

### 17.1 Full transfer flow (pathfind -> flow matrix -> execute)

```typescript
import { Core } from '@aboutcircles/sdk-core';
import { CirclesRpc } from '@aboutcircles/sdk-rpc';
import { createFlowMatrix } from '@aboutcircles/sdk-pathfinder';
import { SafeContractRunner } from '@aboutcircles/sdk-runner';

const core = new Core();
const rpc = new CirclesRpc('https://rpc.aboutcircles.com/');

// 1. Find path
const pathResult = await rpc.pathfinder.findPath({
  from: senderAddress,
  to: recipientAddress,
  targetFlow: amountInAttoCircles,
  useWrappedBalances: false
});

// 2. Build flow matrix
const flowMatrix = createFlowMatrix(
  senderAddress,
  recipientAddress,
  pathResult.maxFlow,
  pathResult.transfers
);

// 3. Create operateFlowMatrix transaction
const tx = core.hubV2.operateFlowMatrix(
  flowMatrix.flowVertices,
  flowMatrix.flowEdges,
  flowMatrix.streams,
  flowMatrix.packedCoordinates
);

// 4. Execute via Safe
const runner = await SafeContractRunner.create(rpcUrl, privateKey, safeAddress, gnosis);
const receipt = await runner.sendTransaction!([tx]);
```

### 17.2 Check if address is registered

```typescript
const info = await rpc.avatar.getAvatarInfo('0xAddress');
const isRegistered = !!info && !!info.type;
const isHuman = info?.type === 'human';
const isGroup = info?.type === 'group';
```

### 17.3 Get total CRC balance for an address

```typescript
const balances = await rpc.balance.getTokenBalances(address);
const v2Balances = balances.filter(b => b.version === 2);
const totalCircles = v2Balances.reduce((sum, b) => sum + b.circles, 0);
const totalAtto = v2Balances.reduce((sum, b) => sum + b.attoCircles, 0n);
```

### 17.4 Trust + transfer in one batch

```typescript
const runner = await SafeContractRunner.create(rpcUrl, pk, safe, gnosis);
const core = new Core();

const batch = runner.sendBatchTransaction();
batch.addTransaction(core.hubV2.trust(recipientAddress, expiryTimestamp));
// ... add transfer tx after pathfinding
const receipt = await batch.run();
```

### 17.5 Profile lookup with fallback

```typescript
let profile = await rpc.profile.getProfileByAddress(address);
if (!profile) {
  const info = await rpc.avatar.getAvatarInfo(address);
  if (info?.cidV0) {
    const profiles = new Profiles('https://rpc.aboutcircles.com/profiles/');
    profile = await profiles.get(info.cidV0);
  }
}
```

---

## 18. Testing considerations

### 18.1 Test addresses

These addresses appear in the SDK documentation examples and can be used for read-only queries against production:

- `0xc7d3dF890952a327Af94D5Ba6fdC1Bf145188a1b`
- `0xde374ece6fa50e781e81aac78e811b33d16912c7`
- `0x749c930256b47049cb65adcd7c25e72d5de44b3b`
- `0xA6247834B41771022498F63CAE8820fFEE208265`
- `0xDbc166DCD406068B27E0cbBec6C4251F38Da992A`
- `0xc3a1428c04c426cdf513c6fc8e09f55ddaf50cd7`
- `0xf712d3b31de494b5c0ea51a6a407460ca66b12e8`

### 18.2 Testing read operations (no wallet needed)

```typescript
// These can be tested without a private key or Safe
const rpc = new CirclesRpc('https://rpc.circlesubi.network/');

// Balances
const balances = await rpc.balance.getTokenBalances(testAddress);

// Trust relations
const trusts = await rpc.trust.getTrustRelations(testAddress);

// Avatar info
const info = await rpc.avatar.getAvatarInfo(testAddress);

// Transaction history
const txs = await rpc.transaction.getTransactionHistory(testAddress, 10);

// Pathfinding (read-only, does not execute)
const path = await rpc.pathfinder.findPath({ from, to, targetFlow });

// Custom queries
const tables = await rpc.query.tables();

// Profile lookups
const profile = await rpc.profile.getProfileByAddress(testAddress);
```

### 18.3 Testing write operations (requires wallet)

Write operations require:
1. A private key (EOA that owns the Safe)
2. A Safe address (the Circles account)
3. Sufficient xDAI for gas on Gnosis Chain

```typescript
// Setup for write tests
const runner = await SafeContractRunner.create(
  'https://rpc.gnosischain.com',
  process.env.TEST_PRIVATE_KEY!,
  process.env.TEST_SAFE_ADDRESS!,
  gnosis
);

// All write operations go through the runner
const receipt = await runner.sendTransaction!([tx]);
```

### 18.4 Unit testing flow matrix construction

The `createFlowMatrix` function is pure (no network calls) and can be unit tested with mock pathfinder results:

```typescript
import { createFlowMatrix } from '@aboutcircles/sdk-pathfinder';

const mockPath = {
  maxFlow: 100n * 10n ** 18n,
  transfers: [
    { from: '0xA', to: '0xB', tokenOwner: '0xTokenOwner', value: 100n * 10n ** 18n }
  ]
};

const matrix = createFlowMatrix('0xA', '0xB', mockPath.maxFlow, mockPath.transfers);
// Assert matrix properties exist and are well-formed
```

---

## 19. Error handling notes

- RPC calls may throw on network issues or invalid parameters
- Pathfinder returns `null` or empty results when no path exists between addresses
- `getAvatarInfo` returns `null` for unregistered addresses
- Profile lookups return `null`/`undefined` for addresses without profiles
- Safe runner throws on insufficient gas, nonce conflicts, or reverted transactions
- Always wrap RPC and transaction calls in try/catch
- BigInt values require explicit conversion - never mix `number` and `bigint` arithmetic

---

## 20. Invitation and referral SDK functions

These functions are part of the invitations-at-scale initiative and may be in separate modules:

| Function | Purpose |
|---|---|
| `generateReferralsViaFarm(inviter, numberOfLinks)` | Generate private key/address pairs, claim invites from InvitationFarm, batch transfer to InvitationModule |
| `findInvitePath(inviter, numberOfInvites)` | Find optimal path from inviter to InvitationModule with priority filters |
| `generateInviteData(addresses)` | Encode invite data for known invitees or pre-generated signers |
| `generateInvites(inviter, numberOfInvites, invitees)` | Full invite flow: pathfind + encode + return Hub calldata |
| `generateReferrals(inviter, numberOfReferrals)` | Full referral flow: pathfind + secrets + encode. Returns calldata + private keys |
| `requestReferral(inviter)` | Look up unused referral from DB, return private key or 0 |
| `deriveAddress(privateKey)` | Derive signer address from private key |
| `computeAddress(signer)` | Compute invitee Safe address from signer (mirrors ReferralsModule contract logic) |

**Production contract addresses**:

- Invitation Module: `0x00738aca013B7B2e6cfE1690F0021C3182Fa40B5`
- Referrals Module: `0x12105a9B291aF2ABb0591001155A75949b062CE5`
- Account Initialiser Hash: `0x89867a67674bd4bf33165a653cde826b696ab7d050166b71066dfa0b9b6f90f4`

---

## 21. Glossary

| Term | Definition |
|---|---|
| **Atto-circles** | Smallest unit. 1 CRC = 10^18 atto-circles. Always `bigint`. |
| **Avatar** | Any registered entity in Circles (human, group, organisation). |
| **Demurrage** | Time-decay applied to CRC balances. 1 CRC/hour minting offsets this. |
| **Flow matrix** | Encoded multi-hop transfer path for `operateFlowMatrix` contract call. |
| **HubV2** | Main Circles protocol contract on Gnosis Chain. |
| **Lift / Wrap** | Converting ERC1155 Circles tokens to ERC20 (wrapped) form. |
| **Pathfinder** | Algorithm that finds transitive transfer routes through the trust graph. |
| **Safe** | Smart contract wallet (Gnosis Safe). All Circles accounts are Safes. |
| **Static circles** | Inflation-adjusted representation. Stable over time (unlike demurraged). |
| **Trust** | Directional relationship: "I accept your personal tokens." |
| **xDAI** | Native gas token on Gnosis Chain (1:1 pegged to DAI). |