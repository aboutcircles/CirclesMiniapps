import { describe, it, expect } from 'vitest';
import { buildPaymentData, parsePaymentData, newNonce } from './_intent.js';

const SECRET = 'test-secret-do-not-use-in-prod-' + 'a'.repeat(32);

const SAMPLE_INTENT = {
  v: 1,
  c: '0x1111111111111111111111111111111111111111',
  t: '42',
  b: '0x2222222222222222222222222222222222222222',
  s: '0x3333333333333333333333333333333333333333',
  p: '1000000000000000000',
  x: 1_900_000_000,
  n: 'abc123',
};

describe('buildPaymentData / parsePaymentData round-trip', () => {
  it('produces a `crc-nft.<payload>.<sig>` string', () => {
    const pd = buildPaymentData(SAMPLE_INTENT, SECRET);
    expect(pd.split('.').length).toBe(3);
    expect(pd.startsWith('crc-nft.')).toBe(true);
  });

  it('round-trips an intent unchanged', () => {
    const pd = buildPaymentData(SAMPLE_INTENT, SECRET);
    const back = parsePaymentData(pd, SECRET);
    expect(back).toEqual(SAMPLE_INTENT);
  });

  it('rejects a payload tampered after signing', () => {
    const pd = buildPaymentData(SAMPLE_INTENT, SECRET);
    const [, payload, sig] = pd.split('.');
    // Flip one character in the payload.
    const tampered = `crc-nft.${payload.slice(0, -1)}X.${sig}`;
    expect(() => parsePaymentData(tampered, SECRET)).toThrow(/HMAC|payload/);
  });

  it('rejects when verified with the wrong secret', () => {
    const pd = buildPaymentData(SAMPLE_INTENT, SECRET);
    expect(() => parsePaymentData(pd, 'a-different-secret-with-enough-length-1234567890'))
      .toThrow(/HMAC/);
  });

  it('rejects a malformed prefix', () => {
    expect(() => parsePaymentData('foo.bar.baz', SECRET)).toThrow(/malformed/);
  });

  it('rejects unsupported version', () => {
    const pd = buildPaymentData({ ...SAMPLE_INTENT, v: 99 }, SECRET);
    expect(() => parsePaymentData(pd, SECRET)).toThrow(/version/);
  });

  it('requires a secret', () => {
    expect(() => buildPaymentData(SAMPLE_INTENT, '')).toThrow(/secret/);
    expect(() => parsePaymentData('crc-nft.x.y', '')).toThrow(/secret/);
  });
});

describe('newNonce', () => {
  it('returns a base64url string', () => {
    const n = newNonce();
    expect(typeof n).toBe('string');
    expect(n.length).toBeGreaterThan(8);
    // base64url alphabet only
    expect(n).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is unique across calls', () => {
    const seen = new Set();
    for (let i = 0; i < 32; i++) seen.add(newNonce());
    expect(seen.size).toBe(32);
  });
});
