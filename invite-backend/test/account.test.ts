import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readAccount } from '../src/account.ts';

const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

test('returns the account when it is an address', () => {
	assert.equal(readAccount({ account: ADDRESS }), ADDRESS);
	assert.equal(readAccount({ account: ADDRESS.toLowerCase() }), ADDRESS.toLowerCase());
});

test('returns null for a missing or malformed account', () => {
	assert.equal(readAccount({}), null);
	assert.equal(readAccount({ account: '' }), null);
	assert.equal(readAccount({ account: '0x1234' }), null);
});

test('returns null for an account that is not a string', () => {
	for (const account of [123, 1.5, true, null, {}, [], [ADDRESS], { account: ADDRESS }]) {
		assert.equal(readAccount({ account }), null, JSON.stringify(account));
	}
});

test('returns null for a body that is not an object', () => {
	for (const body of [null, 5, 'x', true, []]) {
		assert.equal(readAccount(body), null, JSON.stringify(body));
	}
});
