# Circles Mini App Host

A SvelteKit app that hosts mini apps in iframes at `https://circles.gnosis.io/miniapps`. Mini apps can request wallet transactions and message signing via a postMessage protocol.

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

## 2. Generate TLS certificates

Run this from the project root:

```sh
mkcert circles.gnosis.io
```

This produces two files in the current directory:

- `circles.gnosis.io.pem` — certificate
- `circles.gnosis.io-key.pem` — private key

These are gitignored and must be generated locally by each developer.

---

## 3. Add the host to /etc/hosts

The dev server binds to `circles.gnosis.io`, so you need to point that hostname to localhost.

**macOS / Linux** — edit `/etc/hosts` with sudo:

```sh
sudo sh -c 'echo "127.0.0.1 circles.gnosis.io" >> /etc/hosts'
```

Or open the file manually and add:

```
127.0.0.1 circles.gnosis.io
```

**Windows** — open `C:\Windows\System32\drivers\etc\hosts` as Administrator and add:

```
127.0.0.1 circles.gnosis.io
```

---

## 4. Install dependencies

```sh
npm install
```

---

## 5. Run the dev server

```sh
npm run dev
```

The app is now available at **https://circles.gnosis.io** (port 443).

> Your browser will trust the certificate because mkcert adds its CA to the system trust store.

---

## Mini apps

Apps listed in `static/miniapps.json` appear on the `/miniapps` page. Each entry:

```json
{
  "name": "My App",
  "logo": "https://example.com/logo.svg",
  "url": "https://example.com/app/",
  "description": "Short description.",
  "tags": ["demo"]
}
```

---

## postMessage protocol

Mini apps communicate with the host via `window.postMessage`.

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
| `tx_success` | `{ hashes, requestId }` | Transactions sent |
| `tx_rejected` | `{ reason, requestId }` | Transaction rejected |
| `sign_success` | `{ signature, verified, requestId }` | Message signed |
| `sign_rejected` | `{ reason, requestId }` | Signing rejected |

See `examples/miniapp-sdk.js` for a ready-made client-side SDK.

---

## Build

```sh
npm run build
```

Output goes to `build/`. It is a fully static site (SvelteKit adapter-static).
