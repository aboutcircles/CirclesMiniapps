# Autonomous MiniApp Builder — Agent Charter

> **Read this document in full before taking any action.** You are operating autonomously with no human in the loop. Follow each phase sequentially. Do not skip phases.

---

## Your Mission

Build a Circles MiniApp from scratch — brainstorm the idea yourself, implement it, deploy it, and open a pull request. Your output is a merged-ready PR on `aboutcircles/CirclesMiniapps`.

**Success criteria:**
- [ ] New miniapp directory exists under `examples/<slug>/`
- [ ] App loads in a browser and uses the wallet bridge
- [ ] Deployed to a public Vercel HTTPS URL
- [ ] Entry added to `static/miniapps.json`
- [ ] PR opened against `master` with deployment URL in description
- [ ] No secrets or API keys committed

**Time budget:** Aim to complete within a single session. Simple apps take 2–4 hours; complex ones 6–8 hours.

---

## Tool and Environment Requirements

Before starting, confirm you have:

```bash
# Required CLIs
node --version     # 18+
npm --version
vercel --version   # Install: npm i -g vercel
gh --version       # GitHub CLI — for opening PRs

# Check CLI auth — tokens are NOT required if already logged in
vercel whoami      # Must return a username. If not: run `vercel login`
gh auth status     # Must show "Logged in". If not: run `gh auth login`

# GH_REPO is auto-detected from the git remote — no need to set manually
```

If `vercel whoami` or `gh auth status` fail, stop and report. Do not proceed.

---

## Phase 0: Orientation (read first, ~15 min)

Read all of the following. Do not skip any.

```
.context/miniappDevelopmentGuide.md   ← critical, 37KB
.context/circles-docs/                ← Circles protocol reference docs (see table below — read on demand only)
static/miniapps.json                  ← existing apps (don't duplicate)
```

### Reference docs (`.context/circles-docs/`)

Read these **on demand only** — not during Phase 0 orientation. Each doc is substantial.

| File | When to read |
|---|---|
| `00-circles-sdk.md` | Using any Circles SDK method beyond the basic patterns in this file |
| `01-monetary-core.md` | Building apps involving balances, demurrage, minting, or economic calculations |
| `02-on-chain-contracts.md` | Interacting with Hub V2, groups, ERC-20 wrappers, or flow matrices directly |
| `03-economics.md` | Building analytics, dashboards, or educational apps about the CRC economy |
| `04-profile-sdk.md` | Building profile-based features, namespaces, or the aggregation/market pipeline |
| `05-rpc-api-reference.md` | Using RPC methods beyond the patterns in this file (full method reference) |
| `06-pathfinder-api-reference.md` | Building payment/transfer flows that need the REST pathfinder API directly |
| `07-circles-addresses.json` | Need contract addresses — all deployed addresses in one JSON file |
| `08-marketplace-api.md` | Building commerce miniapps (product catalogues, baskets, orders, fulfilment) |

## Context7

Fetch from Context7 if you need to write any Circles SDK-related code. Never rely on training data for SDK APIs.

| Resource | Context7 ID |
|---|---|
| Circles SDK v2 | `/aboutcircles/sdk` |
| Circles docs | `/aboutcircles/circles-docs` |
| Starter Kit | `/aboutcircles/circles-gnosisapp-starter-kit` |


<!-- ### Available skills (`.claude/skills/`) --- COMING SOON!

Two skills are available in the repo. Use them when the user or the task calls for them:

| Skill | When to use |
|---|---|
| `gnosis-wallet-brand-aligner` | When asked to rebrand, restyle, or align a miniapp's look with the Gnosis wallet UI. Provides full colour, typography, layout, and component pattern references. |
| `ui-pattern-extractor` | When asked to analyse an existing codebase and extract its design system into agent-consumable reference docs. Supports React/Next.js and Svelte/SvelteKit. |

The scaffold already applies Gnosis branding via correct CSS tokens (see Pattern I below), so you do **not** need to invoke the brand-aligner for standard builds. Use it only if the user explicitly asks for a branding pass or if you're working on an app that wasn't scaffolded with `new-miniapp.sh`. -->

By the end of Phase 0 you should understand:
- What Circles is and who uses miniapps
- The dual-SDK pattern (postMessage bridge + Circles SDK — see below)
- How the postMessage bridge works (`examples/miniapp-sdk.js`)
- What patterns exist in working miniapps you can reuse
- What's already been built (so you don't duplicate)
- The Gnosis visual language (see below)
<!-- - What skills are available and when to use them -->

### Design language — Gnosis wallet

MiniApps render inside the Gnosis wallet iframe and must feel native to it.
The scaffold (`scripts/new-miniapp.sh`) generates CSS with the correct tokens — **do not
override these with your own colours or fonts**.

