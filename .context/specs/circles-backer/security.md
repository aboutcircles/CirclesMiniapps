# Circles Backer MiniApp — Security Review & Hardening

**Date**: 2026-04-26
**Scope**: All files in `examples/circles-backer/`

---

## 1. Threat Model

| Threat | Severity | Mitigation |
|--------|----------|------------|
| PostMessage spoofing (malicious iframe sends fake `wallet_connected`) | **CRITICAL** | Origin allowlist on all inbound messages |
| PostMessage leakage (wallet messages sent to `*`) | **HIGH** | `getTargetOrigin()` restricts outbound to known wallet origins |
| XSS via `innerHTML` with user-controlled data (addresses, balances) | **HIGH** | All dynamic DOM uses `createElement` + `textContent` / `replaceChildren` |
| Runtime tampering of contract addresses via dev console | **MEDIUM** | `Object.freeze()` on all config constants |
| Invalid address passed to contract calls | **MEDIUM** | `isAddress()` validation before every contract interaction |
| Clickjacking (app loaded in non-wallet iframe) | **LOW** | CSP `frame-ancestors` restricts embedding to wallet domains |
| Insecure network requests | **LOW** | All API/RPC calls use HTTPS only |

---

## 2. Hardening Applied

### 2.1 PostMessage Origin Validation (CRITICAL fix)

**File**: `miniapp-sdk.js`

**Problem**: The original SDK accepted `message` events from any origin (`event.origin` was never checked). A malicious page loaded in a parallel iframe could send spoofed `wallet_connected` messages with arbitrary addresses, tricking the miniapp into sending transactions to an attacker-controlled address.

**Fix**:
```javascript
const ALLOWED_ORIGINS = [
  'https://circles.gnosis.io',
  'https://circles.gnosisapp.com',
  'https://app.circles.gnosis.io',
  'https://safe.circles.gnosis.io',
];

window.addEventListener('message', (event) => {
  if (!ALLOWED_ORIGINS.includes(event.origin)) return;  // ← reject unknown origins
  // ... process message
});
```

Outbound messages also restricted:
```javascript
function getTargetOrigin() {
  // Uses document.referrer or falls back to first allowed origin
  // Never sends to '*' when in iframe context
}
```

### 2.2 No innerHTML with Dynamic Data (HIGH fix)

**File**: `main.js`

**Problem**: Six locations used `innerHTML` with template literals containing user addresses, balances, and transaction hashes. If any of these values were manipulated (e.g. via prototype pollution or SDK compromise), arbitrary HTML/JS could execute.

**Fix**: Replaced all `innerHTML` assignments with safe DOM construction:
- `createEl(tag, className, textContent)` — creates elements with `textContent` (no HTML parsing)
- `createRow(label, value)` — builds confirm rows safely
- `replaceChildren()` — replaces content without HTML parsing

### 2.3 Frozen Constants (MEDIUM fix)

**File**: `backing.js`

**Problem**: `BACKING_ASSETS` object could be mutated at runtime via browser console, changing contract addresses to attacker-controlled ones.

**Fix**:
```javascript
export const BACKING_ASSETS = Object.freeze({
  WBTC: Object.freeze({ address: '...', symbol: 'WBTC', ... }),
  // ... each entry frozen
});
```

### 2.4 Address Validation (MEDIUM fix)

**File**: `backing.js`

**Problem**: Functions `computeBackingAddress()` and `buildBackingTransactions()` accepted any string as an address parameter.

**Fix**: Added `isAddress()` check at entry points:
```javascript
export async function computeBackingAddress(backerAddress) {
  if (!isAddress(backerAddress)) {
    throw new Error(`Invalid backer address: ${backerAddress}`);
  }
  // ...
}
```

### 2.5 Content Security Policy (LOW fix)

**File**: `index.html`

**Problem**: No CSP header — the page could load scripts/styles from any origin.

**Fix**: Added restrictive CSP meta tag:
```
default-src 'self';
script-src 'self' 'unsafe-inline';     // needed for Vite dev
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
connect-src https://rpc.aboutcircles.com/ https://rpc.gnosischain.com https://api.cow.fi/;
frame-ancestors https://circles.gnosis.io https://circles.gnosisapp.com https://app.circles.gnosis.io;
```

---

## 3. Remaining Considerations

| Item | Status | Notes |
|------|--------|-------|
| `'unsafe-inline'` in script-src | **Accepted** | Required for Vite HMR in dev. Production build uses hashed modules. |
| `'unsafe-inline'` in style-src | **Accepted** | Required for Google Fonts + Vite CSS injection. |
| No Subresource Integrity (SRI) on Google Fonts | **Low risk** | Fonts are loaded from Google's CDN with CORS. CSP limits style sources. |
| No rate limiting on RPC calls | **Low risk** | Public RPC endpoints handle their own rate limiting. |
| CowSwap API registration (PUT) | **No auth needed** | The appData registration endpoint is public and idempotent. |
| Transaction confirmation | **Wallet-side** | All transactions require user confirmation in the Gnosis Safe wallet UI. Miniapp cannot bypass this. |

---

## 4. Audit Checklist

- [x] All `postMessage` listeners validate `event.origin` against allowlist
- [x] All `postMessage` sends use specific target origin (not `'*'`)
- [x] No `innerHTML` with dynamic/user-controlled data
- [x] All contract addresses frozen with `Object.freeze()`
- [x] All address inputs validated with `isAddress()` before contract calls
- [x] CSP header restricts script, style, font, connect, and frame-ancestors sources
- [x] No secrets, API keys, or private keys in committed files
- [x] All external links use `rel="noopener"` and `target="_blank"`
- [x] Error messages sanitized via `decodeError()` — no raw stack traces shown to user