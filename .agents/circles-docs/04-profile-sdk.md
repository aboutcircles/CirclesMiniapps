# Circles 2.0 - Profile SDK & Off-Chain System

## Overview

The Profiles subsystem lives entirely off-chain except for the immutable name-registry mapping. All heavy lifting is done by the **Circles.Profiles.Sdk** (C# .NET SDK).

## Core Interfaces

| Interface | Core Methods |
|-----------|--------------|
| **IIpfsStore** | Add JSON/bytes → CID<br>Retrieve stream (`CatAsync`) or string (`CatStringAsync`)<br>Compute CID without upload (`CalcCidAsync`) |
| **INameRegistry** | `GetProfileCidAsync(avatar)` - fetch current profile CID<br>`UpdateProfileCidAsync(avatar, digest32)` - update mapping (restricted to avatar or Safe) |
| **INamespaceWriter** | Append-only log ops:<br>`AddJsonAsync(name, json)`<br>`AttachExistingCidAsync(name, cid)`<br>Batch variants: `AddJsonBatchAsync`, `AttachCidBatchAsync` |
| **INamespaceReader** | `GetLatestAsync(name)` - newest link (or null)<br>`StreamAsync(newerThanUnixTs)` - async stream of all links newer than timestamp, verified on-the-fly |
| **IProfileStore** | CRUD for whole profile objects: `FindAsync(avatar)`, `SaveAsync(profile, signer)` |
| **ISigner** | `Address` (effective signature address)<br>`SignAsync(canonicalPayload, chainId)` → 65-byte ECDSA or Safe signature |
| **ISignatureVerifier** / **ISafeBytesVerifier** | Off-chain verification of hash or raw payload against signer address<br>Handles EOAs (ECDSA) and contract wallets (ERC-1271) |

## Signature Verification Flow

1. **Canonicalisation**: SDK calls `CanonicalJson.CanonicaliseWithoutSignature(link)` implementing RFC 8785: stable field order, no duplicate keys, normalized numbers
2. **Hashing**: EOAs → payload bytes hashed with Keccak-256<br>Contract wallets → raw payload passed directly to ERC-1271 (`isValidSignature`)
3. **Verifier selection**: `DefaultSignatureVerifier` queries `IChainApi.GetCodeAsync(address)` to detect contract code
   - **Yes** → delegates to `SafeSignatureVerifier`
   - **No** → uses `EoaSignatureVerifier`
4. **ERC-1271 "bytes" fallback**: Even for EOAs, verifier tries ERC-1271 "bytes" variant first (returns non-magic if not contract)<br>Fallback to standard ECDSA verification
5. **Replay protection**: After cryptographic checks pass, `NonceRegistrySingleton.SeenBefore(link.Nonce)` consulted<br>Repeat nonce → link discarded silently

## Namespace Writer Mechanics

### Chunk-Based Architecture

- **Chunk size**: Capped at `Helpers.ChunkMaxLinks` (100 links)
- **Rotation**: When chunk full, new chunk created with `prev` field pointing to old head
- **Index document**: Tiny JSON map `{ "head": <cid>, "entries": { logicalName → owningChunkCid } }`
- **Storage**: Index stored on IPFS, CID placed in owner profile (`profile.Namespaces[namespaceKey]`)

### Entry Replacement

Adding a link with name that already exists in **current head chunk** overwrites that slot. Older versions remain reachable via previous chunks (history preserved).

## Reader Streaming Algorithm

```csharp
async function StreamAsync(newerThan):
    curCid = index.head
    while curCid != null:
        chunk = LoadChunk(curCid)
        // Links stored in chronological order (append at end)
        for link in chunk.Links descending by SignedAt:
            if link.SignedAt <= newerThan: continue
            if VerifyLink(link) == false: continue
            yield link
        curCid = chunk.prev
```

**Properties**:
- **Memory efficient**: Only holds one chunk at a time
- **Verification**: Primary ECDSA/1271 + secondary "bytes" fallback via `ISafeBytesVerifier`
- **Order**: Newest → oldest

## Profile Store Implementation

### Save Flow
1. Serialize profile with global JSON-LD options
2. Pin via `IIpfsStore.AddStringAsync`
3. Compute CID's multihash digest (`CidConverter.CidToDigest`)
4. Call `INameRegistry.UpdateProfileCidAsync`

### Find Flow
1. Call `INameRegistry.GetProfileCidAsync`
2. If CID returned, stream JSON from IPFS
3. Deserialize using same LD options
4. Return `null` if no mapping exists

## Typical Application Flow

### 1. Bootstrap
```csharp
ipfs = new IpfsRpcApiStore("http://127.0.0.1:5001/api/v0/")
web3 = new Web3(rpcUrl)  // Gnosis Chain RPC
chain = new EthereumChainApi(web3, chainId=100)
verif = new DefaultSignatureVerifier(chain)
```

### 2. Instantiate SDK Objects
```csharp
var registry = new NameRegistry(rpcUrl);
var store = new ProfileStore(ipfs, registry);
```

### 3. Load / Create Profile
```csharp
var myProfile = await store.FindAsync(myAvatar) 
    ?? new Profile { Name = "Me" };
```

### 4. Write to Namespace (e.g., Send Message)
```csharp
var signer = new EoaSigner(myKey);  // or SafeSigner for Gnosis Safe
var writer = await NamespaceWriter.CreateAsync(
    myProfile, recipientAvatar, ipfs, signer);
await writer.AddJsonAsync("msg-123", jsonPayload);
```

### 5. Publish Profile
```csharp
var (savedProfile, cid) = await store.SaveAsync(myProfile, signer);
// Registry now maps myAvatar → cid
```

### 6. Read Inbox (Other Party)
```csharp
var reader = new DefaultNamespaceReader(
    myProfile.Namespaces[bobAddr.ToLowerInvariant()], 
    ipfs, verif);
await foreach (var link in reader.StreamAsync(0))
    // process link.Cid → fetch payload
```

### 7. Aggregate Market Catalog
See Aggregation Pipeline section below.

## Performance Tips

| Situation | Recommendation |
|-----------|----------------|
| **Many small links** (chat) | Keep chunk size at default (100)<br>Rotation is cheap; avoid large chunks that increase read latency |
| **Large binary payloads** (images, videos) | Store binary as separate CID<br>Reference from link's `cid` field<br>Do NOT embed huge blobs in namespace log |
| **High-throughput ingestion** (IoT devices) | Use batch methods (`AddJsonBatchAsync`, `AttachCidBatchAsync`)<br>Amortize IPFS pinning and signature generation costs |
| **Re-reading hot namespace** | Cache index CID locally<br>Only refresh when detecting new head (compare stored CID with on-chain value) |

## Aggregation Pipeline & Market API

### Architecture

```
[Hub] → IPFS (profile JSON + namespace chunks) → NameRegistry
   ↓
BasicAggregator (reads namespaces, verifies signatures, deduplicates)
   ↓
CatalogReducer (validates market payloads, resolves latest version per SKU,
                applies tombstones, builds AggregatedCatalog output)
   ↓
OperatorCatalogEndpoint (HTTP API) → pagination, cursor handling, error reporting
```

### BasicAggregator - Step-by-Step

#### 1. Resolve Index Heads (`ResolveIndexHeadsAsync`)
For each avatar in request list:
- Query `NameRegistry.GetProfileCidAsync`
- Load profile JSON from IPFS
- Extract namespace entry for operator's key (lower-cased operator address)
- Store mapping `{ avatar → indexHeadCID }`

Errors (missing registry entry, malformed profile) recorded in `errors` list with `"stage":"registry"` or `"profile"` tag.

#### 2. Stream Verified Links (`StreamVerifiedLinksAsync`)
For each `(avatar, headCid)` pair:
- Walk chunk chain starting at `headCid`
- For every link in chunk:
  - **Chain-ID filter**: Discard if `link.ChainId != requestedChainId`
  - **Time-window filter**: Keep only links with `SignedAt` in `[windowStart, windowEnd + 30s]`
  - **Canonicalisation & hash**: Compute canonical JSON (no signature) and Keccak-256 hash
  - **Signature verification**: Primary verifier → fallback to "bytes" variant if available
  - **Replay protection**: Maintain in-memory `HashSet<string>` per `(avatar, operator, signer)` tuple<br>Repeat nonce → discard later occurrence
- Append accepted link as `LinkWithProvenance` (includes avatar, chunk CID, index-in-chunk, original link, computed keccak)

#### 3. Order & Deduplicate (`OrderAndDeduplicate`)
Performed on whole list of verified links:
- Sort descending by `SignedAt`
- Ties: `IndexInChunk` (higher = newer) → avatar address lexical → keccak
- Walk sorted list; keep first occurrence of each unique keccak (duplicates dropped)

#### 4. Return
Struct `AggregationLinksOutcome` containing:
- Scanned avatars
- Index heads
- Ordered unique links
- Accumulated errors

### CatalogReducer - Market-Specific Validation

#### Payload Types & Constraints

| Payload Type | Required Fields / Constraints |
|--------------|-------------------------------|
| **SchemaOrgProduct** (`@type = "Product"`) | `sku`, `name`, at least one `image` (absolute URI or valid ImageObject)<br>Non-empty `offers` array<br>Each offer: `price` (decimal) AND `priceCurrency` (ISO-4217 uppercase 3-letter code)<br>`checkout` must be absolute URI (`https://...`)<br>Optional: `availability`, `inventoryLevel` (must obey schema.org types) |
| **Tombstone** (`@type = "Tombstone"`) | `sku` matching product SKU<br>Integer `at` (Unix seconds)<br>No other fields allowed |
| **SchemaOrgOffer** (nested) | `price`, `priceCurrency`, `checkout`<br>Optional: `availabilityFeed`, `inventoryFeed` (absolute URIs if present) |

#### Reduction Algorithm

1. Iterate over ordered links from `BasicAggregator`
2. For each link:
   - Load payload JSON from IPFS (`ipfs.CatStringAsync(link.Cid)`)
   - Parse into generic `JsonNode`
   - Validate according to table above
   - Violation → push error object with `"stage":"payload"` and include offending `cid`
   - Continue processing other links
3. **SKU handling**: Maintain dictionary `sku → AggregatedCatalogItem`
   - SKU not present → insert new entry (link, payload, timestamp)
   - SKU present → compare `SignedAt`, keep newer (catalog is newest-first)
4. **Tombstone handling**: When tombstone for existing SKU arrives, remove from dictionary **unless** later product entry with same SKU appears after tombstone's timestamp (product wins)
5. After processing all links, sort final `Products` list by `PublishedAt` descending (newest first)
6. Return together with any collected errors

### OperatorCatalogEndpoint - HTTP API

#### Query Parameters

| Parameter | Validation |
|-----------|------------|
| **avatars** (required) | Comma-separated lower-cased avatar addresses<br>Non-empty; each address validated as hex string length 42 (`0x...`) |
| **cursor** (optional) | Base64-encoded JSON `{ "start": int, "end": int }`<br>Both ≥ 0 and ≤ total items<br>`end - start` may not exceed server's `maxPageSize` (default 10,000)<br>Invalid base64 or malformed JSON → HTTP 400 with `"error":"Invalid cursor"` |
| **offset** (optional) | Integer offset into result set, ≥ 0<br>Defaults to 0 if omitted<br>Out-of-range offsets clamped to list length |
| **limit** (optional) | Maximum items to return, ≤ maxPageSize<br>Defaults to 10 if not supplied |
| **chainId** (required) | Numeric chain ID<br>Must match operator's on-chain configuration |

#### Response Format (JSON)

```json
{
  "products": [ /* array of AggregatedCatalogItem */ ],
  "errors": [ /* array of JsonElement objects describing failures */ ]
}
```

**No `Vary` header added** → responses are cache-friendly

#### Error Handling Flow

1. **Parameter validation**: Any malformed parameter triggers early `400 Bad Request` with single `"error"` field
2. **Aggregation errors**: Collected during namespace loading, signature verification, or payload validation<br>Returned in `"errors"` array but **do not** cause HTTP failure

Each error object includes:
- `avatar`
- `stage` (`registry`, `profile`, `index`, `chunk`, `verify`, `payload`)
- Optional `cid`
- Human-readable `message`

#### Pagination Logic (Pseudocode)

```text
total = number of products after reduction

if cursor not supplied:
    start = offset
    end = min(start + limit, total)
else:
    start = cursor.start
    end = min(cursor.end, total)

pageItems = products[start : end]
nextCursor = null if end == total 
             else base64({ "start": end, "end": min(end+limit, total) })

return { products: pageItems, errors, nextCursor? }
```

### Performance & Scaling

| Bottleneck | Mitigation |
|------------|------------|
| **IPFS reads** (many chunks per namespace) | Use `IpfsRpcApiStore` with HTTP keep-alive<br>Enable local pinning for hot avatars |
| **Signature verification** (ECDSA + ERC-1271) | Cache contract code lookups (`isContract`) in verifier (default cache size 512)<br>Reuse `Keccak256Bytes` results where possible |
| **Large result sets** (tens of thousands of products) | Enforce reasonable `maxPageSize`<br>Clients should paginate |
| **Chunk rotation overhead** | Chunk size 100 is sweet spot<br>Increasing reduces IPFS calls but makes each chunk larger to download<br>Adjust only after measuring real-world usage |

## JSON-LD Context URLs (Immutable)

| Context | URL |
|---------|-----|
| Profile | `https://aboutcircles.com/contexts/circles-profile/` |
| Namespace | `https://aboutcircles.com/contexts/circles-namespace/` |
| Linking | `https://aboutcircles.com/contexts/circles-linking/` |
| Chat | `https://aboutcircles.com/contexts/circles-chat/` |
| Market | `https://aboutcircles.com/contexts/circles-market/` |
| Market Aggregate | `https://aboutcircles.com/contexts/circles-market-aggregate/` |

**Critical**: These contexts are immutable; never change them in signatures.