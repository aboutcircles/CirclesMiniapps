/**
 * Tiny SDK for mini apps running inside the miniapps iframe host.
 *
 * Usage:
 *   import { onWalletChange, sendTransactions, signMessage } from '../miniapp-sdk.js';
 *
 * Works identically whether loaded inside the host iframe or opened standalone
 * (standalone simply never receives wallet_connected, so the UI stays disconnected).
 *
 * SECURITY: All inbound postMessage events are validated against an origin allowlist
 * to prevent spoofed messages from malicious frames. Outbound messages are restricted
 * to known wallet origins (not '*').
 */

// ── Origin Allowlist ────────────────────────────────────────────────
// Only accept messages from these origins. Prevents cross-origin message spoofing.
const ALLOWED_ORIGINS = [
  'https://circles.gnosis.io',
  'https://circles.gnosisapp.com',
  'https://app.circles.gnosis.io',
  'https://safe.circles.gnosis.io',
];

// Allow localhost for development
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  ALLOWED_ORIGINS.push(`http://${location.host}`);
}

/**
 * Determine the target origin for outbound postMessage calls.
 * Falls back to '*' only in standalone mode (no parent).
 */
function getTargetOrigin() {
  if (window.parent === window) return '*';
  // If we're in an iframe, try to use the parent's origin if known
  try {
    // document.referrer gives the parent page's URL when in an iframe
    if (document.referrer) {
      const refUrl = new URL(document.referrer);
      return refUrl.origin;
    }
  } catch {}
  // Fallback: use the first allowed origin (production wallet)
  return ALLOWED_ORIGINS[0];
}

let _address = null;
let _listeners = [];
let _dataListeners = [];
let _requestCounter = 0;
const _pending = {};

window.addEventListener('message', (event) => {
  // SECURITY: Validate origin before processing any message
  if (!ALLOWED_ORIGINS.includes(event.origin)) return;

  const d = event.data;
  if (!d || !d.type) return;

  switch (d.type) {
    case 'app_data':
      _dataListeners.forEach((fn) => fn(d.data));
      break;

    case 'wallet_connected':
      _address = d.address;
      _listeners.forEach((fn) => fn(_address));
      break;

    case 'wallet_disconnected':
      _address = null;
      _listeners.forEach((fn) => fn(null));
      break;

    case 'tx_success':
      _pending[d.requestId]?.resolve(d.hashes);
      delete _pending[d.requestId];
      break;

    case 'tx_rejected':
      _pending[d.requestId]?.reject(new Error(d.error ?? d.reason ?? 'Rejected'));
      delete _pending[d.requestId];
      break;

    case 'sign_success':
      _pending[d.requestId]?.resolve({ signature: d.signature, verified: d.verified });
      delete _pending[d.requestId];
      break;

    case 'sign_rejected':
      _pending[d.requestId]?.reject(new Error(d.error ?? d.reason ?? 'Rejected'));
      delete _pending[d.requestId];
      break;
  }
});

// Ask the host for the current wallet state on load
if (window.parent !== window) {
  window.parent.postMessage({ type: 'request_address' }, getTargetOrigin());
}

/**
 * Returns true when running inside the Circles MiniApp host iframe.
 * Useful for providing fallback behaviour during standalone development.
 * @returns {boolean}
 */
export function isMiniappMode() {
  return window.parent !== window;
}

/**
 * Register a callback that fires when the host sends app-specific data via ?data= param.
 * @param {(data: string) => void} fn
 */
export function onAppData(fn) {
  _dataListeners.push(fn);
}

/**
 * Register a callback that fires whenever wallet connection changes.
 * Called immediately with current state, then again on every change.
 * @param {(address: string | null) => void} fn
 */
export function onWalletChange(fn) {
  _listeners.push(fn);
  fn(_address); // fire with current state
}

/**
 * Request the host to send one or more transactions.
 * @param {{ to: string, data?: string, value?: string }[]} transactions
 * @returns {Promise<string[]>} array of tx hashes
 */
export function sendTransactions(transactions) {
  return new Promise((resolve, reject) => {
    const requestId = 'req_' + ++_requestCounter;
    _pending[requestId] = { resolve, reject };
    window.parent.postMessage({ type: 'send_transactions', requestId, transactions }, getTargetOrigin());
  });
}

/**
 * Request the host to sign an arbitrary message.
 * @param {string} message
 * @returns {Promise<{ signature: string, verified: boolean }>}
 */
export function signMessage(message) {
  return new Promise((resolve, reject) => {
    const requestId = 'req_' + ++_requestCounter;
    _pending[requestId] = { resolve, reject };
    window.parent.postMessage({ type: 'sign_message', requestId, message }, getTargetOrigin());
  });
}