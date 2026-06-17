/**
 * Pure logic for the Coffee Loyalty miniapp — QR payload encode/decode, the
 * stamp challenge string, and small display helpers. No DOM, no SDK, so it's
 * unit-testable (see loyalty.test.ts).
 */
import { getAddress, type Address } from 'viem';

/** The base URL of the miniapps host the QR should deep-link into. */
export const HOST_BASE_URL = 'https://circles.gnosis.io';

/** The miniapp slug, used to build the QR deep link. */
export const SLUG = 'coffee-loyalty';

export interface QrPayload {
	/** The coffee shop's Circles group Safe address. */
	shop: Address;
	/** The shop's daily-rotating secret. */
	secret: string;
}

/**
 * Message a customer signs to collect a stamp.
 *
 * MUST stay byte-for-byte identical to `stampChallenge` in the backend's
 * challenge.ts — otherwise the signature the host produces won't verify.
 */
export function stampChallenge(group: Address, secret: string): string {
	return ['Coffee Loyalty — collect a stamp', `Shop: ${getAddress(group)}`, `Secret: ${secret}`].join(
		'\n'
	);
}

/** Message the owner signs to unlock the dashboard. Matches backend ownerChallenge. */
export function ownerChallenge(group: Address, date: string): string {
	return ['Coffee Loyalty — owner dashboard', `Shop: ${getAddress(group)}`, `Date: ${date}`].join(
		'\n'
	);
}

/** Message the owner signs to redeem a free-coffee NFT. Matches backend redeemChallenge. */
export function redeemChallenge(customer: Address, tokenId: string): string {
	return [
		'Coffee Loyalty — redeem free coffee',
		`Customer: ${getAddress(customer)}`,
		`Token: ${tokenId}`
	].join('\n');
}

/** Today's date as YYYY-MM-DD in UTC (matches the backend's secret rotation unit). */
export function todayUtc(): string {
	return new Date().toISOString().slice(0, 10);
}

/** base64-encode a QR payload (URL-safe via the standard btoa, then embedded in ?data=). */
export function encodeQrPayload(payload: QrPayload): string {
	const json = JSON.stringify({ shop: getAddress(payload.shop), secret: payload.secret });
	return btoaUtf8(json);
}

/**
 * Parse the string delivered to onAppData. The host already base64-decodes the
 * `?data=` param, so we normally get raw JSON — but fall back to decoding base64
 * ourselves in case a future host hands the value through verbatim.
 */
export function decodeAppData(raw: string): QrPayload | null {
	const tryParse = (s: string): QrPayload | null => {
		try {
			const obj = JSON.parse(s);
			if (obj && typeof obj.shop === 'string' && typeof obj.secret === 'string') {
				return { shop: getAddress(obj.shop), secret: obj.secret };
			}
		} catch {
			/* not JSON */
		}
		return null;
	};
	return tryParse(raw) ?? tryParse(safeAtob(raw));
}

/** Build the full QR deep-link URL for a shop + secret. */
export function buildQrUrl(shop: Address, secret: string, baseUrl: string = HOST_BASE_URL): string {
	return `${baseUrl}/miniapps/${SLUG}?data=${encodeQrPayload({ shop, secret })}`;
}

/** Stamps still needed before the next free coffee. */
export function stampsRemaining(stamps: number, perReward: number): number {
	if (perReward <= 0) return 0;
	const within = stamps % perReward;
	return within === 0 && stamps > 0 ? 0 : perReward - within;
}

/**
 * How many circles to fill on the current card (0..perReward). A completed card
 * (stamps a non-zero multiple of perReward) shows full until the next stamp wraps it.
 */
export function filledStamps(stamps: number, perReward: number): number {
	if (perReward <= 0 || stamps <= 0) return 0;
	const within = stamps % perReward;
	return within === 0 ? perReward : within;
}

/** Count of unredeemed free-coffee rewards. */
export function unredeemedCount(rewards: Array<{ redeemed: boolean }>): number {
	return rewards.filter((r) => !r.redeemed).length;
}

// ─── base64 helpers (UTF-8 safe, work in browser + node/test) ─────────
function btoaUtf8(s: string): string {
	if (typeof btoa === 'function') {
		// Encode UTF-8 → latin1 so btoa accepts non-ASCII safely.
		return btoa(unescape(encodeURIComponent(s)));
	}
	return Buffer.from(s, 'utf8').toString('base64');
}

function safeAtob(s: string): string {
	try {
		if (typeof atob === 'function') return decodeURIComponent(escape(atob(s)));
		return Buffer.from(s, 'base64').toString('utf8');
	} catch {
		return '';
	}
}
