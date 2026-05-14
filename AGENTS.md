# AGENTS.md

Project context for AI coding agents working on Circles MiniApps. Reference material lives in `.agents/docs/` and is loaded on demand.

## Overview

This repo (`aboutcircles/CirclesMiniapps`) hosts MiniApps - small focused web apps that run inside the Gnosis wallet iframe and extend the Circles ecosystem (tipping, social, analytics, commerce). They communicate with the host wallet via a postMessage bridge for transactions and signing, and read Circles state directly via the Circles SDK.

## Stack

- **Network**: Gnosis Chain only (chain ID `100`)
- **Languages**: JavaScript, HTML, CSS (no TypeScript by convention)
- **Build**: Vite per app
- **Deploy**: Vercel, public HTTPS only
- **PR target**: `master` on `aboutcircles/CirclesMiniapps`

## Architecture: the dual-SDK pattern

MiniApps use two distinct packages for two distinct purposes. Mixing them up is the most common source of bugs:

| Package | Purpose | Examples |
|---|---|---|
| `@aboutcircles/miniapp-sdk` | Wallet operations via postMessage bridge | `onWalletChange`, `sendTransactions`, `signMessage`, `isMiniappMode` |
| `@aboutcircles/sdk` + `viem` | Reading Circles state directly | profiles, trust, balances, avatars, RPC queries |

**Never use the bridge for reads.** Import `@aboutcircles/sdk` and use it directly for all read operations.

## MiniApp file structure

Each app lives at `examples/<slug>/` with this conventional layout:

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

## Slash commands

Custom commands defined in `.claude/commands/`. Each is a markdown file with full step-by-step instructions, so they work in any tool that reads slash commands from that directory.

| Command | Purpose |
|---|---|
| `/build-miniapp` | Full autonomous build workflow (brainstorm → spec → build → deploy → PR) |
| `/scaffold <slug> "<name>"` | Create a new miniapp directory with all template files |
| `/deploy <slug>` | Build, deploy to Vercel, disable Deployment Protection |
| `/open-pr <slug> ...` | Commit, push, open a draft PR |

## Critical contract addresses

Hardcoded references for Gnosis Chain. Use these directly, do not look them up.

```
Hub V2:                0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8
Gateway Factory:       0x186725D8fe10a573DC73144F7a317fCae5314F19
ERC-4337 EntryPoint:   0x0000000071727de22e5e9d8baf0edac6f37da032
Default RPC:           https://rpc.aboutcircles.com/
```

For Safe contracts (singleton, proxy factory, fallback handler), prefer importing via `@safe-global/safe-deployments` rather than hardcoding. See `@.agents/docs/patterns/utilities.md`.

## Project constraints

- **MiniApps extend the host, they don't compete with it.** Never replicate Gnosis App's core fee-generating flows (minting, token swaps, wallet management). Apps that do this will be rejected.
- **Prefer no new Solidity contracts.** If a contract is unavoidable, deploy via Foundry with existing scripts.
- **Never duplicate an app already in `static/miniapps.json`.**
- **Vercel Deployment Protection must be disabled** on each deployment, or the app silently 401s inside the wallet iframe. The most common post-deploy failure.
- **MiniApps must feel native to the Gnosis wallet.** Use the existing design tokens from `style.css`. Never introduce flat greys, indigo buttons, or fonts outside Space Grotesk / JetBrains Mono. Full system in `@.agents/docs/patterns/design-system.md`.

## Conventions

- **Hex everywhere**: all transaction `value` and `data` fields are `0x`-prefixed hex strings. Convert BigInts via `` `0x${value.toString(16)}` `` or use `toHexValue()` helpers.
- **Checksummed addresses**: use `viem`'s `getAddress()` for any address you display, store, or compare.
- **HTTPS only**: no `http://` URLs anywhere - in code, configs, or `static/miniapps.json` entries.
- **No secrets in commits**: env vars only. Never commit `.env`, private keys, API tokens.
- **Lazy SDK construction**: never `new Sdk(...)` at module scope - wrap in a `getSdk()` lazy function. Module-scope construction can fail silently and produce a blank white screen with no console errors.

## Circles protocol reference

Load on demand from `.agents/docs/circles-protocol/`:

- `circles-sdk.md` - SDK methods beyond the basic patterns
- `monetary-core.md` - balances, demurrage, minting, economic calculations
- `on-chain-contracts.md` - Hub V2, groups, ERC-20 wrappers, flow matrices
- `economics.md` - analytics, dashboards, the CRC economy model
- `profile-sdk.md` - profile features, namespaces, aggregation
- `rpc-api-reference.md` - full RPC method reference
- `pathfinder-api-reference.md` - REST pathfinder API
- `circles-addresses.json` - all deployed addresses
- `marketplace-api.md` - commerce miniapps (catalogues, baskets, orders)

## External SDK references (Context7)

Fetch from Context7 when writing Circles SDK code, rather than relying on training data:

- `/aboutcircles/sdk` - Circles SDK v2
- `/aboutcircles/circles-docs` - Circles documentation
- `/aboutcircles/circles-gnosisapp-starter-kit` - starter kit reference

## References

- **Code patterns**: `@.agents/docs/patterns/` - wallet, RPC, transactions, payments, UI shell, design system, utilities
<!-- - **Pre-deploy debug checklist**: `@.agents/docs/debug-checklist.md`
- **Live browser debug workflow**: `@.agents/docs/browser-debug.md`
- **Troubleshooting**: `@.agents/docs/troubleshooting.md` -->
- **Active feature work**: `.agents/plans/`
