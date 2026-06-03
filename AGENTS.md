# AGENTS.md

Project context for AI coding agents working on Circles MiniApps. Reference material lives in `.agents/docs/` and is loaded on demand.

## Overview

This repo (`aboutcircles/CirclesMiniapps`) hosts MiniApps - small focused web apps that run inside the Gnosis wallet iframe and extend the Circles ecosystem (tipping, social, analytics, commerce). They communicate with the host wallet via a postMessage bridge for transactions and signing, and read Circles state directly via the Circles SDK.

## Stack

- **Network**: Gnosis Chain only (chain ID `100`)
- **Languages**: JavaScript, HTML, CSS (no TypeScript by convention)
- **Build / deploy**: standalone Vite app per `examples/<slug>/`, deployed to Vercel (public HTTPS); or in-repo SvelteKit route for marketplace submission - see "Standalone vs embedded miniapps" below
- **PR target**: `master` on `aboutcircles/CirclesMiniapps`

## Architecture: the dual-SDK pattern

MiniApps use two distinct packages for two distinct purposes. Mixing them up is the most common source of bugs:

| Package | Purpose | Key exports |
|---|---|---|
| `@aboutcircles/miniapp-sdk` | Wallet operations via postMessage bridge | `onWalletChange`, `sendTransactions`, `signMessage`, `isMiniappMode`, `onAppData` |
| `@aboutcircles/sdk` | High-level avatar workflows (umbrella package) | `Sdk`, `HumanAvatar` |
| `@aboutcircles/sdk-rpc` | Read-only data queries | `CirclesRpc`, `Observable` |
| `@aboutcircles/sdk-core` | Raw contract calls (returns `{ to, data, value }` tx objects) | `Core`, `BaseGroupContract` |
| `@aboutcircles/sdk-profiles` | IPFS-based profile create/read/search | `Profiles`, `Profile` |
| `@aboutcircles/sdk-transfers` | Transfer construction (pathfinding, wrapped tokens, flow matrices) | `TransferBuilder` |
| `@aboutcircles/sdk-pathfinder` | Converts pathfinder results into flow matrix params | `createFlowMatrix` |
| `@aboutcircles/sdk-utils` | Shared utilities, config, conversion helpers | `circlesConfig`, `CirclesConverter` |
| `@aboutcircles/sdk-runner` | Safe multisig transaction execution | `SafeContractRunner`, `SafeBatchRun` |
| `viem` | Underlying EVM client (not `ethers`) | `createClient`, `getAddress`, `formatUnits` |

**Never use the bridge for reads.** Import `@aboutcircles/sdk-rpc` (or the umbrella `@aboutcircles/sdk`) and use it directly for all read operations.

**For embedded miniapps, writes go through the host bridge (`sendTransactions`) - do not use `SafeBrowserRunner`/`@aboutcircles/sdk-runner`; that is for standalone Safe-connected apps.**

## Standalone vs embedded miniapps

Two delivery models exist. Pick based on whether the app needs to be listed in the public Mini Apps Store.

**Standalone (primary local workflow).** Self-contained Vite app at `examples/<slug>/`, deployed to an external HTTPS host (Vercel), registered in `static/miniapps.json` with an external `url`. This is what the `/scaffold`, `/deploy`, `/open-pr` commands automate and what every current `static/miniapps.json` entry uses. Standalone apps are not required to be submitted and can be deployed independently.

Conventional layout:

```
examples/<slug>/
├── index.html         ← UI shell
├── main.js            ← entry point, wallet integration
├── style.css          ← Gnosis design tokens (do not override)
├── package.json
├── vite.config.js
├── vercel.json
└── README.md
```

**Embedded submission (canonical for marketplace listing).** The official contribution path requires the full app to ship from this repo as an in-repo SvelteKit route, not an external URL:

- App route: `src/routes/apps/<slug>/+page.svelte` (+ supporting files alongside)
- Host wrapper: `src/routes/miniapps/[slug]/+page.svelte` loads the entry by slug and iframes its `url`
- `static/miniapps.json` entry: `"url": "/apps/<slug>"` (internal route, **not** external `https://...`)
- Logo committed at `static/app-logos/<slug>.png`; other assets under `static/apps/<slug>/`
- Verify before PR: `npm install && npm run check && npm run build`
- PR title: `feat: add <app-name> embedded miniapp`

Existing in-repo precedent: `src/routes/pilots/{kudos,kudos-ga,self-onboarding}/`. PRs that only add an external URL to `static/miniapps.json` are rejected by upstream maintainers for marketplace submission. (Note: the root repo is SvelteKit/TypeScript; the no-TypeScript convention above applies to the standalone `examples/` apps.)

## Slash commands

Custom commands defined in `.claude/commands/`. Each is a markdown file with full step-by-step instructions, so they work in any tool that reads slash commands from that directory.

| Command | Purpose |
|---|---|
| `/scaffold <slug> "<name>"` | Create a new standalone miniapp directory under `examples/<slug>/` with all template files |
| `/deploy <slug>` | Build, deploy to Vercel, disable Deployment Protection |
| `/open-pr <slug> "<name>" "<description>" "<vercel-url>"` | Commit, push, open a draft PR |

## Critical contract addresses

