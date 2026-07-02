/**
 * Rep Score Explorer — pure formatting & address helpers. No DOM, no network.
 */

import { isAddress, getAddress } from 'viem';
import type { Address } from './types';

/** 0x1234…abcd — mirrors direct-transfer's shortAddress. */
export function shortAddress(addr?: string | null): string {
	if (!addr) return '';
	if (addr.length <= 12) return addr;
	return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * 0x + 40 hex check. `strict: false` accepts any casing (we lowercase before
 * calling the API, so EIP-55 checksum case is irrelevant and would only reject
 * addresses users legitimately paste).
 */
export function isValidAddress(s: string | null | undefined): boolean {
	if (!s) return false;
	return isAddress(s.trim(), { strict: false });
}

/** Lowercased Address (the form the API expects), or null if invalid. */
export function normalizeAddress(s: string | null | undefined): Address | null {
	if (!s) return null;
	const t = s.trim();
	if (!isAddress(t, { strict: false })) return null;
	return t.toLowerCase() as Address;
}

/** Checksummed Address for display, or the input untouched if it can't be parsed. */
export function checksumAddress(s: string): string {
	try {
		return getAddress(s);
	} catch {
		return s;
	}
}

/** Headline / integer score. */
export function fmtScore(n: number): string {
	if (!Number.isFinite(n)) return '—';
	return String(Math.round(n));
}

/** Signed delta with a real minus sign, e.g. "+4" / "−2". */
export function fmtSigned(n: number, dp = 0): string {
	if (!Number.isFinite(n)) return '—';
	const rounded = dp > 0 ? Number(n.toFixed(dp)) : Math.round(n);
	if (rounded === 0) return '0';
	const sign = rounded > 0 ? '+' : '−';
	return `${sign}${Math.abs(rounded).toFixed(dp)}`;
}

/** A 0..1 ratio rendered as a percentage, e.g. 0.396 → "40%". */
export function fmtPct01(x: number, dp = 0): string {
	if (!Number.isFinite(x)) return '—';
	return `${(x * 100).toFixed(dp)}%`;
}

export function fmtNumber(n: number, dp = 2): string {
	if (!Number.isFinite(n)) return '—';
	return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/**
 * Economic values from `components.gate.live` are plain float CRC amounts
 * (verified: e.g. balance 945.22), NOT atto — so format as a decimal CRC number.
 */
export function fmtCrcFromFloat(n: number, dp = 2): string {
	if (!Number.isFinite(n)) return '—';
	if (n !== 0 && Math.abs(n) < 0.01) return '< 0.01 CRC';
	return `${fmtNumber(n, dp)} CRC`;
}

/** Balance-to-outstanding ratio; null when outstanding is 0 (undefined ratio). */
export function boRatio(balance: number, outstanding: number): number | null {
	if (!Number.isFinite(balance) || !Number.isFinite(outstanding) || outstanding === 0) return null;
	return balance / outstanding;
}

/** Human relative time, e.g. "3 days ago", "just now". */
export function fmtRelativeTime(iso: string, now: number = Date.now()): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return '';
	const diffMs = now - t;
	const future = diffMs < 0;
	const abs = Math.abs(diffMs);
	const sec = Math.round(abs / 1000);
	const min = Math.round(sec / 60);
	const hr = Math.round(min / 60);
	const day = Math.round(hr / 24);
	let phrase: string;
	if (sec < 45) phrase = 'just now';
	else if (min < 60) phrase = `${min} min`;
	else if (hr < 24) phrase = `${hr} hr`;
	else if (day < 30) phrase = `${day} day${day === 1 ? '' : 's'}`;
	else {
		const mon = Math.round(day / 30);
		phrase = `${mon} month${mon === 1 ? '' : 's'}`;
	}
	if (phrase === 'just now') return phrase;
	return future ? `in ${phrase}` : `${phrase} ago`;
}

/** Absolute local datetime, e.g. "23 Jun 2026, 10:04". */
export function fmtDateTime(iso: string): string {
	const t = Date.parse(iso);
	if (Number.isNaN(t)) return iso;
	return new Date(t).toLocaleString('en-GB', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}
