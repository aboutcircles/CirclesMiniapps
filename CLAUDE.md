# Circles MiniApps — Claude Code Instructions

## Session Start

Read `.context/miniappDevelopmentGuide.md` — it is the complete technical reference for building miniapps.

## Autonomous Build Mode

If your task is to **build a miniapp autonomously**, follow `AGENT.md` at the repo root. That document is the complete workflow — do not improvise the process.

## Key Conventions

- **Network**: Gnosis Chain only (chain ID 100)
- **Miniapp structure**: `index.html` + `main.js` + `style.css` + `miniapp-sdk.js`
- **Wallet bridge**: `examples/miniapp-sdk.js` — copy into each miniapp. It is a local file, not an npm package. Exports: `onWalletChange`, `sendTransactions`, `signMessage`, `onAppData`, `isMiniappMode`
- **SDK split**:
  - `miniapp-sdk.js` = postMessage bridge for wallet ops (transactions, signing) only
  - `@aboutcircles/sdk` + `viem` = read Circles state (profiles, trust, avatars, balances)
- **Deployment**: Vercel (use `scripts/deploy-miniapp.sh`)
- **PR target**: `master` on `aboutcircles/CirclesMiniapps`

## Security

Before any commit: no API keys, no hardcoded credentials, no PII. Use env vars.
