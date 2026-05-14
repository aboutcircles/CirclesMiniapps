import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const PREFIX = 'crc-nft';
export const INTENT_TTL_SECONDS = 15 * 60;

function hmac(secret, body) {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

export function newNonce() {
  return b64url(randomBytes(12));
}

/**
 * Pack an intent object into a `crc-nft.<payload>.<sig>` paymentData string.
 *
 * The intent shape (v=1):
 *   { v:1, c: collection, t: tokenId, b: buyer, s: seller, p: price, x: expiresAt, n: nonce }
 *
 * All values must be JSON-serialisable (strings / numbers). BigInts should be
 * stringified by the caller.
 */
export function buildPaymentData(intent, secret) {
  if (!secret) throw new Error('hmac secret is required');
  const payload = b64url(JSON.stringify(intent));
  const sig = hmac(secret, payload);
  return `${PREFIX}.${payload}.${sig}`;
}

/**
 * Inverse of buildPaymentData. Verifies the HMAC in constant time and returns
 * the decoded intent. Throws on any tampering, malformed input, or unsupported
 * version.
 */
export function parsePaymentData(paymentData, secret) {
  if (!secret) throw new Error('hmac secret is required');
  if (typeof paymentData !== 'string') throw new Error('paymentData must be a string');
  const parts = paymentData.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new Error('malformed paymentData');
  const [, payload, sig] = parts;
  const expected = hmac(secret, payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad HMAC');
  let intent;
  try {
    intent = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid intent payload');
  }
  if (intent.v !== 1) throw new Error('unsupported intent version');
  return intent;
}
