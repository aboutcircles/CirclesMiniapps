# Affiliate Link

A Circles miniapp where a human avatar sets their own **affiliate group** — and
group admins can hand out a one-tap link to drive members to theirs. It runs
**inside a Circles host** and uses the host wallet bridge for connect + signing.

The Gnosis wallet app no longer lets users set an affiliate group, so this fills
that gap: members search and pick a group here; admins get a shareable link + QR.

## What an affiliate group is

Every Circles human has an *affiliate group*. That group receives **1/12 of the
CRC the human mints** — a human mints 24 CRC/day, so it's roughly **2 CRC/day per
affiliated member**. It costs the member nothing extra and they can change it any
time. (You don't have to be a member of the group you affiliate with.)

## Two tabs, one app

- **Set my affiliate** (default): search the live list of Circles groups
  (`sdk.rpc.group.findGroups`), pick one, and tap **Set as my affiliate** — a
  single on-chain call. Shows your current affiliate and flags one already set.
- **Promote my group** (admin): paste a group address → get a shareable link +
  QR. Opening that link **preselects** the group on the Set tab for a one-tap set.

The app runs inside a Circles host and has no wallet of its own — connect and
signing come from the host bridge (`@aboutcircles/miniapp-sdk`).

## On-chain mechanism

A single call to the **AffiliateGroupRegistry** on Gnosis Chain, submitted
through the host bridge with `sendTransactions`:

```
AffiliateGroupRegistry  0xca8222e780d046707083f51377B5Fd85E2866014
  setAffiliateGroup(address newGroup)        // caller sets their own affiliate
  affiliateGroup(address human) → address    // read current affiliate (view)
  event AffiliateGroupChanged(human, oldGroup, newGroup)
```

It is **not** a Safe-management call and does not target the user's own Safe, so
it passes the host transaction policy. The registry reverts if the caller isn't a
registered human or the target isn't a registered group — the app warns about the
latter up front (best-effort `Hub.isGroup`) but the chain is the source of truth.

Reads (current affiliate, `isGroup`, profile names) are best-effort niceties via
public RPC / the Circles SDK; the write path works without them.

## Deep-link contract

The share link is:

```
https://circles.gnosis.io/miniapps/affiliate-link?data=<base64(JSON)>
```

where the payload is `base64({ "group": "0x…", "name": "Optional" })`. The host
base64-**decodes** `?data=` and delivers the JSON string via the SDK's
`onAppData`; the app also parses `?data=` straight off the URL for standalone /
direct opens. A bare `0x…` address is accepted too.

> Keep `SHARE_BASE_URL` / `SHARE_SLUG` in `constants.js` in sync with the `slug`
> used in the marketplace's `static/miniapps.json` entry.

## Run locally

```sh
npm install
npm run dev
```

Open with a group prefilled for member-mode testing:
`http://localhost:5173/?data=<base64({"group":"0x…","name":"…"})>`

Wallet reads and the transaction only work when the app runs inside the Circles
wallet host (standalone shows a banner).

## Tests

```sh
npm test    # node payload.test.mjs — deep-link encode/decode round-trip
```

`payload.test.mjs` covers the riskiest custom logic: the share-link payload
round-trip through both the host bridge (`atob` → `onAppData`) and the URL
fallback, including unicode names and malformed input.

## Build & deploy

```sh
npm run build   # → dist/
```

Deploy `dist/` to any HTTPS host that allows iframing (the included `vercel.json`
sets `X-Frame-Options: ALLOWALL` and `frame-ancestors *`). **Disable Vercel
Deployment Protection** or the app will 401 inside the wallet iframe.

To list it, add an entry to `static/miniapps.json` with `"category": "admin"`
pointing at the deployed URL (or `/miniapps/affiliate-link` once embedded).
