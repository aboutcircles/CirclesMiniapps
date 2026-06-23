import { describe, it, expect } from 'vitest';
import { resolveEnv, STAGING, PROD, DEFAULT_GROUP_ID } from './env';

describe('resolveEnv', () => {
  it('defaults to production with search enabled and debug off', () => {
    const e = resolveEnv({});
    expect(e.repBase).toBe(PROD.rep);
    expect(e.rpcBase).toBe(PROD.rpc);
    expect(e.profileBase).toBe(PROD.profile);
    expect(e.groupId).toBe(DEFAULT_GROUP_ID);
    expect(e.searchEnabled).toBe(true);
    expect(e.debug).toBe(false);
  });

  it('enables debug only on truthy values; 0/no/off/empty stay off', () => {
    for (const v of ['true', '1', 'yes', 'on', 'TRUE']) {
      expect(resolveEnv({ VITE_REP_SCORE_DEBUG: v }).debug).toBe(true);
    }
    for (const v of ['false', '0', 'no', 'off', '', 'anything']) {
      expect(resolveEnv({ VITE_REP_SCORE_DEBUG: v }).debug).toBe(false);
    }
    expect(resolveEnv({}).debug).toBe(false);
  });

  it('applies staging overrides', () => {
    const e = resolveEnv({
      VITE_REP_SCORE_BASE: STAGING.rep,
      VITE_REP_SCORE_RPC_BASE: STAGING.rpc,
      VITE_REP_SCORE_PROFILE_BASE: STAGING.profile
    });
    expect(e.repBase).toBe(STAGING.rep);
    expect(e.rpcBase).toBe(STAGING.rpc);
    expect(e.profileBase).toBe(STAGING.profile);
  });

  it('treats whitespace-only overrides as unset (falls back to defaults)', () => {
    const e = resolveEnv({ VITE_REP_SCORE_BASE: '   ', VITE_REP_SCORE_GROUP_ID: '  ' });
    expect(e.repBase).toBe(PROD.rep);
    expect(e.groupId).toBe(DEFAULT_GROUP_ID);
  });

  it('disables search on false/0/off; default true otherwise', () => {
    for (const v of ['false', '0', 'off', 'no']) {
      expect(resolveEnv({ VITE_REP_SCORE_SEARCH_ENABLED: v }).searchEnabled).toBe(false);
    }
    expect(resolveEnv({ VITE_REP_SCORE_SEARCH_ENABLED: 'true' }).searchEnabled).toBe(true);
    expect(resolveEnv({ VITE_REP_SCORE_SEARCH_ENABLED: 'anything' }).searchEnabled).toBe(true);
  });

  it('overrides group id', () => {
    expect(resolveEnv({ VITE_REP_SCORE_GROUP_ID: 'other' }).groupId).toBe('other');
  });
});