Hardcoded references for Gnosis Chain. Use these directly, do not look them up.

```
Hub V2:                0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8
Gateway Factory:       0x186725D8fe10a573DC73144F7a317fCae5314F19
ERC-4337 EntryPoint:   0x0000000071727de22e5e9d8baf0edac6f37da032
Default RPC:           https://rpc.aboutcircles.com/
```

For Safe contracts (singleton, proxy factory, fallback handler), prefer importing via `@safe-global/safe-deployments` rather than hardcoding.

## Project constraints

- **MiniApps extend the host, they don't compete with it.** Never replicate Gnosis App's core fee-generating flows (minting, token swaps, wallet management). Apps that do this will be rejected.
- **Prefer no new Solidity contracts.** If a contract is unavoidable, deploy via Foundry with existing scripts.
- **Never duplicate an app already in `static/miniapps.json`.**
- **Vercel Deployment Protection must be disabled** on each deployment, or the app silently 401s inside the wallet iframe. The most common post-deploy failure.
- **MiniApps must feel native to the Gnosis wallet.** Use the existing design tokens from `style.css`. Never introduce flat greys, indigo buttons, or fonts outside Space Grotesk / JetBrains Mono. Full system in `@.agents/docs/design.md`.

## Conventions

- **Hex everywhere**: all transaction `value` and `data` fields are `0x`-prefixed hex strings. Convert BigInts via `` `0x${value.toString(16)}` `` or use `toHexValue()` helpers.
- **Checksummed addresses**: use `viem`'s `getAddress()` for any address you display, store, or compare.
- **HTTPS only**: no `http://` URLs anywhere - in code, configs, or `static/miniapps.json` entries.
- **No secrets in commits**: env vars only. Never commit `.env`, private keys, API tokens.
- **Lazy SDK construction**: never `new Sdk(...)` at module scope - wrap in a `getSdk()` lazy function. Module-scope construction can fail silently and produce a blank white screen with no console errors.
- **Token amounts are `BigInt` in atto-CRC** (10^18 per CRC). Use `CirclesConverter` from `@aboutcircles/sdk-utils` or `formatUnits`/`parseUnits` from `viem` for display/entry conversions. Never treat token amounts as floats.

## Circles protocol reference

Load on demand from `.agents/circles-docs/`:

- `00-circles-sdk.md` - SDK methods beyond the basic patterns
- `01-monetary-core.md` - balances, demurrage, minting, economic calculations
- `02-on-chain-contracts.md` - Hub V2, groups, ERC-20 wrappers, flow matrices
- `03-economics.md` - analytics, dashboards, the CRC economy model
- `04-profile-sdk.md` - profile features, namespaces, aggregation
- `05-rpc-api-reference.md` - full RPC method reference
- `06-pathfinder-api-reference.md` - REST pathfinder API
- `07-circles-addresses.json` - all deployed addresses
- `08-marketplace-api.md` - commerce miniapps (catalogues, baskets, orders)

## External SDK references (Context7)

Fetch from Context7 when writing Circles SDK code, rather than relying on training data. There are exactly two official libraries:

- `/aboutcircles/sdk` - Circles SDK v2 per-package API reference (`Sdk`, `HumanAvatar`, `CirclesRpc`, `Core`, `SafeContractRunner`/`SafeBrowserRunner`, `Pathfinder`, `Profiles`)
- `/aboutcircles/circles-docs` - protocol concepts, getting-started guides, RPC endpoints, REST APIs

Conventions enforced by the official docs:

- **Never use the deprecated `@circles-sdk/*` packages.** Always `@aboutcircles/*` + `viem` (not `ethers`).
- Default to `circlesConfig[100]` from `@aboutcircles/sdk-utils` for all Gnosis Chain config. (Note: also re-exported by `sdk-core`, but `sdk-utils` is the canonical source.)
- Token amounts are `BigInt` in atto-CRC (10^18 per CRC).

**Live docs query endpoint.** Any official docs page can be queried in natural language by an agent without an editor/MCP:

```
GET https://docs.aboutcircles.com/<page>.md?ask=<question>
```

Returns a structured answer plus source excerpts. Use it for on-demand lookups that Context7 doesn't cover (e.g. `https://docs.aboutcircles.com/miniapps/embedded-mini-apps.md?ask=...`).

## References

- **Code patterns**: `@.agents/docs/` - flat files loaded on demand:
  - `wallet.md` - wallet connection, lifecycle, signing, `onAppData`, bridge isolation
  - `reads.md` - profiles, balances, trust, indexed events (read-only)
  - `transactions.md` - host-bridge tx submission, receipt polling
  - `payments.md` - CRC payment patterns (wrapped ERC20, personal CRC, marketplace)
  - `advanced-transfers.md` - transitive/pathfinder transfers, backend-trusted intent/receipt pattern
  - `ui-shell.md` - HTML shell, `package.json`, Vite/Vercel config
  - `design.md` - Gnosis wallet design system
- **Intermediate / backend pattern**: official guide + reference repo `github.com/aboutcircles/intermediate-miniapp-tutorial`; the Org Manager miniapp (`https://circles.gnosis.io/admin/miniapps-org-manager`) sets up a Circles Org for backend CRC payment processing
- **Active feature work**: `.agents/plans/`
