import { describe, it, expect } from 'vitest';
import { resolveProfile } from './profiles';
import type { Address } from './types';

const A = '0x0004df58332be821ebd0a2f498c211873e3b8f2c' as Address;

describe('resolveProfile — name precedence', () => {
  it('prefers name', () => {
    expect(resolveProfile(A, { name: 'gerva7', registeredName: 'reg' }).name).toBe('gerva7');
  });
  it('treats whitespace-only name as empty and uses registeredName', () => {
    expect(resolveProfile(A, { name: '   ', registeredName: 'reg' }).name).toBe('reg');
  });
  it('falls back to registeredName', () => {
    expect(resolveProfile(A, { registeredName: 'reg' }).name).toBe('reg');
  });
  it('falls back to short address', () => {
    expect(resolveProfile(A, null).name).toBe('0x0004…8f2c');
  });
});

describe('resolveProfile — image precedence & fallback', () => {
  it('prefers imageUrl', () => {
    const p = resolveProfile(A, { imageUrl: 'https://x/y.png', previewImageUrl: 'https://x/p.png' });
    expect(p.imageUrl).toBe('https://x/y.png');
    expect(p.hasRealImage).toBe(true);
  });
  it('falls back to previewImageUrl', () => {
    const p = resolveProfile(A, { previewImageUrl: 'https://x/p.png' });
    expect(p.imageUrl).toBe('https://x/p.png');
    expect(p.hasRealImage).toBe(true);
  });
  it('treats whitespace-only imageUrl as empty and uses previewImageUrl', () => {
    const p = resolveProfile(A, { imageUrl: '   ', previewImageUrl: 'https://x/p.png' });
    expect(p.imageUrl).toBe('https://x/p.png');
    expect(p.hasRealImage).toBe(true);
  });
  it('falls back to identicon when no image', () => {
    const p = resolveProfile(A, { name: 'gerva7' });
    expect(p.hasRealImage).toBe(false);
    expect(p.imageUrl.startsWith('data:image/svg+xml,')).toBe(true);
  });
});

describe('resolveProfile — avatarType normalisation', () => {
  it('normalises raw RPC spellings', () => {
    expect(resolveProfile(A, { avatarType: 'CrcV2_RegisterHuman' }).avatarType).toBe('human');
    expect(resolveProfile(A, { avatarType: 'organization' }).avatarType).toBe('organization');
    expect(resolveProfile(A, { avatarType: 'unknown' }).avatarType).toBeNull();
    expect(resolveProfile(A, null).avatarType).toBeNull();
  });
});
