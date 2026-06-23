import { describe, it, expect } from 'vitest';
import { resolveEnv, STAGING, PROD, DEFAULT_GROUP_ID } from './env';

describe('resolveEnv', () => {
  it('defaults to staging with search enabled', () => {
    const e = resolveEnv({});
    expect(e.repBase).toBe(STAGING.rep);
    expect(e.rpcBase).toBe(STAGING.rpc);
    expect(e.profileBase).toBe(STAGING.profile);
    expect(e.groupId).toBe(DEFAULT_GROUP_ID);
    expect(e.searchEnabled).toBe(true);
  });

  it('applies prod overrides', () => {
    const e = resolveEnv({
      VITE_REP_SCORE_BASE: PROD.rep,
      VITE_REP_SCORE_RPC_BASE: PROD.rpc,
      VITE_REP_SCORE_PROFILE_BASE: PROD.profile
    });
    expect(e.repBase).toBe(PROD.rep);
    expect(e.rpcBase).toBe(PROD.rpc);
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
