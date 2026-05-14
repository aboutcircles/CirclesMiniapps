import { describe, it, expect } from 'vitest';
import { formatCrc, shortAddr, ipfsToHttp } from './clients.js';

describe('formatCrc', () => {
  it('returns "—" for null/undefined', () => {
    expect(formatCrc(null)).toBe('—');
    expect(formatCrc(undefined)).toBe('—');
  });

  it('formats whole-unit amounts without a fractional part', () => {
    expect(formatCrc(0n)).toBe('0');
    expect(formatCrc(1n * 10n ** 18n)).toBe('1');
    expect(formatCrc(42n * 10n ** 18n)).toBe('42');
  });

  it('formats sub-unit amounts with up to 4 trimmed fractional digits', () => {
    expect(formatCrc(5n * 10n ** 17n)).toBe('0.5');
    expect(formatCrc(12345n * 10n ** 13n)).toBe('0.1234');
    expect(formatCrc(15n * 10n ** 17n)).toBe('1.5');
  });

  it('trims trailing zeros in the fractional part', () => {
    expect(formatCrc(150n * 10n ** 16n)).toBe('1.5');
    expect(formatCrc(1000n * 10n ** 15n)).toBe('1');
  });

  it('accepts a stringified number', () => {
    expect(formatCrc('1000000000000000000')).toBe('1');
  });
});

describe('shortAddr', () => {
  it('returns "" for falsy input', () => {
    expect(shortAddr(null)).toBe('');
    expect(shortAddr('')).toBe('');
    expect(shortAddr(undefined)).toBe('');
  });

  it('formats a full Ethereum address with an ellipsis', () => {
    expect(shortAddr('0xeeF7B1f06B092625228C835Dd5D5B14641D1e54A'))
      .toBe('0xeeF7…e54A');
  });
});

describe('ipfsToHttp', () => {
  it('returns null for falsy input', () => {
    expect(ipfsToHttp(null)).toBeNull();
    expect(ipfsToHttp('')).toBeNull();
  });

  it('rewrites an ipfs:// URI to the dweb.link subdomain gateway', () => {
    expect(ipfsToHttp('ipfs://QmExample123'))
      .toBe('https://QmExample123.ipfs.dweb.link');
  });

  it('passes through https:// URIs unchanged', () => {
    expect(ipfsToHttp('https://example.com/image.png'))
      .toBe('https://example.com/image.png');
  });
});
