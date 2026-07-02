import { describe, it, expect } from 'vitest';
import { deriveTimeline, causeCopy } from './timeline';
import { makeConfig, makeHistoryItem } from './_fixtures';

const cfg = makeConfig(); // gamma 100

describe('deriveTimeline — attribution', () => {
  it('attributes to behaviour when behaviour_score moves most', () => {
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 100, { behaviour: 50, bStatic: 75, bLegacy: 52, bDelta: 0.14 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 110, { behaviour: 70, bStatic: 75, bLegacy: 52, bDelta: 0.14 })
    ];
    const ev = deriveTimeline(items, cfg);
    expect(ev).toHaveLength(1);
    expect(ev[0].cause).toBe('behaviour');
    expect(ev[0].delta).toBe(10);
  });

  it('attributes to static boost when B_static jumps', () => {
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 100, { behaviour: 50, bStatic: 75, bDelta: 0.14 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 125, { behaviour: 50, bStatic: 100, bDelta: 0.14 })
    ];
    expect(deriveTimeline(items, cfg)[0].cause).toBe('boost-static');
  });

  it('attributes to momentum when gamma*ΔB_delta dominates', () => {
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 100, { behaviour: 50, bStatic: 75, bDelta: 0.1 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 105, { behaviour: 50, bStatic: 75, bDelta: 0.2 })
    ];
    expect(deriveTimeline(items, cfg)[0].cause).toBe('momentum');
  });

  it('flags membership changes', () => {
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 0, { is_member: false }),
      makeHistoryItem('2026-06-22T00:00:00Z', 50, { is_member: true })
    ];
    const ev = deriveTimeline(items, cfg);
    expect(ev[0].cause).toBe('membership');
    expect(ev[0].headline).toBe('Joined the group');
  });

  it('labels join/leave from membership state, not score delta', () => {
    // a join whose score fell — must still read "Joined the group"
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 10, { is_member: false }),
      makeHistoryItem('2026-06-22T00:00:00Z', 5, { is_member: true })
    ];
    expect(deriveTimeline(items, cfg)[0].headline).toBe('Joined the group');
  });

  it('marks near-ties as mixed', () => {
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 100, { behaviour: 50, bStatic: 75 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 120, { behaviour: 60, bStatic: 85 })
    ];
    expect(deriveTimeline(items, cfg)[0].cause).toBe('mixed');
  });
});

describe('deriveTimeline — noise & ordering', () => {
  it('suppresses sub-threshold changes', () => {
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 100, { behaviour: 50 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 103, { behaviour: 51 })
    ];
    expect(deriveTimeline(items, cfg, { minDelta: 5 })).toHaveLength(0);
    expect(deriveTimeline(items, cfg, { minDelta: 1 })).toHaveLength(1);
  });

  it('returns newest first', () => {
    const items = [
      makeHistoryItem('2026-06-20T00:00:00Z', 100, { behaviour: 40 }),
      makeHistoryItem('2026-06-21T00:00:00Z', 110, { behaviour: 60 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 90, { behaviour: 30 })
    ];
    const ev = deriveTimeline(items, cfg);
    expect(ev).toHaveLength(2);
    expect(ev[0].at).toBeGreaterThan(ev[1].at);
  });
});

describe('deriveTimeline — plain-language detail', () => {
  it('names the dominant behaviour sub-driver in headline + detail', () => {
    // retention (R) drops; Q/I unchanged → "weaker retention"
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 100, { behaviour: 70, rBar: 1.0 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 95, { behaviour: 60, rBar: 0.8 })
    ];
    const ev = deriveTimeline(items, cfg);
    expect(ev[0].cause).toBe('behaviour');
    expect(ev[0].headline).toContain('weaker retention');
    expect(ev[0].detail).toMatch(/hold value/i);
  });

  it('names the static boost source that was added', () => {
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 100, { bStatic: 0, staticSources: {} }),
      makeHistoryItem('2026-06-22T00:00:00Z', 125, { bStatic: 75, staticSources: { pay_kyc: 75 } })
    ];
    const ev = deriveTimeline(items, cfg);
    expect(ev[0].cause).toBe('boost-static');
    expect(ev[0].headline).toContain('Verified human (KYC)');
    expect(ev[0].headline).toContain('was added');
  });

  it('explains momentum with the gamma multiplier', () => {
    const items = [
      makeHistoryItem('2026-06-21T00:00:00Z', 100, { behaviour: 50, bStatic: 75, bDelta: 0.1 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 105, { behaviour: 50, bStatic: 75, bDelta: 0.2 })
    ];
    const ev = deriveTimeline(items, cfg);
    expect(ev[0].cause).toBe('momentum');
    expect(ev[0].detail).toContain('×100');
  });

  it('always attaches a non-empty detail line', () => {
    const items = [
      makeHistoryItem('2026-06-20T00:00:00Z', 100, { behaviour: 40 }),
      makeHistoryItem('2026-06-21T00:00:00Z', 120, { behaviour: 60, bStatic: 90 }),
      makeHistoryItem('2026-06-22T00:00:00Z', 50, { is_member: false })
    ];
    for (const e of deriveTimeline(items, cfg)) {
      expect(e.detail && e.detail.length).toBeTruthy();
    }
  });
});

describe('causeCopy', () => {
  it('uses direction-aware wording', () => {
    expect(causeCopy('behaviour', 4)).toContain('rose');
    expect(causeCopy('behaviour', -4)).toContain('fell');
    expect(causeCopy('momentum', 2)).toContain('momentum');
    expect(causeCopy('membership', -1)).toBe('Left the group');
  });
});
