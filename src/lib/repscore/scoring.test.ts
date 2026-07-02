import { describe, it, expect } from 'vitest';
import { deriveScore, headlineScore, behaviourBreakdown, scoreBand } from './scoring';
import { makeConfig, gervaAvatar, nonMemberAvatar } from './_fixtures';

describe('scoring — verified gerva7 numbers', () => {
  const cfg = makeConfig();
  const d = deriveScore(gervaAvatar(), cfg);

  it('reproduces s_b from config weights', () => {
    expect(d.sB).toBeCloseTo(0.5991165036188169, 9);
    expect(d.sEff).toBeCloseTo(0.5991165036188169, 9);
  });

  it('reproduces base = 100*(2*s_eff - 1)', () => {
    expect(d.base).toBeCloseTo(19.8233007, 5);
  });

  it('reproduces B_total = max(B_static, B_legacy) + gamma*B_delta', () => {
    // max(75, 52.38) + 100*0.144231 = 89.4231
    expect(d.bTotal).toBeCloseTo(89.4231198, 5);
  });

  it('reproduces s_user_raw = base + B_total', () => {
    expect(d.sUserRaw).toBeCloseTo(109.2464205, 5);
  });

  it('gates by liveness and rounds to live score', () => {
    expect(d.livenessFactor).toBe(1);
    expect(d.sUserGated).toBeCloseTo(109.2464205, 5);
    expect(d.liveRounded).toBe(109);
  });

  it('headline is the authoritative live score, clipped is 0..100', () => {
    expect(d.headline).toBe(109);
    expect(d.clipped).toBe(100);
    expect(d.isNegative).toBe(false);
  });
});

describe('scoring — config drives gamma (not hardcoded)', () => {
  it('changing gamma changes B_total and raw', () => {
    const base = deriveScore(gervaAvatar(), makeConfig({ gamma: 100 }));
    const noMomentum = deriveScore(gervaAvatar(), makeConfig({ gamma: 0 }));
    // with gamma 0, B_total collapses to max(B_static, B_legacy) = 75
    expect(noMomentum.bTotal).toBeCloseTo(75, 6);
    expect(noMomentum.sUserRaw).toBeLessThan(base.sUserRaw);
  });
});

describe('scoring — legacy via max()', () => {
  it('uses B_legacy when it exceeds B_static', () => {
    const a = gervaAvatar();
    a.components!.boost.B_legacy = 200; // now legacy wins the max()
    a.components!.boost.B_legacy_active = true;
    const d = deriveScore(a, makeConfig());
    // 200 + 100*0.144231 = 214.42
    expect(d.bTotal).toBeCloseTo(214.4231198, 4);
    expect(d.legacyActive).toBe(true);
  });
});

describe('scoring — negative & headline', () => {
  it('never shows a negative headline; flags isNegative', () => {
    const a = gervaAvatar();
    a.reputation_score_live = -7;
    const d = deriveScore(a, makeConfig());
    expect(d.headline).toBe(0);
    expect(d.isNegative).toBe(true);
  });

  it('headlineScore floors at 0 and rounds', () => {
    expect(headlineScore({ reputation_score_live: 108.6 })).toBe(109);
    expect(headlineScore({ reputation_score_live: -3 })).toBe(0);
  });
});

describe('scoring — non-member slim payload', () => {
  it('degrades gracefully without components', () => {
    const d = deriveScore(nonMemberAvatar(), makeConfig());
    expect(d.headline).toBe(0);
    expect(d.base).toBe(0);
    expect(d.bTotal).toBe(0);
  });
});

describe('behaviourBreakdown', () => {
  it('weights each metric and sums to s_b', () => {
    const b = behaviourBreakdown(gervaAvatar().components!.behaviour, makeConfig());
    expect(b.rContribution).toBeCloseTo(0.5, 9); // 0.5 * 1.0
    expect(b.qContribution).toBeCloseTo(0, 9); // 0.25 * 0
    expect(b.iContribution).toBeCloseTo(0.0991165, 6); // 0.25 * 0.396466
    expect(b.sB).toBeCloseTo(0.5991165, 6);
  });
});

describe('scoreBand', () => {
  it('bands by headline', () => {
    expect(scoreBand(0)).toBe('none');
    expect(scoreBand(20)).toBe('low');
    expect(scoreBand(50)).toBe('medium');
    expect(scoreBand(109)).toBe('high');
  });
});
