# Direct Transfer

A Circles miniapp that lets a user send CRC they hold directly to another user, with auto wrap/unwrap routing across the three on-chain forms.

## What it does

1. **Balance breakdown** — reads `getTokenBalances` for the connected wallet and groups every row by `tokenOwner` (the avatar that issued the CRC). Each row shows the *summed* today's-value across the three forms; expanding a row reveals the per-form composition plus the avatar address and the ERC1155 token id.
2. **Filtering** — `Hide under 0.1 CRC` toggle (default ON) hides dust; a search box filters tokens by issuer name, registered name, description or address.
3. **Unit switch** — top-level `demurraged | static` pill lets the user view and type in either unit. Internal canonical is always demurraged-atto; conversion is purely a display/input transform.
4. **Send screen** — pick a recipient by name or 0x address via the Circles profile service (`searchProfiles` primary, `searchByAddressOrName` fallback). Enter an amount, choose the **target form** to send in:
   - `ERC1155` — Hub V2 native (`safeTransferFrom`)
   - `ERC20 — Demurraged` — wrapped, decays over time, 1:1 with CRC today
   - `ERC20 — Static / Inflationary` — wrapped, non-decaying
5. **Auto-routing** — the app builds the smallest tx batch needed to satisfy the request, draining pools in this priority order:
   - `target=ERC1155` : existing 1155 → unwrap demurraged → unwrap inflationary
   - `target=ERC20_DEM` : existing dem → wrap from 1155 → unwrap infl + wrap dem
   - `target=ERC20_INFL` : existing infl → wrap from 1155 → unwrap dem + wrap infl
   - The "prefer wrap-from-1155 over rewrap" rule keeps already-wrapped balances wrapped wherever possible.
6. **Receipt polling** — after the host confirms the batch, the app polls the last tx hash across multiple Gnosis RPCs until receipt; on success it refreshes the balance list.

## Tech

- `@aboutcircles/miniapp-sdk` — host bridge (`onWalletChange`, `sendTransactions`, `isMiniappMode`)
- `@aboutcircles/sdk` — read-only SDK (`new Sdk()` for profiles, balances, wrapper lookups)
- `@aboutcircles/sdk-abis` — Hub V2, demurrageCircles, inflationaryCircles ABIs
- `viem` — `encodeFunctionData` for raw calldata + `formatUnits`/`parseUnits` for atto-CRC conversion

The miniapp host signs everything with the user's Safe, so we just emit `{to, data, value}` tuples and let the host batch them.

Source layout:
- `main.js` — UI + wallet bridge wiring.
- `routing.js` — pure (no-DOM, no-network) logic: balance classification, atto math, tx encoders, route planner. Imported by `main.js`.
- `routing.test.js` — 38 vitest unit tests covering the pure logic above.

## Develop

```bash
npm install
npm run dev
```

The app runs standalone, but wallet bridge calls (`sendTransactions`) only work when loaded inside the Circles host iframe at `https://circles.gnosis.io/miniapps`.

## Test

```bash
npm test          # watch mode
npm run test:run  # one-shot
```

38 unit tests cover the routing engine (every target × deficit combination, wrapper-deploy guards, pool-draining invariants, dust tolerance), atto math, balance classification, unit conversion round-trip, and tx encoders.

## Build

```bash
npm run build
```

Output goes to `dist/`. Deploy any static host (e.g. Vercel — `vercel.json` is preconfigured for `frame-ancestors *`).

## Submission status

This PR adds the source. Still to-do before the app becomes user-visible in the marketplace:
- Deploy the built `dist/` somewhere reachable over HTTPS.
- Drop a `static/app-logos/direct-transfer.png` (square, ≥ 64×64).
- In `static/miniapps.json`: fill the empty `"url"` with the deploy URL and flip `"isHidden": false`.

## Limitations (v1)

- Wrapping into a wrapper that is **not yet deployed** is not supported because we can't predict the CREATE2 wrapper address ahead of the deploy tx in the same batch. If a target wrapper hasn't been deployed yet, the route preview tells the user to wrap it once via the main Circles app first.
- v1 (legacy) ERC20 personal tokens are surfaced indirectly via their v2 issuer if the holder also holds the v2 form, but standalone v1-only balances are skipped.
