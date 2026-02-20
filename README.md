# Circles Mini App Host

A SvelteKit app that hosts mini apps in iframes at `https://<VITE_BASE_URL>/miniapps`. Mini apps can request wallet transactions and message signing via a postMessage protocol.

---

## Submitting Your App to the Marketplace

Apps are listed in [`static/miniapps.json`](static/miniapps.json). To add yours, open a Pull Request against `master` on [aboutcircles/CirclesMiniapps](https://github.com/aboutcircles/CirclesMiniapps) with two changes:

1. **A new entry in `static/miniapps.json`**
2. **A brief description of your app added to this README** (optional but appreciated)

### Entry format

```json
{
  "slug": "my-cool-app",
  "name": "My Cool App",
  "logo": "https://example.com/logo.svg",
  "url": "https://example.com/app/",
  "description": "One or two sentences describing what the app does.",
  "tags": ["defi", "tokens"]
}
```

| Field | Required | Notes |
|---|---|---|
| `slug` | yes | URL-safe, unique identifier. Becomes the path `/miniapps/<slug>`. |
| `name` | yes | Display name shown in the marketplace. |
| `logo` | yes | HTTPS URL of a square logo (SVG or PNG, min 64×64 px). |
| `url` | yes | HTTPS URL of your app. Must load in an iframe. |
| `description` | yes | Short description shown under the app name. |
| `tags` | yes | At least one category tag, e.g. `["defi"]`. |

### PR checklist

- [ ] Entry added to `static/miniapps.json` with all required fields
- [ ] App loads over HTTPS and works inside an iframe
- [ ] Logo URL resolves to a valid image
- [ ] `slug` is unique (no duplicate in the existing JSON)
- [ ] PR title: `feat: add <your app name>`

The Circles team reviews and merges PRs on a best-effort basis.

---

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
mkcert circles.gnosis.io
```

This produces two files in the current directory:

- `circles.gnosis.io.pem` — certificate
- `circles.gnosis.io-key.pem` — private key

These are gitignored and must be generated locally by each developer.

---

## 4. Add the host to /etc/hosts

The dev server binds to the hostname, so you need to point it to localhost.

**macOS / Linux:**

```sh
sudo sh -c 'echo "127.0.0.1 circles.gnosis.io" >> /etc/hosts'
```

**Windows** — open `C:\Windows\System32\drivers\etc\hosts` as Administrator and add:

```
127.0.0.1 circles.gnosis.io
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

The app is now available at **https://circles.gnosis.io** (port 443).

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

## postMessage protocol

Mini apps communicate with the host via `window.postMessage`. Use `examples/miniapp-sdk.js` for a ready-made client-side SDK.

**From mini app → host:**

| `type` | Payload | Description |
|---|---|---|
| `request_address` | — | Ask for the current wallet address |
| `send_transactions` | `{ transactions: [{to, value?, data?}], requestId }` | Request transaction approval |
| `sign_message` | `{ message: string, requestId }` | Request message signing |

**From host → mini app:**

| `type` | Payload | Description |
|---|---|---|
| `wallet_connected` | `{ address }` | Wallet is connected |
| `wallet_disconnected` | — | Wallet is not connected |
| `app_data` | `{ data: string }` | App-specific data from the `?data=` URL param |
| `tx_success` | `{ hashes, requestId }` | Transactions sent |
| `tx_rejected` | `{ reason, requestId }` | Transaction rejected |
| `sign_success` | `{ signature, verified, requestId }` | Message signed |
| `sign_rejected` | `{ reason, requestId }` | Signing rejected |

---

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
