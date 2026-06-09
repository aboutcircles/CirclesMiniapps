import { describe, it, expect } from 'vitest';
import { checkTransactions, SAFE_MGMT_SELECTORS } from './txPolicy.ts';

const SAFE = '0xAAAAaaAAaaaaaAaaAAAaaaAAAaaAaaaaaaaaaaaA';
const PRIMARY = '0xBBBBbbBBBBBBBBBbbbbBBBBBBBBBBBBBbbbBBBBB';
const OTHER = '0xCCCCccCCCCCCCccccccCCCCCCCccccCcccCCCCcc';
// keccak256("transfer(address,uint256)")[:4]
const ERC20_TRANSFER = '0xa9059cbb';

describe('checkTransactions', () => {
	it('allows a normal ERC20 transfer to an unrelated address', () => {
		const r = checkTransactions(
			[{ to: OTHER, data: ERC20_TRANSFER + '0'.repeat(128), value: '0' }],
			[SAFE]
		);
		expect(r.allowed).toBe(true);
	});

	it('allows a plain value transfer with no calldata', () => {
		const r = checkTransactions([{ to: OTHER, value: '1000' }], [SAFE]);
		expect(r.allowed).toBe(true);
	});

	it('blocks a direct call to the safe address', () => {
		const r = checkTransactions([{ to: SAFE }], [SAFE]);
		expect(r.allowed).toBe(false);
	});

	it('blocks regardless of address case', () => {
		const r = checkTransactions([{ to: SAFE.toLowerCase() }], [SAFE.toUpperCase()]);
		expect(r.allowed).toBe(false);
	});

	it('blocks every Safe management selector against an arbitrary target', () => {
		for (const sel of SAFE_MGMT_SELECTORS) {
			const r = checkTransactions([{ to: OTHER, data: sel + '0'.repeat(64) }], [SAFE]);
			expect(r.allowed, `selector ${sel} should be blocked`).toBe(false);
		}
	});

	it('blocks management selectors in uppercase too', () => {
		const r = checkTransactions(
			[{ to: OTHER, data: '0x0D582F13' + '0'.repeat(64) }],
			[SAFE]
		);
		expect(r.allowed).toBe(false);
	});

	it('blocks calls to the primary safe in child-safe mode', () => {
		const r = checkTransactions([{ to: PRIMARY }], [SAFE, PRIMARY]);
		expect(r.allowed).toBe(false);
	});

	it('rejects the whole batch if any tx fails', () => {
		const r = checkTransactions(
			[{ to: OTHER, data: ERC20_TRANSFER }, { to: SAFE }],
			[SAFE]
		);
		expect(r.allowed).toBe(false);
		if (!r.allowed) expect(r.reason).toMatch(/Transaction 1/);
	});

	it('rejects a tx with missing "to"', () => {
		const r = checkTransactions([{ to: '' }], [SAFE]);
		expect(r.allowed).toBe(false);
	});

	it('ignores empty entries in protectedSafes', () => {
		const r = checkTransactions([{ to: OTHER }], ['', SAFE, '']);
		expect(r.allowed).toBe(true);
	});

	it('allows empty batches', () => {
		const r = checkTransactions([], [SAFE]);
		expect(r.allowed).toBe(true);
	});
});