Key visual rules:
- **Background**: Warm beige-to-sage gradient with subtle brand tints — never flat grey.
- **Text**: Deep navy (`--ink: #05061a`) for primary, muted navy (`--muted: #51526e`) for secondary.
- **Borders**: Warm beige tones (`--line: #eee7e2`), not cold greys.
- **Buttons**: Pill-shaped (`border-radius: 999px`) with a brand blue gradient (`#0e00a8 → #4335df`).
- **Cards**: Frosted glass (`backdrop-filter: blur(6px)`) with rounded corners (22px).
- **Accent**: Gnosis brand blue `#0e00a8`, not indigo or Tailwind blue.
- **Font**: Space Grotesk (loaded via Google Fonts). JetBrains Mono for code/addresses.

If you add new UI elements, use the existing CSS tokens from `style.css`. See **Pattern I** below for the full token table.

---

## Phase 1: Brainstorm and Select an Idea (~20 min)

### If `.context/miniapp-ideas.md` exists:
Read it. Pick the highest-rated unbuilt idea and skip to Phase 2.

### If it doesn't exist (or all ideas are built):
Generate your own ideas. Follow this process:

**Step 1 — Generate 5–10 ideas.** For each, think about:
- What Circles users would find genuinely useful
- What's possible with the existing SDK and RPC patterns (no new contracts preferred)
- What's NOT already in `static/miniapps.json`
- What novel use cases the CRC economic model enables

**Step 2 — Evaluate each idea against this rubric:**

| Criterion | Question |
|---|---|
| Feasibility | Can it be built without a new Solidity contract? |
| Novelty | Is it meaningfully different from existing apps? |
| User value | Would a Circles user open this regularly? |
| Complexity | Can it be implemented in < 1000 LOC of JS? |
| SDK fit | Does it use existing Circles SDK / viem patterns? |
| Host respect | Does it avoid replicating Gnosis App core features (minting, swaps, wallet management)? MiniApps must extend the ecosystem, not compete with the host. |

Rate each idea 1–5 on each criterion. Total score = sum.

**Step 3 — Save your brainstorm.** Write it to `.context/miniapp-ideas.md` using this format:

```markdown
# MiniApp Ideas
_Generated: <date>_

## [Idea Name]
**Score**: X/25
**Feasibility**: X/5
**Novelty**: X/5
**User value**: X/5
**Complexity**: X/5 (5 = simplest)
**SDK fit**: X/5
**New contracts needed**: Yes / No
**Description**: One paragraph explaining the app.
**Patterns used**: e.g. CRC payments, profile queries, trust graph reads
**Status**: Unbuilt

---
```

**Step 4 — Select the top-scoring unbuilt idea.** Commit to it. Write your reasoning in one paragraph at the top of `.context/miniapp-ideas.md`.

Mark the selected idea as `Status: In Progress`.

---

## Phase 2: Create a Spec (~20 min)

Create three files under `.context/specs/<slug>/`:

### `requirements.md`
```markdown
# <App Name> — Requirements

## User Story
As a Circles user, I want to <action> so that <benefit>.

## Functional Requirements
- FR1: ...
- FR2: ...

## Non-Functional Requirements
- NFR1: Must load inside an iframe
- NFR2: Must work with passkey-based Safe accounts
- NFR3: All values in hex for transaction data
- NFR4: All web3 addresses checksummed

## Out of Scope
- ...

## Acceptance Criteria
- [ ] Wallet connection shown on load
- [ ] Core feature works end-to-end
- [ ] Error states handled gracefully
```

### `design.md`
```markdown
# <App Name> — Design

## Architecture
Describe the app's structure: UI screens, data flow, SDK calls.

## File Structure
examples/<slug>/
├── index.html
├── main.js
├── style.css
├── miniapp-sdk.js
├── package.json
└── README.md

## Key SDK Calls
List the specific SDK methods and RPC queries you'll use.

## State Machine
Describe UI states (loading, connected, disconnected, error).

## Data Model
Any data structures stored or fetched.
```

### `tasks.md`
```markdown
# <App Name> — Tasks

## Phase 1: Scaffold
- [ ] Create directory structure
- [ ] Copy miniapp-sdk.js
- [ ] Set up package.json with deps
- [ ] Basic index.html shell

## Phase 2: Wallet Integration
- [ ] Import onWalletChange
- [ ] Handle connect / disconnect states
- [ ] Show address when connected

## Phase 3: Core Feature
- [ ] ...

## Phase 4: Polish
- [ ] Error handling
- [ ] Loading states
- [ ] Responsive layout

## Phase 5: Deploy
- [ ] Run deploy script
- [ ] Capture Vercel URL
- [ ] Register in miniapps.json
- [ ] Open PR
```

---

## Phase 3: Scaffold the MiniApp (~10 min)

```bash
./scripts/new-miniapp.sh <slug> "<Display Name>"
```

This creates `examples/<slug>/` with the correct structure. Then install deps:

```bash
cd examples/<slug>
npm install
```

---

## Phase 4: Implement (~2–6 hours)

Work through `tasks.md` in order. Check off each task as you complete it.

### The Dual-SDK Pattern (critical — read this)

MiniApps use **two separate tools** for two separate purposes:

