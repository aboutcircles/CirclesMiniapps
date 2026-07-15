# Circles Miniapps (consolidated)

A single Vite + TypeScript SPA that bundles the three Circles management miniapps
under shared routing, shared chrome, and a shared code layer:

| Route            | App                         | Source repo |
|------------------|-----------------------------|-------------|
| `#/group`        | Circles Groups Manager      | `circles-groups-miniapp` |
| `#/org`          | Circles Builder Org Manager | `circles-org-miniapp` |
| `#/invitations`  | Invitation Links Manager    | `circles-invitation-links-manager` |

`#/` shows a landing page that links to all three.

## How it works

- **One bundle, hash router.** `src/main.ts` is a tiny client-side router. On
  navigation it lazily `import()`s the matching app (so each app's heavy SDK
  bundle only loads when first visited), injects the app's markup into a
  per-app container, and runs the app's bootstrap. Each app exports a
  `{ mount(root) }` object (see `src/shared/app.ts`).
- **`boot()` wrapping.** Each app's logic — which caches DOM nodes and wires
  listeners — runs inside an exported `boot()` that the router calls *after* the
  app's HTML is in the DOM, instead of at import time against a static
  `index.html`.
- **Scoped styles, no collisions.** Each app's `style.css` (plus the invitation
  app's inline `<head>` styles) is wrapped in `[data-app="<app>"] { … }` using
  native CSS nesting, with the original `body` / `:root` rules rebased onto the
  container (`&`). Apps mount one at a time; their containers are cached and
  toggled with `display`, so per-session state (connected wallet, loaded data)
  survives navigation between routes.

## TypeScript + unified SDK

Everything is TypeScript. All three apps run on a **single** `@aboutcircles` SDK
version (`0.1.52`) declared once in the root `package.json` — there are no
per-app `package.json` files and no npm workspace.

The group (originally 0.1.24) and org (0.1.23) apps were **migrated** to the
0.1.52 API. The breaking change was that several RPC query methods now return
`PagedResponse<T>` = `{ results, hasMore, nextCursor }` instead of an array or a
sync `PagedQuery`. See `SDK_MIGRATION_0.1.52.md` for the full call-site map and
the **verify-with-wallet** checklist (a few on-chain flows couldn't be confirmed
without a connected wallet).

`tsconfig.json` is `strict` but with `noImplicitAny: false`, so the large
converted monoliths compile without a per-DOM-node cast pass while still
type-checking every SDK call against the 0.1.52 typings. Run `npm run typecheck`.

## Shared layer (`src/shared/`)

| File         | Contents |
|--------------|----------|
| `config.ts`  | RPC / auth / Safe / contract / faucet constants and addresses |
| `format.ts`  | `escapeHtml`, `escapeAttr`, `shortAddr`, `keyPreview`, `formatExpiry`, `parsePrivateKeys`, `decodeError`, `isPasskeyAutoConnectError`, `normalizeAddressList`, `txLinks` |
| `safe.ts`    | Safe owner discovery + verification, `wrapTxsForSafe`, prevalidated signatures |
| `types.ts`   | Shared domain types (`Session`, `KeyEntry`, `Referral`, `GroupEntry`, …) |
| `app.ts`     | The `MiniApp` mount contract |
| `shell.css`  | Shared chrome (top nav) + landing styles (`.mm-*`) |

App-specific UI helpers that bind to an app's own elements (`showResult`,
`setStatus`) stay local to each app; org keeps its legacy Safe tx-service host
(`SAFE_TX_SERVICE_URL_LEGACY`) and its MultiSend runner.

## Layout

```
index.html                 shared shell (top nav + #mm-app-root)
package.json               single root package (SDK 0.1.52 + build deps)
tsconfig.json
SDK_MIGRATION_0.1.52.md    call-site migration map + verify-with-wallet list
src/
  main.ts                  router + Buffer shim
  shared/                  app.ts config.ts format.ts safe.ts types.ts shell.css
  apps/
    group/    index.ts template.ts app.ts circlesClient.ts style.css
    org/      index.ts template.ts app.ts style.css
    invitations/ index.ts template.ts app.ts style.css
```

## Develop / build

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck  # tsc --noEmit (expect 0 errors)
npm run build      # → dist/
npm run preview
```

> Note: `@safe-global/safe-deployments` is pinned to `1.37.53`. Later 1.37.5x
> releases changed the `dist/assets/**.json` layout and break the Rollup build.

## Updating an app

Re-port from its source repo: copy the new `main.*` into `app.ts`, re-apply the
`boot()` wrap, refresh `template.ts` from the new `<body>`, re-wrap `style.css`
under the `[data-app="…"]` block, and re-point any changed SDK calls at the
shared modules / current SDK API.
