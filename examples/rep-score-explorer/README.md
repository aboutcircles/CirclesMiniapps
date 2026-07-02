# Rep Score Explorer (standalone)

Read-only, mobile-first mini app that shows any Circles avatar's reputation
score, history, plain-language breakdown, trust neighbourhood and economic
snapshot. This is the **standalone / hosted** build (Vite + Svelte 5), deployed
to Vercel and surfaced in the wallet at `/admin/rep-score-explorer` via the
`admin` category entry in `static/miniapps.json`.

It is the hosted counterpart to the in-repo **embedded** route at
`src/routes/apps/rep-score-explorer/`. To keep this folder self-contained (Vercel
builds only this directory), the framework-agnostic data layer
(`src/lib/repscore/`) and the UI components (`src/components/`) are **copied
verbatim** from the embedded route. If you change scoring/UI logic in one place,
mirror it in the other.

> **Why TypeScript here (a deliberate exemption).** `examples/` apps are
> JavaScript by convention (see `AGENTS.md`). This app is the exception: it shares
> the embedded route's framework-agnostic **TypeScript** data layer
> (`src/lib/repscore/`) verbatim, so keeping it TS lets the two copies stay
> byte-identical and diffable. Converting to JS would fork ~12 typed modules and
> invite drift between the hosted and embedded builds. It stays a standard Vite
> app — the only extra tooling is `tsconfig.json`.

## Develop

```bash
npm install
npm run dev
```

Defaults to **production** Circles data (`rpc.aboutcircles.com`). Point at the
staging dataset with the `VITE_REP_SCORE_*` overrides (see `.env.example` at the
repo root). Read-only: the only host import is `onWalletChange` / `isMiniappMode`
— no transactions, no signing.

## Build & deploy

```bash
npm run build      # → dist/
vercel --prod      # deploy to your Vercel account
```

`vercel.json` sets `frame-ancestors *` / `X-Frame-Options: ALLOWALL` so the app
loads inside the Circles wallet iframe. After deploying, set the `url` of the
`rep-score-explorer` entry in `static/miniapps.json` to the deployment URL.

> **Vercel Deployment Protection must be disabled** on the deployment, or the app
> silently 401s inside the wallet iframe.