| Tool | Purpose | Import |
|---|---|---|
| `miniapp-sdk.js` | Wallet operations (send txs, sign messages) | `import { onWalletChange, sendTransactions, signMessage } from './miniapp-sdk.js'` |
| `@aboutcircles/sdk` + `viem` | Read Circles state (profiles, trust, balances, avatars, RPC queries) | `import { Sdk } from '@aboutcircles/sdk'` |

**Do not try to use the postMessage bridge for reading data.** Import the Circles SDK directly for all read operations.

---

### Pattern A: Wallet connection

```javascript
import { onWalletChange, sendTransactions } from './miniapp-sdk.js';

let connectedAddress = null;

onWalletChange(async (address) => {
  if (!address) {
    connectedAddress = null;
    showDisconnectedUI();
    return;
  }
  connectedAddress = address; // already checksummed
  await initializeApp(address);
});
```

---

### Pattern B: RPC client (for reading chain state)

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

---

### Pattern C: Circles SDK for read operations (profiles, trust, balances)

```javascript
import { Sdk } from '@aboutcircles/sdk';

// SDK for reads — no runner needed
const sdk = new Sdk('https://rpc.aboutcircles.com/', null);

// Fetch a profile by address
const profile = await sdk.rpc.profile.getProfileByAddress(address);
const name = profile?.name || profile?.registeredName || 'Unknown';

// Search profiles by name or address
const results = await sdk.rpc.profile.searchByAddressOrName(query, 10, 0);

// Get trust relations
const relations = await sdk.data.getTrustRelations(address);

// Get avatar info
const avatarInfo = await sdk.data.getAvatarInfo(address);

// Get token balances (returns array of { address, attoCircles, ... })
const avatar = await sdk.getAvatar(address);
const balances = await avatar.balances.getTokenBalances();
const totalWei = balances.reduce((s, b) => s + BigInt(b.attoCircles ?? 0n), 0n);
```

---

### Pattern D: SDK for write operations (via runner bridge)

When you need the SDK to send transactions on behalf of the user:

```javascript
import { Sdk } from '@aboutcircles/sdk';
import { sendTransactions } from './miniapp-sdk.js';

function toHexValue(value) {
  return value ? `0x${BigInt(value).toString(16)}` : '0x0';
}

function formatTxForHost(tx) {
  return { to: tx.to, data: tx.data || '0x', value: toHexValue(tx.value || 0n) };
}

let lastTxHashes = [];

function createRunner(address) {
  return {
    address,
    async sendTransaction(txs) {
      const hashes = await sendTransactions(txs.map(formatTxForHost));
      lastTxHashes = hashes;
      return await waitForReceipts(hashes);
    },
  };
}

const sdk = new Sdk('https://rpc.aboutcircles.com/', createRunner(connectedAddress));
```

---

### Pattern E: CRC payments

CRC tokens exist in multiple representations. Which one you use depends on the use case:

| Representation | Token standard | Token ID / Address | When to use |
|---|---|---|---|
| **Personal CRC** (ERC1155) | Hub V2 ERC1155 | `uint256(avatarAddress)` | Tipping, social apps, direct peer transfers |
| **Group CRC** (ERC1155) | Hub V2 ERC1155 | `uint256(groupAddress)` | Rarely held directly — usually wrapped |
| **Wrapped group CRC** (ERC20) | Inflationary ERC20 wrapper | Wrapper contract address (e.g. `0xeef7...` for Gnosis group) | **Most common for payments** — this is what wallets actually hold |

#### How to determine which tokens a recipient accepts

Payment gateways and orgs accept tokens from addresses they **trust**. To find accepted tokens:

```javascript
// Query gateway trust relations
const trustedBy = await circlesQuery(
  'CrcV2_PaymentGateway', 'TrustUpdated',
  ['trustReceiver', 'expiry'],
  [{ column: 'gateway', value: gatewayAddress.toLowerCase() }]
);
// Each trustReceiver is a group or avatar whose tokens the gateway accepts
```

For group tokens, the wrapper address can be discovered via the Circles RPC:

```javascript
const balances = await sdk.rpc.balance.getTokenBalances(userAddress);
const groupWrapped = balances.filter(b =>
  b.isWrapped && b.tokenOwner.toLowerCase() === groupAddress.toLowerCase()
);
// groupWrapped[0].tokenAddress = the ERC20 wrapper contract
```

#### Pattern E1: Wrapped group CRC payment (most common)

Wallets hold group CRC as wrapped ERC20 tokens (symbol prefix `s-`). For payments to orgs, gateways, or any recipient that trusts a group, use a standard ERC20 `transfer`:

```javascript
import { encodeFunctionData } from 'viem';

const ERC20_TRANSFER_ABI = [{
  type: 'function',
  name: 'transfer',
  inputs: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}];

// wrapperAddress = the ERC20 wrapper for the group token (discover via getTokenBalances)
const data = encodeFunctionData({
  abi: ERC20_TRANSFER_ABI,
  functionName: 'transfer',
  args: [recipientAddress, amountWei],
});

const hashes = await sendTransactions([{
  to: wrapperAddress,
  data,
  value: '0x0',
}]);
```

