// Deep-link payload encoding/decoding for the Affiliate Link miniapp.
// Pure, DOM-free, and unit-tested (see payload.test.mjs) — the share link is
// the app's trickiest contract with the host, so it lives on its own.

import { getAddress, isAddress } from 'viem';
import { SHARE_BASE_URL, APP_BASE_URL } from './constants.js';

// base64 <-> UTF-8 helpers. btoa/atob are Latin1-only, so a group name with an
// emoji/non-ASCII char would otherwise throw on encode — route through UTF-8.
export function b64encodeUtf8(str) {
  // Encode to UTF-8 bytes, then to a binary string btoa can consume. (Avoids
  // the legacy escape/unescape APIs while still handling non-ASCII names.)
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function utf8FromBinary(bin) {
  // `bin` is an atob-style binary string (one byte per char code). For pure
  // ASCII this is the identity; for UTF-8 it recovers the original characters.
  // `fatal: true` makes a malformed sequence throw so we fall back to `bin`.
  try {
    const bytes = Uint8Array.from(String(bin), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return bin;
  }
}

// Admin link carries base64(JSON{ group, name }). The host base64-DECODES the
// `?data=` param before delivering it via onAppData, so that path arrives as a
// binary string (alreadyDecoded); the raw URL fallback (standalone/direct open)
// is still base64. A bare 0x address is accepted too, for resilience.
export function parseGroupPayload(raw, alreadyDecoded) {
  if (!raw) return null;
  let s;
  try {
    s = alreadyDecoded ? utf8FromBinary(String(raw)) : utf8FromBinary(atob(String(raw).trim()));
  } catch {
    s = String(raw).trim();
  }
  try {
    const obj = JSON.parse(s);
    if (obj && obj.group && isAddress(obj.group)) {
      return {
        group: getAddress(obj.group),
        name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : null,
      };
    }
  } catch {
    /* not JSON */
  }
  if (isAddress(s)) return { group: getAddress(s), name: null };
  const rawTrim = String(raw).trim();
  if (isAddress(rawTrim)) return { group: getAddress(rawTrim), name: null };
  return null;
}

export function buildShareLink(group, name) {
  const payload = { group: getAddress(group) };
  if (name && name.trim()) payload.name = name.trim();
  const b64 = b64encodeUtf8(JSON.stringify(payload));
  // The host Playground loads the app URL directly and does NOT forward
  // app_data, so the payload has to ride in the app's OWN `?data=` query (the
  // URL-fallback path), with the whole app URL wrapped as the Playground's
  // `url=` param. This works without a marketplace catalog entry. (A registered
  // `/miniapps/<slug>?data=` link would be cleaner but needs the host listing.)
  const appUrl = `${APP_BASE_URL}?data=${encodeURIComponent(b64)}`;
  return `${SHARE_BASE_URL}/playground?url=${encodeURIComponent(appUrl)}`;
}
