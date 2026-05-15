# Read patterns

Reading Circles state without sending transactions: profiles, balances, trust relations, indexed events.

**Load this when:** building any UI that displays user data (avatar info, balances, trust graph), running analytics queries, or fetching historical events.

## Pattern B: RPC client (viem)

For raw on-chain reads (calling contracts, reading logs, etc.). Most miniapps need this alongside the Circles SDK.

```javascript
import { createPublicClient, http, getAddress } from 'viem';
import { gnosis } from 'viem/chains';

const RPC_URLS = [
  'https://rpc.aboutcircles.com/',
  'https://rpc.gnosischain.com'
];

const publicClient = createPublicClient({
  chain: gnosis,
  transport: http(RPC_URLS[0]),
  cacheTime: 60_000,
  batch: { multicall: { wait: 50 } },
});
```

**Notes:**
- `cacheTime: 60_000` reduces redundant RPC calls during a session. Increase for stable data, decrease for live state.
- Multicall batching with a 50ms wait window dramatically reduces request count when fetching many things at once.

## Pattern C: Circles SDK for reads

The Circles SDK provides high-level read operations. **Pass `null` as the runner** - reads don't need transaction-sending capability.

```javascript
import { Sdk } from '@aboutcircles/sdk';

const sdk = new Sdk('https://rpc.aboutcircles.com/', null);
```

> **Important**: never construct the SDK at module scope. Use the lazy pattern from AGENTS.md (`getSdk()` wrapper) to avoid silent initialisation failures that produce blank white screens.

### Profile lookups

```javascript
// By exact address
const profile = await sdk.rpc.profile.getProfileByAddress(address);
const name = profile?.name || profile?.registeredName || 'Unknown';

// By name or partial address (returns up to 10)
const results = await sdk.rpc.profile.searchByAddressOrName(query, 10, 0);
```

### Trust relations

```javascript
const relations = await sdk.data.getTrustRelations(address);
// relations is an array of trust links - empty array is valid (user trusts no one yet)
```

### Avatar info

```javascript
const avatarInfo = await sdk.data.getAvatarInfo(address);
// null if the address is not a registered Circles avatar
```

### Token balances

```javascript
const avatar = await sdk.getAvatar(address);
if (!avatar) {
  // Address has no Circles avatar - show appropriate UI, don't crash
  return;
}

const balances = await avatar.balances.getTokenBalances();
const totalWei = balances.reduce((s, b) => s + BigInt(b.attoCircles ?? 0n), 0n);
```

**Balance object shape:** `{ tokenAddress, tokenOwner, attoCircles, isWrapped, ... }`. Use `isWrapped` to distinguish ERC20 wrapped tokens from raw ERC1155 holdings.

## Pattern G: CirclesRPC queries (indexed events)

For querying historical chain events directly from the Circles indexer. More flexible than viem `getLogs` because it understands Circles event schemas.

```javascript
async function circlesQuery(namespace, table, columns, filters = [], order = []) {
  const sdk = getSdk(); // lazy SDK construction
  const response = await sdk.circlesRpc.call('circles_query', [{
    Namespace: namespace,
    Table: table,
    Columns: columns,
    Filter: filters.map(f => ({
      Type: 'FilterPredicate',
      FilterType: f.op || 'Equals',
      Column: f.column,
      Value: f.value,
    })),
    Order: order,
  }]);

  const cols = response?.result?.columns || [];
  const rows = response?.result?.rows || [];
  return rows.map(row =>
    Object.fromEntries(cols.map((col, i) => [col, row[i]]))
  );
}
```

### Example: find all CRC transfers to an address

```javascript
const transfers = await circlesQuery(
  'CrcV2', 'Transfer',
  ['from', 'to', 'value', 'timestamp'],
  [{ column: 'to', value: address.toLowerCase() }],
  [{ Column: 'timestamp', SortOrder: 'DESC' }]
);
```

### Available namespaces

| Namespace | Use for |
|---|---|
| `CrcV2` | Trust, transfers, registrations |
| `CrcV2_PaymentGateway` | `GatewayCreated`, `TrustUpdated` (gateway acceptance lists) |
| `CrcV2_Groups` | Group events |
| `CrcV2_Organizations` | Organisation events |

For the full method reference and other namespaces, load `@.agents/circles-docs/05-rpc-api-reference.md`.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `getAvatar()` returns `null` | Address is not registered as a Circles avatar | Show a clear "no Circles avatar found" message; do not crash |
| `getTokenBalances()` returns `[]` | Avatar exists but holds nothing | Show "no balance yet" - this is a valid state, not an error |
| `getProfileByAddress()` returns `null` | Avatar exists but no profile registered | Fall back to short address display |
| Any SDK call throws | Wrong address format or RPC down | Check the address is checksummed, try a fallback RPC |
