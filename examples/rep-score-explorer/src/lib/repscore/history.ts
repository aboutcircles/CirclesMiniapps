/**
 * Rep Score Explorer — history → chart transforms (pure). No DOM.
 *
 * The plotted headline series is max(0, reputation_score_live) to match what
 * the user sees in the header (never negative).
 */

import type { HistoryItem } from './types';

export type Timeframe = '24h' | '7d' | '30d' | 'all';

export interface ChartPoint {
	t: number; // epoch ms
	live: number; // plotted series: max(0, reputation_score_live)
	behaviour: number;
	boost: number;
}

const TIMEFRAME_MS: Record<Exclude<Timeframe, 'all'>, number> = {
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
	'30d': 30 * 24 * 60 * 60 * 1000
};

/** Map raw history items → chart points, sorted ascending by time. */
export function toChartPoints(items: HistoryItem[]): ChartPoint[] {
	return items
		.map((it) => ({
			t: Date.parse(it.snapshot_at),
			live: Math.max(0, Math.round(it.reputation_score_live ?? 0)),
			behaviour: it.behaviour_score ?? 0,
			boost: it.boost_score ?? 0
		}))
		.filter((p) => Number.isFinite(p.t))
		.sort((a, b) => a.t - b.t);
}

/** Client-side timeframe filter relative to `now`. */
export function filterByTimeframe(points: ChartPoint[], tf: Timeframe, now: number): ChartPoint[] {
	if (tf === 'all') return points;
	const cutoff = now - TIMEFRAME_MS[tf];
	return points.filter((p) => p.t >= cutoff);
}

/** Cap rendered points by even stride to keep the SVG light; always keep first + last. */
export function downsample(points: ChartPoint[], maxPoints: number): ChartPoint[] {
	if (points.length === 0) return points;
	if (maxPoints <= 0) return [];
	if (maxPoints === 1) return [points[points.length - 1]];
	if (points.length <= maxPoints) return points;
	const out: ChartPoint[] = [];
	const stride = (points.length - 1) / (maxPoints - 1);
	for (let i = 0; i < maxPoints; i++) {
		out.push(points[Math.round(i * stride)]);
	}
	// guarantee last point present
	if (out[out.length - 1] !== points[points.length - 1]) out.push(points[points.length - 1]);
	return out;
}

export interface ChartSummary {
	first: number;
	last: number;
	min: number;
	max: number;
	deltaAbs: number;
	deltaPct: number | null; // null when first === 0 (undefined %)
}

export function summarize(points: ChartPoint[]): ChartSummary | null {
	if (points.length === 0) return null;
	const vals = points.map((p) => p.live);
	const first = vals[0];
	const last = vals[vals.length - 1];
	return {
		first,
		last,
		min: Math.min(...vals),
		max: Math.max(...vals),
		deltaAbs: last - first,
		deltaPct: first === 0 ? null : ((last - first) / first) * 100
	};
}

export interface LinePath {
	line: string; // SVG path `d` for the stroke
	area: string; // SVG path `d` for the filled area (closed to baseline)
	xs: number[];
	ys: number[];
	yMin: number;
	yMax: number;
}

/** "Nice" lower/upper bounds for the y-axis, clamped at 0 and padded a touch. */
function niceBounds(min: number, max: number): { lo: number; hi: number } {
	let lo = Math.min(0, min);
	let hi = max;
	if (hi === lo) hi = lo + 1;
	const pad = (hi - lo) * 0.08;
	lo = Math.max(0, lo - pad);
	hi = hi + pad;
	return { lo, hi };
}

/**
 * Build SVG path strings mapping points into a `w`×`h` box with `pad` inset.
 * Deterministic given fixed dimensions — unit-tested. With <2 points returns
 * empty paths (caller renders a single marker / empty-state instead).
 */
export function buildLinePath(points: ChartPoint[], w: number, h: number, pad: number): LinePath {
	const innerW = w - pad * 2;
	const innerH = h - pad * 2;
	const { lo, hi } = niceBounds(
		points.length ? Math.min(...points.map((p) => p.live)) : 0,
		points.length ? Math.max(...points.map((p) => p.live)) : 1
	);

	const tMin = points.length ? points[0].t : 0;
	const tMax = points.length ? points[points.length - 1].t : 1;
	const tSpan = tMax - tMin || 1;

	const xs: number[] = [];
	const ys: number[] = [];
	for (const p of points) {
		const x = pad + ((p.t - tMin) / tSpan) * innerW;
		const y = pad + (1 - (p.live - lo) / (hi - lo)) * innerH;
		xs.push(x);
		ys.push(y);
	}

	if (points.length < 2) {
		return { line: '', area: '', xs, ys, yMin: lo, yMax: hi };
	}

	let line = `M ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}`;
	for (let i = 1; i < xs.length; i++) line += ` L ${xs[i].toFixed(2)} ${ys[i].toFixed(2)}`;

	const baseY = (h - pad).toFixed(2);
	const area =
		`M ${xs[0].toFixed(2)} ${baseY}` +
		` L ${xs[0].toFixed(2)} ${ys[0].toFixed(2)}` +
		xs
			.slice(1)
			.map((x, i) => ` L ${x.toFixed(2)} ${ys[i + 1].toFixed(2)}`)
			.join('') +
		` L ${xs[xs.length - 1].toFixed(2)} ${baseY} Z`;

	return { line, area, xs, ys, yMin: lo, yMax: hi };
}

/** Index of the point whose x is nearest to `px` (for tooltip/hover). */
export function nearestIndex(xs: number[], px: number): number {
	if (xs.length === 0) return -1;
	let best = 0;
	let bestD = Infinity;
	for (let i = 0; i < xs.length; i++) {
		const d = Math.abs(xs[i] - px);
		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}
	return best;
}