#### Pattern E2: Personal CRC transfer (tipping, social)

For transferring your own personal CRC (e.g. tipping), use Hub V2 `safeTransferFrom` with `tokenId = uint256(senderAddress)`:

```javascript
const HUB_V2 = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';

const HUB_TRANSFER_ABI = [{
  type: 'function',
  name: 'safeTransferFrom',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'id', type: 'uint256' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
}];

const tokenId = BigInt(connectedAddress); // personal CRC = sender's address
const data = encodeFunctionData({
  abi: HUB_TRANSFER_ABI,
  functionName: 'safeTransferFrom',
  args: [connectedAddress, recipientAddress, tokenId, amountWei, '0x'],
});

const hashes = await sendTransactions([{ to: HUB_V2, data, value: '0x0' }]);
```

#### Pattern E3: Marketplace API payment (structured commerce)

For miniapps that sell products through the Circles marketplace (baskets, orders, fulfilment), use the **Marketplace API** (`aboutcircles/marketplace-api`) instead of direct on-chain transfers. The API handles basket validation, order creation, payment tracking via SSE, and multi-seller settlement.

**Base URL**: the marketplace API instance for the target deployment (check `.context/circles-docs/08-marketplace-api.md` for protocol documentation).

```
Flow: create basket → add items → preview → checkout → pay on-chain → SSE tracks fulfilment
```

```javascript
// 1. Checkout a basket — returns orderId + paymentReference
const checkoutRes = await fetch(`${MARKETPLACE_API}/api/cart/v1/baskets/${basketId}/checkout`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${jwt}` },
});
const { orderId, paymentReference } = await checkoutRes.json();

// 2. Pay on-chain using the paymentReference (Pattern E1 ERC20 transfer)
//    The recipient is the gateway/org address from the order

// 3. Track order status via SSE
const sse = new EventSource(`${MARKETPLACE_API}/api/cart/v1/orders/${orderId}/status`);
sse.addEventListener('order_status_update', (e) => {
  const { status } = JSON.parse(e.data);
  // status: OrderProcessing → OrderDelivered etc.
});
```

> **When to use E3 vs E1**: Use E3 when the miniapp integrates with the Circles marketplace catalogue (products, sellers, baskets). Use E1 for simple direct payments where the miniapp manages its own fulfilment (e.g. ticket grants, tips, donations).

See `.context/circles-docs/08-marketplace-api.md` for full endpoint reference on the Marketplace API.

#### Choosing the right pattern

| Scenario | Pattern | Token type |
|---|---|---|
| Pay for goods/services via gateway (simple) | E1 | Wrapped group CRC (ERC20) |
| Pay via Circles marketplace (catalogue/orders) | E3 | Wrapped group CRC via marketplace checkout |
| Pay an org that trusts a group | E1 | Wrapped group CRC (ERC20) |
| Tip another user | E2 | Personal CRC (ERC1155) |
| Social interactions (vouch, like) | E2 | Personal CRC (ERC1155) |
| Multi-group acceptance | E1 × N | Query trusted groups, let user choose |
| Multi-seller orders with fulfilment | E3 | Marketplace API handles routing |

> **Key insight**: For commercial payments, always check what the recipient trusts. A gateway/org may trust multiple groups — present the user with valid payment options based on their holdings and the recipient's trust list. For structured commerce with product catalogues and order management, prefer the Marketplace API (E3) which handles basket validation, multi-seller routing, and payment tracking.

---

### Pattern F: Receipt polling (multi-RPC with UserOp fallback)

```javascript
import { createPublicClient, http, parseAbiItem } from 'viem';
import { gnosis } from 'viem/chains';

const RPC_FALLBACK_URLS = [
  'https://rpc.aboutcircles.com/',
  'https://rpc.gnosischain.com',
  'https://1rpc.io/gnosis',
];

const POLL_MS = 3000;
const TIMEOUT_MS = 12 * 60 * 1000;
const ENTRYPOINT = '0x0000000071727de22e5e9d8baf0edac6f37da032';
const LOOKBACK = 5000n;

const receiptClients = RPC_FALLBACK_URLS.map(url =>
  createPublicClient({ chain: gnosis, transport: http(url) })
);

async function waitForReceipts(hashes) {
  return Promise.all(hashes.map(waitForReceiptFromAnyRpc));
}

async function waitForReceiptFromAnyRpc(hash) {
  const deadline = Date.now() + TIMEOUT_MS;
  let round = 0;
  while (Date.now() < deadline) {
    round++;
    for (const client of receiptClients) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        if (r) return r;
      } catch {}
    }
    if (round % 2 === 0) {
      for (const client of receiptClients) {
        const r = await tryResolveUserOp(client, hash);
        if (r) return r;
      }
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  throw new Error(`Timed out waiting for ${hash}`);
}

