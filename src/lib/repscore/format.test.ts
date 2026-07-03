import { describe, it, expect } from 'vitest';
import {
  shortAddress,
  isValidAddress,
  normalizeAddress,
  fmtSigned,
  fmtPct01,
  fmtCrcFromFloat,
  boRatio,
  fmtRelativeTime
} from './format';

const VALID = '0x0004df58332be821ebd0a2f498c211873e3b8f2C'; // mixed case

describe('address helpers', () => {
  it('shortAddress abbreviates', () => {
    expect(shortAddress(VALID)).toBe(`0x0004…${VALID.slice(-4)}`);
    expect(shortAddress('')).toBe('');
  });
  it('isValidAddress requires 0x + 40 hex', () => {
    expect(isValidAddress(VALID)).toBe(true);
    expect(isValidAddress('0x123')).toBe(false);
    expect(isValidAddress('nope')).toBe(false);
    expect(isValidAddress(null)).toBe(false);
  });
  it('normalizeAddress lowercases valid, null otherwise', () => {
    expect(normalizeAddress('  ' + VALID + '  ')).toBe(VALID.toLowerCase());
    expect(normalizeAddress('0xZZ')).toBeNull();
  });
});

describe('number formatting', () => {
  it('fmtSigned uses real minus and sign', () => {
    expect(fmtSigned(4)).toBe('+4');
    expect(fmtSigned(-2)).toBe('−2');
    expect(fmtSigned(0)).toBe('0');
  });
  it('fmtPct01 scales 0..1', () => {
    expect(fmtPct01(0.396)).toBe('40%');
    expect(fmtPct01(1)).toBe('100%');
  });
  it('fmtCrcFromFloat formats CRC and tiny values', () => {
    expect(fmtCrcFromFloat(945.2271)).toBe('945.23 CRC');
    expect(fmtCrcFromFloat(0.004)).toBe('< 0.01 CRC');
    expect(fmtCrcFromFloat(0)).toBe('0.00 CRC');
  });
  it('boRatio is null when outstanding is 0', () => {
    expect(boRatio(100, 25)).toBe(4);
    expect(boRatio(100, 0)).toBeNull();
  });
});

describe('fmtRelativeTime', () => {
  const now = Date.parse('2026-06-23T12:00:00Z');
  it('buckets into human phrases', () => {
    expect(fmtRelativeTime('2026-06-23T11:59:50Z', now)).toBe('just now');
    expect(fmtRelativeTime('2026-06-23T11:30:00Z', now)).toBe('30 min ago');
    expect(fmtRelativeTime('2026-06-20T12:00:00Z', now)).toBe('3 days ago');
  });
});
