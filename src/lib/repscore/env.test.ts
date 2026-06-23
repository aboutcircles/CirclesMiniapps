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

  it('enables debug only on explicit "true"', () => {
    expect(resolveEnv({ VITE_REP_SCORE_DEBUG: 'true' }).debug).toBe(true);
    expect(resolveEnv({ VITE_REP_SCORE_DEBUG: 'false' }).debug).toBe(false);
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
  });

  it('disables search only on explicit "false"', () => {
    expect(resolveEnv({ VITE_REP_SCORE_SEARCH_ENABLED: 'false' }).searchEnabled).toBe(false);
    expect(resolveEnv({ VITE_REP_SCORE_SEARCH_ENABLED: 'true' }).searchEnabled).toBe(true);
    expect(resolveEnv({ VITE_REP_SCORE_SEARCH_ENABLED: 'anything' }).searchEnabled).toBe(true);
  });

  it('overrides group id', () => {
    expect(resolveEnv({ VITE_REP_SCORE_GROUP_ID: 'other' }).groupId).toBe('other');
  });
});
