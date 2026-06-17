import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import {
	stampChallenge,
	ownerChallenge,
	redeemChallenge,
	encodeQrPayload,
	decodeAppData,
	buildQrUrl,
	stampsRemaining,
	filledStamps,
	unredeemedCount,
	SLUG
} from './loyalty';

const SHOP = getAddress('0xc12c1e50abb450d6205ea2c3fa861b3b834d13e8');
const CUSTOMER = getAddress('0x000000000000000000000000000000000000dEaD');

describe('challenge strings', () => {
	it('builds a deterministic, checksummed stamp challenge', () => {
		const msg = stampChallenge('0xc12c1e50abb450d6205ea2c3fa861b3b834d13e8', 'abc123');
		expect(msg).toBe(`Coffee Loyalty — collect a stamp\nShop: ${SHOP}\nSecret: abc123`);
	});

	it('owner + redeem challenges are distinct and checksummed', () => {
		expect(ownerChallenge(SHOP, '2026-06-17')).toContain('owner dashboard');
		expect(redeemChallenge(CUSTOMER, '7')).toBe(
			`Coffee Loyalty — redeem free coffee\nCustomer: ${CUSTOMER}\nToken: 7`
		);
	});
});

describe('QR payload encode/decode round-trip', () => {
	it('encodes to base64 and decodes back to a checksummed payload', () => {
		const encoded = encodeQrPayload({ shop: SHOP, secret: 'deadbeef' });
		// Host hands us the already-decoded JSON string.
		const decodedJson = atob(encoded);
		const payload = decodeAppData(decodedJson);
		expect(payload).toEqual({ shop: SHOP, secret: 'deadbeef' });
	});

	it('also decodes when the host passes the base64 verbatim', () => {
		const encoded = encodeQrPayload({ shop: SHOP, secret: 'x1' });
		expect(decodeAppData(encoded)).toEqual({ shop: SHOP, secret: 'x1' });
	});

	it('returns null for garbage', () => {
		expect(decodeAppData('not json')).toBeNull();
		expect(decodeAppData('')).toBeNull();
	});

	it('builds a host deep link carrying the payload', () => {
		const url = buildQrUrl(SHOP, 'sec');
		expect(url).toContain(`/miniapps/${SLUG}?data=`);
		const data = new URL(url).searchParams.get('data')!;
		expect(decodeAppData(atob(data))).toEqual({ shop: SHOP, secret: 'sec' });
	});
});

describe('stampsRemaining', () => {
	it('counts down within a card', () => {
		expect(stampsRemaining(0, 10)).toBe(10);
		expect(stampsRemaining(1, 10)).toBe(9);
		expect(stampsRemaining(9, 10)).toBe(1);
	});

	it('a full card (multiple of perReward) shows 0 remaining', () => {
		expect(stampsRemaining(10, 10)).toBe(0);
		expect(stampsRemaining(20, 10)).toBe(0);
	});

	it('wraps after a reward', () => {
		expect(stampsRemaining(11, 10)).toBe(9);
	});
});

describe('filledStamps', () => {
	it('fills within a card', () => {
		expect(filledStamps(0, 10)).toBe(0);
		expect(filledStamps(3, 10)).toBe(3);
		expect(filledStamps(9, 10)).toBe(9);
	});

	it('a completed card is full, wrapping after the next stamp', () => {
		expect(filledStamps(10, 10)).toBe(10);
		expect(filledStamps(11, 10)).toBe(1);
		expect(filledStamps(20, 10)).toBe(10);
	});
});

describe('unredeemedCount', () => {
	it('counts only unredeemed rewards', () => {
		expect(
			unredeemedCount([{ redeemed: false }, { redeemed: true }, { redeemed: false }])
		).toBe(2);
		expect(unredeemedCount([])).toBe(0);
	});
});