async function tryResolveUserOp(client, userOpHash) {
  try {
    const latest = await client.getBlockNumber();
    const fromBlock = latest > LOOKBACK ? latest - LOOKBACK : 0n;
    const logs = await client.getLogs({
      address: ENTRYPOINT,
      event: parseAbiItem(
        'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)'
      ),
      args: { userOpHash },
      fromBlock,
      toBlock: latest,
    });
    if (logs.length > 0) {
      return await client.getTransactionReceipt({ hash: logs.at(-1).transactionHash });
    }
  } catch {}
  return null;
}
```

---

### Pattern G: CirclesRPC queries (indexed on-chain events)

```javascript
// Query any indexed Circles event
async function circlesQuery(namespace, table, columns, filters = [], order = []) {
  const sdk = new Sdk('https://rpc.aboutcircles.com/', null);
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

// Example: find all CRC transfers to an address
const transfers = await circlesQuery(
  'CrcV2', 'Transfer',
  ['from', 'to', 'value', 'timestamp'],
  [{ column: 'to', value: address.toLowerCase() }],
  [{ Column: 'timestamp', SortOrder: 'DESC' }]
);

// Available namespaces:
// CrcV2                — trust, transfers, registrations
// CrcV2_PaymentGateway — GatewayCreated, TrustUpdated
// CrcV2_Groups         — group events
// CrcV2_Organizations  — organisation events
```

---

### Pattern H: UI shell (index.html)

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>App Name</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="app">
    <header class="app-header">
      <h1>App Name</h1>
      <div id="wallet-status" class="wallet-status">Not connected</div>
    </header>
    <main id="main-content">
      <div id="disconnected-view" class="view">
        <p>Connect your wallet to use this app.</p>
      </div>
      <div id="connected-view" class="view hidden">
        <!-- Main UI here -->
      </div>
    </main>
  </div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

---

### Pattern I: Design system CSS

The scaffold (`scripts/new-miniapp.sh`) generates the full CSS automatically.
The design system aligns with the **Gnosis wallet UI** — warm beige backgrounds, navy text,
deep blue accents. Fonts: **Space Grotesk** for
UI text, **JetBrains Mono** for addresses and code fields (both loaded via Google Fonts).

#### Colour palette (Gnosis)

| Role | Token | Hex | Palette |
|------|-------|-----|---------|
| Warm bg | `--bg-a` | `#faf5f1` | beige-10 |
| Cool bg | `--bg-b` | `#f6f7f9` | sage-10 |
| Primary text | `--ink` | `#05061a` | navy-970 |
| Secondary text | `--muted` | `#51526e` | navy-700 |
| Card surface | `--card` | `#ffffff` | white |
| Border | `--line` | `#eee7e2` | beige-100 |
| Border subtle | `--line-soft` | `#f4eee9` | beige-50 |
| Brand accent | `--accent` | `#0e00a8` | blue-700 |
| Interactive | `--accent-mid` | `#4335df` | blue-500 |
| Accent bg | `--accent-soft` | `#eae8ff` | blue-50 |
| Success | `--success-bg/ink` | `#dcfce7` / `#145324` | green-100/900 |
| Warning | `--warn-bg/ink` | `#feebc7` / `#8a482c` | amber-100/900 |
| Error | `--error-bg/ink` | `#fee2e2` / `#7f1d1d` | red-100/900 |

#### Key CSS patterns

```css
/* Background — warm gradient with subtle brand tints, never flat */
body {
  font-family: "Space Grotesk", -apple-system, ui-sans-serif, system-ui, "Segoe UI", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1200px 500px at 0% 0%, rgba(14,0,168,0.03) 0%, transparent 65%),
    radial-gradient(900px 500px at 100% 20%, rgba(255,125,62,0.05) 0%, transparent 70%),
    linear-gradient(145deg, var(--bg-a), var(--bg-b));
}

/* Card — frosted glass, rounded */
.card {
  background: rgba(255,255,255,0.92);
  backdrop-filter: blur(6px);
  border: 1px solid var(--line);
  border-radius: 22px;
  padding: 22px;
  box-shadow: 0 8px 30px rgba(5,6,26,0.08), inset 0 1px 0 #fff;
}

/* Button — pill with brand blue gradient */
button {
  border-radius: 999px;
  background: linear-gradient(130deg, var(--accent), var(--accent-mid));
  color: #fff;
  font-weight: 600;
  border: 0;
}

/* Secondary button — white with beige border */
.btn-secondary {
  background: #fff;
  border: 1px solid var(--line);
  color: var(--ink);
}
```

Do not use flat grey backgrounds (`#f8f9fa`), indigo buttons (`#6366f1`), or any blue
outside the Gnosis palette. The full CSS is in the scaffolded `style.css`; extend it rather
than overriding the tokens.

---

### Pattern J: package.json

```json
{
  "name": "<slug>",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@aboutcircles/sdk": "^0.1.24",
    "@aboutcircles/sdk-utils": "^0.1.24",
    "@safe-global/safe-deployments": "^1.37.22",
    "viem": "^2.46.3"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "vite-plugin-node-polyfills": "^0.25.0"
  }
}
```

### Pattern K: vite.config.js

```javascript
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  plugins: [
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events'],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  optimizeDeps: {
    esbuildOptions: { define: { global: 'globalThis' } },
  },
});
```

---

### Pattern L: toasts

```javascript
function showToast(message, type = 'info', durationMs = 4000) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), durationMs);
}

// Usage:
// showToast('Transaction sent!', 'success');
// showToast('Wallet not connected', 'error');
```

---

### Pattern M: error decoding + passkey failure handling

Always use `decodeError` before showing error messages — raw viem errors are unreadable.
The passkey auto-connect error needs a **specific** recovery message, not a generic one.

```javascript
function decodeError(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.shortMessage) return err.shortMessage;
  if (err.message) return err.message;
  return String(err);
}

function isPasskeyAutoConnectError(err) {
  const msg = decodeError(err).toLowerCase();
  return (
    msg.includes('passkey') ||
    msg.includes('auto connect') ||
    (msg.includes('wallet address') && msg.includes('retrieve'))
  );
}

// Usage — always wrap SDK/tx calls in this pattern:
try {
  await someOperation();
} catch (err) {
  if (isPasskeyAutoConnectError(err)) {
    showToast(
      'Passkey auto-connect failed. Re-open wallet connect and choose your wallet again.',
      'error'
    );
  } else {
    showToast(`Operation failed: ${decodeError(err)}`, 'error');
  }
}
```

---

### Pattern N: isMiniappMode — detect standalone vs host

Use this to provide fallback behaviour when running the miniapp outside the host (e.g. during dev):

```javascript
import { isMiniappMode } from './miniapp-sdk.js';

if (!isMiniappMode()) {
  // Running standalone — show a dev-mode banner or mock wallet
  console.warn('Not running inside the Circles MiniApp host.');
  document.body.insertAdjacentHTML(
    'afterbegin',
    '<div style="background:#fff9ea;padding:8px 16px;font-size:12px;text-align:center">' +
    '⚠ Running in standalone mode — wallet operations will not work. ' +
    'Load via https://circles.gnosis.io/miniapps to test fully.</div>'
  );
}
```

---

### Pattern O: Safe deployments (for Safe/org operations)

```javascript
import {
  getSafeSingletonDeployment,
  getProxyFactoryDeployment,
  getCompatibilityFallbackHandlerDeployment,
} from '@safe-global/safe-deployments';

const SAFE_VERSION = '1.4.1';
const CHAIN_ID_STR = '100';

const safeSingletonDeployment   = getSafeSingletonDeployment({ network: CHAIN_ID_STR, version: SAFE_VERSION });
const proxyFactoryDeployment    = getProxyFactoryDeployment({ network: CHAIN_ID_STR, version: SAFE_VERSION });
const fallbackHandlerDeployment = getCompatibilityFallbackHandlerDeployment({ network: CHAIN_ID_STR, version: SAFE_VERSION });

function getDeploymentAddress(deployment) {
  if (!deployment) throw new Error('Safe deployment metadata not found.');
  const addr = deployment.networkAddresses?.[CHAIN_ID_STR] || deployment.defaultAddress;
  if (!addr) throw new Error('Safe deployment address not found for Gnosis Chain.');
  return getAddress(addr);
}

const safeSingletonAddress    = getDeploymentAddress(safeSingletonDeployment);
const proxyFactoryAddress     = getDeploymentAddress(proxyFactoryDeployment);
const fallbackHandlerAddress  = getDeploymentAddress(fallbackHandlerDeployment);
const safeAbi                 = safeSingletonDeployment.abi;
const proxyFactoryAbi         = proxyFactoryDeployment.abi;
```

---

### Critical contract addresses (Gnosis Chain — never hardcode elsewhere)

```javascript
// Chain
const CHAIN_ID             = 100;
const RPC_URL              = 'https://rpc.aboutcircles.com/';

// Circles protocol
const HUB_V2_ADDRESS       = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';
const GATEWAY_FACTORY_ADDRESS = '0x186725D8fe10a573DC73144F7a317fCae5314F19';

// ERC-4337
const ENTRYPOINT_V07_ADDRESS = '0x0000000071727de22e5e9d8baf0edac6f37da032';

// Safe — prefer importing via @safe-global/safe-deployments (Pattern O above)
// These are provided as a fallback reference only
const SAFE_VERSION         = '1.4.1';
const SAFE_SINGLETON       = '0xd9Db270c1B5E3Bd161E8c8503c55cEFFFaC1A644';
const SAFE_PROXY_FACTORY   = '0xa6B71E26C5e0845f74c812102Ca7114b6a896AB2';
const SAFE_FALLBACK_HANDLER = '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4';
const SAFE_SENTINEL_OWNERS = '0x0000000000000000000000000000000000000001';
const SAFE_TX_SERVICE_URL  = 'https://safe-transaction-gnosis-chain.safe.global';
```

---

## Phase 4b: Debug Checklist (before deploy)

Before deploying, verify these core SDK patterns work. Add temporary `console.log` calls to `main.js` to validate each one, then remove them before final commit.

### 1. Wallet Connection
```javascript
onWalletChange(async (address) => {
  if (!address) { console.log('[DEBUG] Wallet disconnected'); return; }
  console.log('[DEBUG] Connected address:', address);
  console.log('[DEBUG] Is checksummed:', address === getAddress(address));
});
```
**Expected**: Valid checksummed address (42 chars, `0x` prefix).

### 2. Profile Lookup
```javascript
const sdk = new Sdk('https://rpc.aboutcircles.com/', null);
const profile = await sdk.rpc.profile.getProfileByAddress(connectedAddress);
console.log('[DEBUG] Profile:', profile);
```
**Expected**: Object with `name` or `registeredName`. If null, address has no Circles avatar.

### 3. Avatar Info
```javascript
const avatar = await sdk.getAvatar(connectedAddress);
console.log('[DEBUG] Avatar:', avatar);
```
**Expected**: Object with `safeAddress`. If null, address is not a registered Circles avatar — show a clear error to the user, do not crash.

### 4. Token Balances
```javascript
const avatar = await sdk.getAvatar(connectedAddress);
if (!avatar) { console.error('[DEBUG] No avatar — user not registered'); return; }
const balances = await avatar.balances.getTokenBalances();
console.log('[DEBUG] Balances:', balances);
balances.forEach(b => console.log(`  ${b.token?.symbol}: ${b.attoCircles}`));
```
**Expected**: Array of balance objects. Empty array = avatar has no holdings yet (valid state).

### 5. Trust Relations
```javascript
const relations = await sdk.data.getTrustRelations(connectedAddress);
console.log('[DEBUG] Trust relations count:', relations.length);
```
**Expected**: Array. Empty = user hasn't trusted anyone yet (valid state).

### 6. CirclesRPC Query (if used)
```javascript
const result = await sdk.circlesRpc.call('circles_query', [{
  Namespace: 'CrcV2', Table: 'Transfer',
  Columns: ['from', 'to', 'value', 'timestamp'],
  Filter: [{ Type: 'FilterPredicate', FilterType: 'Equals', Column: 'to', Value: connectedAddress.toLowerCase() }],
  Order: [{ Column: 'timestamp', SortOrder: 'DESC' }],
}]);
console.log('[DEBUG] Query rows:', result?.result?.rows?.length);
```
**Expected**: Row count ≥ 0. Empty = no matching events yet (valid).

### Common Failures

| Symptom | Cause | Fix |
|---------|-------|-----|
| `getAvatar()` returns null | User not registered as Circles avatar | Show message: "No Circles avatar found for this wallet" |
| Balances returns `[]` | Avatar has no holdings | Show "No balance yet" — do not show error |
| Profile returns null | Avatar not found in profile service | Fall back to short address display |
| TX throws passkey error | Passkey auto-connect failed | Show: "Re-open wallet connect and choose your wallet again" |
| Any SDK call throws | Wrong address format or RPC down | Check address is checksummed; try fallback RPC |

### Testing Without a Wallet

SDK **read** operations (profile, avatar, balances, trust, CirclesRPC) can be tested locally by passing any known Circles avatar address directly — no wallet needed:

```javascript
// Temporarily hardcode a known avatar address for local read testing
const TEST_ADDRESS = '0xYourOwnCirclesAddress';
await testAvatarFetch(TEST_ADDRESS);
```

Transaction sending requires the host iframe — cannot be tested locally.

---

## Phase 4c: Live Browser Debug (if Chrome DevTools available)

If you have browser automation tools (e.g. Chrome MCP), use them to debug the deployed miniapp without human involvement.

### Step 1 — Load the miniapp in the host
```
Navigate to: https://circles.gnosis.io/miniapps
Load your miniapp via the "Advanced" tab using its Vercel URL
```

### Step 2 — Read the console
Use `read_console_messages` or `javascript_tool` to capture output. Look for:
- `[DEBUG]` logs added in Phase 4b
- Uncaught errors or promise rejections
- Network failures (CORS, 401, 404 on RPC calls)
- `isMiniappMode()` returning false (bridge not initialised)

### Step 3 — Check network requests
Use `read_network_requests` filtered to `rpc.aboutcircles.com`. All RPC calls should return 200. A 4xx/5xx is the most common cause of empty balances or null avatars.

### Step 4 — Fix, rebuild, redeploy, re-test
```bash
# Fix the bug, then:
cd examples/<slug> && npm run build && cd ../..
./scripts/deploy-miniapp.sh examples/<slug>
# Navigate to the new URL and repeat Steps 2–3
```

Repeat until the console is clean and the app behaves correctly.

### Step 5 — Remove debug logs
Search for `[DEBUG]` in `main.js` and remove all temporary logs before the PR commit.

---

## Phase 5: Deploy (~10 min)

```bash
cd /path/to/repo/root

# Build the miniapp
cd examples/<slug>
npm run build
cd ../..

# Deploy to Vercel
./scripts/deploy-miniapp.sh examples/<slug>
```

The script prints the deployment URL. Save it — you need it for Phase 6.

If the script fails, check:
- `VERCEL_TOKEN` is set
- The miniapp builds cleanly (`npm run build` in the examples dir)
- `vercel.json` exists in the miniapp dir (script creates a basic one if not)

⚠️ **After deploying, you must disable Vercel Deployment Protection** on the project, or the miniapp will return a 401 when loaded inside the iframe and appear completely blank. Do this immediately after the first successful deployment:

```bash
# Via Vercel dashboard:
# Project Settings → Deployment Protection → set to "Disabled"

# Or via Vercel CLI:
vercel project update circles-miniapp-<slug> --protection none
```

This is a one-time step per project. Without it, the miniapp URL is valid but the iframe blocks it silently.

---

## Phase 6: Register the App (~5 min)

Add an entry to `static/miniapps.json`:

```json
{
  "slug": "<slug>",
  "name": "<Display Name>",
  "logo": "https://cdn.prod.website-files.com/6810a659196f7f9bd5d23846/6810d11cb36563358376b4da_logo-color.svg",
  "url": "<vercel-deployment-url>",
  "description": "<One or two sentences describing what the app does.>",
  "tags": ["<tag1>", "<tag2>"]
}
```

Use the Circles logo URL above as a placeholder if you don't have a specific logo.

---

## Phase 7: Open the PR (~5 min)

```bash
./scripts/open-pr.sh <slug> "<Display Name>" "<one-line description>"
```

The script:
1. Creates a branch `claude/miniapp-<slug>`
2. Commits all changes
3. Pushes to origin
4. Opens a draft PR against `master` on `aboutcircles/CirclesMiniapps`

If GitHub Actions is configured, a Vercel preview will deploy automatically and the URL will be posted as a PR comment.

---

## Definition of Done

Before marking the task complete, verify every item:

- [ ] `examples/<slug>/` directory exists with all required files
- [ ] `npm run build` succeeds with no errors in `examples/<slug>/`
- [ ] Wallet connection works: `onWalletChange` fires and address displays
- [ ] Core feature works end-to-end (you have verified this manually or via script)
- [ ] Error states handled: disconnected wallet, failed transactions, network errors
- [ ] Deployed to HTTPS Vercel URL (not localhost)
- [ ] Entry added to `static/miniapps.json` with valid HTTPS url
- [ ] No secrets, API keys, or credentials in any committed file
- [ ] PR opened against `master` with deployment URL in description

---

## If You Get Stuck

1. **SDK method not working** → Fetch from Context7: `/aboutcircles/sdk`. Do not guess.
2. **Transaction failing** → Check hex encoding; ensure values are `0x`-prefixed strings.
3. **Receipt not returning** → Use the multi-RPC polling pattern (Pattern F above).
4. **Profile not loading** → Try `sdk.rpc.profile.getProfileByAddress(address)` first; fall back to `sdk.rpc.profile.searchByAddressOrName(address, 1, 0)`.
5. **Vercel deploy failing** → Check `VERCEL_TOKEN`; confirm `npm run build` works locally first.
6. **Can't open PR** → Check `GITHUB_TOKEN` permissions; confirm `gh auth status`.
7. **Miniapp appears blank in the iframe** → Deployment Protection is enabled. Go to Vercel Project Settings → Deployment Protection → Disabled. This is the most common post-deploy failure.
8. **Passkey auto-connect error on wallet change** → Use `isPasskeyAutoConnectError()` (Pattern M) and show a specific message — do not show the raw error.
9. **Safe operation fails silently** → Always call `assertSafeExecutionSuccess()` after Safe transactions and check for `ExecutionFailure` event in the receipt logs.

---

## What NOT to Do

- Do not ask a human for help or clarification
- Do not skip the brainstorm phase and copy an existing app verbatim
- Do not use `http://` URLs — all miniapp URLs must be HTTPS
- Do not hardcode wallet addresses as user addresses
- Do not commit `.env` files, private keys, or API tokens
- Do not build a miniapp that requires a new Solidity contract unless you can deploy it via Foundry with existing scripts
- Do not duplicate an app already in `static/miniapps.json`
- Do not replicate core Gnosis App features — especially minting, token swaps, or any flow that competes with Gnosis App's fee-generating operations. MiniApps extend the ecosystem; they do not replace the host wallet's core functionality
- Do not leave Vercel Deployment Protection enabled — the miniapp will silently 401 inside the iframe
- Do not show raw viem error objects to the user — always use `decodeError()` (Pattern M)
- Do not use `avatar.trust.add()` for gateway trust — call `gateway.setTrust()` directly via Safe runner
- Do not assume a transaction succeeded without checking the receipt — always poll and verify
