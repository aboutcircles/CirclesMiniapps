// Shared pure formatting / parsing / address utilities used across the apps.
// These are signature-stable and DOM-free, so they can be shared verbatim.

import { getAddress, isAddress } from 'viem';
import type { Address } from 'viem';

/** Escape a value for safe interpolation into innerHTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a value for safe interpolation into an HTML attribute. */
export function escapeAttr(value: unknown): string {
  return String(value ?? '')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 0x1234…abcd style short address. Returns '—' for empty input. */
export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return '—';
  return addr.slice(0, 6) + '…' + addr.slice(-4);
}

/** Short preview of a private key (0x123456…abcd). */
export function keyPreview(pk: string | null | undefined): string {
  if (!pk) return '—';
  return pk.slice(0, 8) + '…' + pk.slice(-4);
}

/** Best-effort human-readable error string from any thrown value. */
export function decodeError(err: unknown): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  const e = err as { shortMessage?: string; message?: string };
  if (e.shortMessage) return e.shortMessage;
  if (e.message) return e.message;
  return String(err);
}

/** Detect the host-app passkey auto-connect failure so the UI can prompt a retry. */
export function isPasskeyAutoConnectError(err: unknown): boolean {
  const message = decodeError(err).toLowerCase();
  return (
    message.includes('passkey') ||
    message.includes('passkeys') ||
    message.includes('auto connect') ||
    message.includes('autoconnect') ||
    (message.includes('wallet address') && message.includes('retrieve'))
  );
}

/** Dedupe + checksum a list of address-like values, dropping invalid ones. */
export function normalizeAddressList(values: unknown[]): Address[] {
  const seen = new Set<string>();
  const out: Address[] = [];
  for (const value of values ?? []) {
    if (!value || typeof value !== 'string' || !isAddress(value)) continue;
    const normalized = getAddress(value);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Parse newline-separated secp256k1 private keys (0x + 64 hex). */
export function parsePrivateKeys(raw: string): string[] {
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^0x[a-fA-F0-9]{64}$/.test(l));
}

/** Relative expiry label for an ISO timestamp. */
export function formatExpiry(
  iso: string | null | undefined,
): { label: string; soon: boolean } | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = d.getTime() - Date.now();
  if (diff < 0) return { label: 'Expired', soon: true };
  const days = Math.floor(diff / 86400000);
  if (days === 0) return { label: 'Expires today', soon: true };
  if (days === 1) return { label: 'Expires tomorrow', soon: false };
  return { label: `Expires in ${days}d`, soon: false };
}

/** Render a list of tx hashes as gnosisscan links. */
export function txLinks(hashes: string[]): string {
  return hashes
    .map(
      (h) =>
        `<a href="https://gnosisscan.io/tx/${h}" target="_blank" rel="noopener">${h}</a>`,
    )
    .join('<br>');
}
