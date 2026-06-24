import { describe, it, expect } from 'vitest';
import { resolveProfile, searchProfiles } from './profiles';
import { resolveEnv } from './env';
import type { Address } from './types';

const A = '0x0004df58332be821ebd0a2f498c211873e3b8f2c' as Address;

const env = resolveEnv({}); // prod defaults → profileBase .../profiles/profile

/** Fake fetch capturing the URL and returning a canned JSON body. */
function fakeFetch(body: unknown, ok = true) {
  const calls: string[] = [];
  const impl = ((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve({ ok, json: async () => body } as Response);
  }) as typeof fetch;
  return { impl, calls };
}

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

describe('searchProfiles', () => {
  it('hits the /search endpoint (derived from profileBase) with an encoded name', async () => {
    const { impl, calls } = fakeFetch([]);
    await searchProfiles(env, 'Martin Keller', impl);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/profiles/search?');
    expect(calls[0]).not.toContain('/profile/search');
    expect(calls[0]).toContain('name=Martin%20Keller');
  });

  it('maps rows to resolved profiles (lowercased address, identicon fallback)', async () => {
    const { impl } = fakeFetch([
      { name: 'gerva7', address: A.toUpperCase(), avatarType: 'human' }
    ]);
    const out = await searchProfiles(env, 'gerva7', impl);
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe(A); // lowercased
    expect(out[0].name).toBe('gerva7');
    expect(out[0].avatarType).toBe('human');
    expect(out[0].imageUrl.startsWith('data:image/svg+xml,')).toBe(true); // no image → identicon
  });

  it('drops invalid and duplicate addresses', async () => {
    const { impl } = fakeFetch([
      { name: 'ok', address: A },
      { name: 'dupe', address: A }, // same address
      { name: 'bad', address: '0xnothex' } // invalid
    ]);
    const out = await searchProfiles(env, 'x', impl);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('ok');
  });

  it('returns [] for blank input without fetching', async () => {
    const { impl, calls } = fakeFetch([{ name: 'x', address: A }]);
    expect(await searchProfiles(env, '   ', impl)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('returns [] on a non-ok response', async () => {
    const { impl } = fakeFetch({ error: 'nope' }, false);
    expect(await searchProfiles(env, 'gerva7', impl)).toEqual([]);
  });
});
