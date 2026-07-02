import { describe, it, expect } from 'vitest';
import {
  toChartPoints,
  filterByTimeframe,
  downsample,
  summarize,
  buildLinePath,
  nearestIndex,
  type ChartPoint
} from './history';
import { makeHistoryItem } from './_fixtures';

const HOUR = 3600_000;
const DAY = 24 * HOUR;

function pointsEvery(nowIso: number, count: number, stepMs: number, val = 50): ChartPoint[] {
  const out: ChartPoint[] = [];
  for (let i = 0; i < count; i++) out.push({ t: nowIso - (count - 1 - i) * stepMs, live: val, behaviour: 0, boost: 0 });
  return out;
}

describe('toChartPoints', () => {
  it('sorts ascending and clamps live at 0', () => {
    const items = [
      makeHistoryItem('2026-06-23T10:00:00Z', 100),
      makeHistoryItem('2026-06-22T10:00:00Z', -5),
      makeHistoryItem('2026-06-21T10:00:00Z', 30)
    ];
    const pts = toChartPoints(items);
    expect(pts.map((p) => p.live)).toEqual([30, 0, 100]); // ascending by time, -5 clamped to 0
    expect(pts[0].t).toBeLessThan(pts[1].t);
  });

  it('drops unparseable timestamps', () => {
    const items = [makeHistoryItem('not-a-date', 10), makeHistoryItem('2026-06-23T10:00:00Z', 20)];
    expect(toChartPoints(items)).toHaveLength(1);
  });
});

describe('filterByTimeframe', () => {
  const now = Date.parse('2026-06-23T12:00:00Z');
  const pts = [
    { t: now - 40 * DAY, live: 1, behaviour: 0, boost: 0 },
    { t: now - 10 * DAY, live: 2, behaviour: 0, boost: 0 },
    { t: now - 3 * DAY, live: 3, behaviour: 0, boost: 0 },
    { t: now - 2 * HOUR, live: 4, behaviour: 0, boost: 0 }
  ];
  it('24h keeps only last day', () => {
    expect(filterByTimeframe(pts, '24h', now).map((p) => p.live)).toEqual([4]);
  });
  it('7d keeps last week', () => {
    expect(filterByTimeframe(pts, '7d', now).map((p) => p.live)).toEqual([3, 4]);
  });
  it('30d keeps last month', () => {
    expect(filterByTimeframe(pts, '30d', now).map((p) => p.live)).toEqual([2, 3, 4]);
  });
  it('all keeps everything', () => {
    expect(filterByTimeframe(pts, 'all', now)).toHaveLength(4);
  });
});

describe('downsample', () => {
  it('keeps first and last and caps count', () => {
    const pts = pointsEvery(Date.parse('2026-06-23T12:00:00Z'), 1000, HOUR);
    const out = downsample(pts, 50);
    expect(out.length).toBeLessThanOrEqual(51);
    expect(out[0]).toBe(pts[0]);
    expect(out[out.length - 1]).toBe(pts[pts.length - 1]);
  });
  it('returns input when already small', () => {
    const pts = pointsEvery(Date.parse('2026-06-23T12:00:00Z'), 5, HOUR);
    expect(downsample(pts, 120)).toBe(pts);
  });
  it('respects tiny maxPoints (<= 2)', () => {
    const pts = pointsEvery(Date.parse('2026-06-23T12:00:00Z'), 10, HOUR);
    expect(downsample(pts, 2)).toEqual([pts[0], pts[pts.length - 1]]);
    expect(downsample(pts, 1)).toEqual([pts[pts.length - 1]]);
    expect(downsample(pts, 0)).toEqual([]);
  });
});

describe('summarize', () => {
  it('computes delta and pct', () => {
    const s = summarize([
      { t: 1, live: 50, behaviour: 0, boost: 0 },
      { t: 2, live: 75, behaviour: 0, boost: 0 }
    ]);
    expect(s?.deltaAbs).toBe(25);
    expect(s?.deltaPct).toBeCloseTo(50, 6);
    expect(s?.min).toBe(50);
    expect(s?.max).toBe(75);
  });
  it('pct null when first is 0', () => {
    const s = summarize([
      { t: 1, live: 0, behaviour: 0, boost: 0 },
      { t: 2, live: 10, behaviour: 0, boost: 0 }
    ]);
    expect(s?.deltaPct).toBeNull();
  });
  it('null on empty', () => {
    expect(summarize([])).toBeNull();
  });
});

describe('buildLinePath', () => {
  it('produces monotonic-x paths for >=2 points', () => {
    const pts = [
      { t: 0, live: 10, behaviour: 0, boost: 0 },
      { t: 100, live: 20, behaviour: 0, boost: 0 },
      { t: 200, live: 15, behaviour: 0, boost: 0 }
    ];
    const lp = buildLinePath(pts, 300, 100, 10);
    expect(lp.line.startsWith('M ')).toBe(true);
    expect(lp.area.endsWith('Z')).toBe(true);
    for (let i = 1; i < lp.xs.length; i++) expect(lp.xs[i]).toBeGreaterThanOrEqual(lp.xs[i - 1]);
    expect(lp.yMin).toBe(0); // baseline clamped to 0
  });
  it('returns empty paths for <2 points', () => {
    const lp = buildLinePath([{ t: 0, live: 5, behaviour: 0, boost: 0 }], 300, 100, 10);
    expect(lp.line).toBe('');
    expect(lp.area).toBe('');
  });
});

describe('nearestIndex', () => {
  it('finds closest x', () => {
    expect(nearestIndex([0, 10, 20, 30], 16)).toBe(2);
    expect(nearestIndex([0, 10, 20, 30], 4)).toBe(0);
    expect(nearestIndex([], 5)).toBe(-1);
  });
});
