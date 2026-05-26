# Circles Mini App Host

A SvelteKit app that hosts mini apps in iframes at `https://<VITE_BASE_URL>/miniapps`. Mini apps can request wallet transactions and message signing via a postMessage protocol.

---

## Submitting a Garage Mini App

This guide is for adding an app to **Circles Garage** — the section of the [Mini Apps marketplace](https://circles.gnosis.io/miniapps) for experimental, community, and hackathon apps, including [Circles Garage competition](https://garage.aboutcircles.com/) entries.

Garage apps:

- Can be hosted anywhere — your own domain, Vercel, Netlify, GitHub Pages, etc.
- Run under a stricter host transaction policy (see [Garage transaction policy](#garage-transaction-policy)).
- Show a "use at your own risk" preview disclaimer to users.

To submit a curated production-grade Embedded Mini App instead, see [docs.aboutcircles.com/miniapps/contribute-mini-apps](https://docs.aboutcircles.com/miniapps/contribute-mini-apps).

### What the PR should contain

Garage submissions only need a manifest entry — the app itself stays in your repo and deployment.

- A new entry in [`static/miniapps.json`](static/miniapps.json) with `"category": "garage"` pointing at your deployed app
- Optionally a square logo committed under `static/app-logos/`
- The deployed URL must already be reachable and embeddable in an iframe

Open the PR against `master` on [aboutcircles/CirclesMiniapps](https://github.com/aboutcircles/CirclesMiniapps).

### How the host loads your app

The marketplace reads metadata from `static/miniapps.json`. When a user opens `/miniapps/<slug>`, the host loads the `url` from your entry inside an iframe and exposes the wallet bridge via `postMessage` (see [Integration with Mini Apps SDK](#intgration-with-mini-apps-sdk) below).

### Manifest fields

| Field | Required | Notes |
|---|---|---|
| `slug` | yes | URL-safe, unique identifier. Becomes the path `/miniapps/<slug>`. |
| `name` | yes | Display name shown in the marketplace. |
| `logo` | yes | HTTPS URL or repo-relative path of a square logo (SVG or PNG, min 64×64 px). Empty string falls back to a first-letter tile. |
| `url` | yes | Absolute HTTPS URL of your deployed app. Must load in an iframe. |
| `description` | yes | Short description shown under the app name. |
| `tags` | yes | At least one tag, e.g. `["defi"]`. |
| `category` | yes | Must be `"garage"`. |
| `isHidden` | no | If `true`, hides the tile from the grid. The app is still reachable at `/miniapps/<slug>`. |

Example entry:

```json
{
  "slug": "your-app-slug",
  "name": "Your App",
  "logo": "/app-logos/your-app.png",
  "url": "https://your-app.example.com/",
  "description": "One-sentence description of what it does.",
  "tags": ["demo", "tools"],
  "category": "garage"
}
```

### Garage transaction policy

Garage apps post transactions through `@aboutcircles/miniapp-sdk`'s `sendTransactions` (see [Integration with Mini Apps SDK](#intgration-with-mini-apps-sdk) below). Before the approval popup is shown, the host runs the batch through a policy that rejects any tx that:

1. Targets the user's currently-acting Safe address.
2. Targets the user's primary Safe (when operating in child-safe mode).
3. Uses any of these Safe-management 4-byte selectors:

| Selector | Function |
|---|---|
| `0x0d582f13` | `addOwnerWithThreshold(address,uint256)` |
| `0xf8dc5dd9` | `removeOwner(address,address,uint256)` |
| `0xe318b52b` | `swapOwner(address,address,address)` |
| `0x694e80c3` | `changeThreshold(uint256)` |
| `0xe19a9dd9` | `setGuard(address)` |
| `0xf08a0323` | `setFallbackHandler(address)` |
| `0x610b5925` | `enableModule(address)` |
| `0xe009cfde` | `disableModule(address,address)` |
| `0x6a761202` | `execTransaction(...)` |

The whole batch is rejected on the first offender. The user sees a "Restricted action" modal explaining what was blocked; the iframe receives a `tx_rejected` postMessage.

What a Garage app **cannot** do:

- Wrap its own `execTransaction` to act on a Safe the user co-owns. The host already wraps every tx as needed; calling `execTransaction` yourself is treated as a smuggling attempt.
- Add owners, swap guards, enable modules, or otherwise mutate the user's Safe configuration.

If you need these, the app does not belong in Garage — submit it as a curated Embedded Mini App via the docs site link above.

### PR checklist

- [ ] Entry added to `static/miniapps.json` with all required fields and `"category": "garage"`
- [ ] App loads over HTTPS and renders inside an iframe (no `X-Frame-Options: DENY`, no restrictive `frame-ancestors`)
- [ ] Logo resolves to a valid image
- [ ] `slug` is unique
- [ ] No attempt to call `execTransaction` or any Safe-management selectors from the app
- [ ] PR title: `feat: add <your app name> (garage)`

The Circles team reviews and merges PRs on a best-effort basis.

---

## Please Note:
If you only want to test your miniapps, you don't need to go through the below steps and run the environment locally. You can use [Circles Playground](https://circles.gnosis.io/playground).

## Prerequisites

- [Node.js](https://nodejs.org) 18+
- [mkcert](https://github.com/FiloSottile/mkcert) for local TLS certificates

---

## 1. Install mkcert

**macOS:**
```sh
brew install mkcert
mkcert -install
```

**Linux:**
```sh
sudo apt install libnss3-tools
curl -JLO "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
chmod +x mkcert-v*-linux-amd64
sudo mv mkcert-v*-linux-amd64 /usr/local/bin/mkcert
mkcert -install
```

**Windows:**
```sh
choco install mkcert
mkcert -install
```

---

## 2. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```sh
cp .env.example .env
```

```env
VITE_COMETH_API_KEY=your_cometh_api_key
VITE_PIMLICO_API_KEY=your_pimlico_api_key
VITE_BASE_URL=circles.gnosis.io
```

`VITE_BASE_URL` is used for page titles and the dev server hostname. It must match the TLS certificate and `/etc/hosts` entry below.

---

## 3. Generate TLS certificates

Run this from the project root, using your `VITE_BASE_URL` value:

```sh
mkcert circles-dev.gnosis.io
```

This produces two files in the current directory:

- `circles-dev.gnosis.io.pem` — certificate
- `circles-dev.gnosis.io-key.pem` — private key

These are gitignored and must be generated locally by each developer.

---

## 4. Add the host to /etc/hosts

The dev server binds to the hostname, so you need to point it to localhost.

**macOS / Linux:**

```sh
sudo sh -c 'echo "127.0.0.1 circles-dev.gnosis.io" >> /etc/hosts'
```

**Windows** — open `C:\Windows\System32\drivers\etc\hosts` as Administrator and add:

```
127.0.0.1 circles-dev.gnosis.io
```

---

## 5. Install dependencies

```sh
npm install
```

---

## 6. Run the dev server

```sh
sudo npm run dev
```

The app is now available at **https://circles-dev.gnosis.io** (port 443).

> Your browser will trust the certificate because mkcert adds its CA to the system trust store.

---

## Running example mini apps locally

The `examples/` directory contains demo mini apps you can run alongside the host for testing.

**Sign Message demo** (port 5181):
```sh
npm run demo:sign
```

**ERC20 Transfer demo** (port 5180):
```sh
npm run demo:tx
```

To test locally, update `static/miniapps.json` to point the relevant app URL to `http://localhost:518x/`.

---

## Mini apps

Apps listed in `static/miniapps.json` appear on the `/miniapps` page. See [Submitting Your App](#submitting-your-app-to-the-marketplace) for the full entry format.

### URL patterns

| URL | Description |
|---|---|
| `/miniapps` | App list |
| `/miniapps/<slug>` | Open a specific app directly |
| `/miniapps/<slug>?data=<base64>` | Open app and pass arbitrary data to it |

### Passing data to apps

The `?data=` param carries arbitrary base64-encoded data to the mini app. The host decodes it and delivers it via a `app_data` postMessage. The mini app defines its own schema — plain strings, JSON, ABI-encoded bytes, etc.

**Example — base64 JSON:**
```js
const data = btoa(JSON.stringify({ message: 'Please sign this', context: 'my-app:v1' }))
// use in URL: /miniapps/my-app?data=<data>
```

**Example — ABI-encoded bytes (viem):**
```js
import { encodeAbiParameters } from 'viem'
const encoded = encodeAbiParameters(
  [{ type: 'string' }, { type: 'address' }],
  ['Hello', '0xABC...']
)
const data = btoa(encoded)
```

---

## Intgration with Mini Apps SDK

Mini apps communicate with the host via `window.postMessage`. Use [Mini App SDK](https://www.npmjs.com/package/@aboutcircles/miniapp-sdk) for a ready-made client-side SDK.

## Wallet

Wallet connection uses [Cometh Connect SDK](https://docs.cometh.io) with a Safe smart account and Pimlico as the paymaster on Gnosis Chain.

- Connecting triggers a passkey prompt via `navigator.credentials.get()` — the user picks their passkey and Cometh resolves the associated Safe address automatically
- No address input required — the Safe address is derived from the passkey
- On successful connect the address is saved to `localStorage` and restored on next visit without prompting the passkey again
- Disconnecting clears both the in-memory state and `localStorage`

---

## Build

```sh
npm run build
```

Output goes to `build/`. It is a fully static site (SvelteKit adapter-static) with a `404.html` fallback for client-side routing of dynamic slug routes.


## Developer responsibilities
By submitting a mini-app for listing, you confirm that:
Your app and its use of Circles / Gnosis tooling complies with all applicable laws and regulations in the jurisdictions .
You have not introduced, and will not introduce, any malicious code, backdoors or other potentially technologically harmful content or software designed to compromise users’’ assets, rights, wallets or the Circles/Gnosis infrastructure, and you will take reasonable care in accordance with industry practice to avoid the existence of any bugs or vulnerabilities in the mini-apps you develop that could lead to loss of user funds or disruption to our systems.
The Circles / Gnosis team may reject, de-list, disable or restrict the availability of any mini-app at any time, in its sole discretion, including where we suspect any legal or  security risks, or where we have reason to believe you are engaging in abusive or prohibited behaviour.
