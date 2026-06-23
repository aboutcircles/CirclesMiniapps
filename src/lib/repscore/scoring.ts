/**
 * Rep Score Explorer — score maths (pure). Mirrors the advanced-analytics
 * pipeline, verified numerically against the live staging API:
 *
 *   s_b          = wR·R_bar + wQ·Q_bar + wI·I_bar            (weights from /config)
 *   s_eff        = s_b                                       (while propagation is off)
 *   base         = 100·(2·s_eff − 1)
 *   B_total      = max(B_static, B_legacy) + gamma·B_delta   (gamma from /config)
 *   s_user_raw   = base + B_total
 *   s_user_gated = s_user_raw · liveness_factor
 *   reputation_score_live = round(s_user_gated)
 *   s_user (clipped)      = clamp(s_user_gated, 0, 100)
 *
 * Headline shown to users = max(0, reputation_score_live) — never negative.
 * gamma and weights are ALWAYS read from config, never hardcoded.
 */

import type { AvatarScore, BehaviourComponent, RepConfig } from './types';

function clamp(x: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, x));
}

export interface DerivedScore {
	// behaviour
	sB: number;
	sEff: number;
	// composition
	base: number;
	// boost parts
	bStatic: number;
	bLegacy: number;
	bDelta: number;
	gamma: number;
	legacyActive: boolean;
	bTotal: number;
	// assembly
	sUserRaw: number;
	livenessFactor: number;
	sUserGated: number;
	liveRounded: number; // round(sUserGated)
	apiLive: number; // reputation_score_live straight off the payload (authoritative)
	clipped: number; // s_user, clamped 0..100
	headline: number; // max(0, apiLive) — what the user sees
	isNegative: boolean; // apiLive < 0
}

/** Cheap header path: the authoritative live score, floored at 0. */
export function headlineScore(a: Pick<AvatarScore, 'reputation_score_live'>): number {
	return Math.max(0, Math.round(a.reputation_score_live ?? 0));
}

function gammaOf(cfg: RepConfig): number {
	const g = cfg?.defaults?.boost?.delta?.gamma;
	return typeof g === 'number' ? g : 0;
}

/**
 * Full pipeline derivation. Recomputes each stage from `components` using
 * config-driven gamma/weights (so the breakdown is internally consistent and
 * unit-testable), while taking the authoritative live score from the payload.
 */
export function deriveScore(a: AvatarScore, cfg: RepConfig): DerivedScore {
	const apiLive = Math.round(a.reputation_score_live ?? 0);
	const c = a.components;

	if (!c) {
		// Non-member / slim payload — no pipeline to recompute.
		return {
			sB: 0,
			sEff: 0,
			base: 0,
			bStatic: 0,
			bLegacy: 0,
			bDelta: 0,
			gamma: gammaOf(cfg),
			legacyActive: false,
			bTotal: 0,
			sUserRaw: 0,
			livenessFactor: 1,
			sUserGated: 0,
			liveRounded: apiLive,
			apiLive,
			clipped: clamp(apiLive, 0, 100),
			headline: Math.max(0, apiLive),
			isNegative: apiLive < 0
		};
	}

	const bd = behaviourBreakdown(c.behaviour, cfg);
	const sB = bd.sB;
	const sEff = typeof c.propagation?.s_eff === 'number' ? c.propagation.s_eff : sB;

	const base = 100 * (2 * sEff - 1);

	const gamma = gammaOf(cfg);
	const bStatic = c.boost.B_static ?? 0;
	const bLegacy = c.boost.B_legacy ?? 0;
	const bDelta = c.boost.B_delta ?? 0;
	const bTotal = Math.max(bStatic, bLegacy) + gamma * bDelta;

	const sUserRaw = base + bTotal;
	const livenessFactor =
		typeof c.gate?.live?.liveness_factor === 'number' ? c.gate.live.liveness_factor : 1;
	const sUserGated = sUserRaw * livenessFactor;
	const liveRounded = Math.round(sUserGated);
	const clipped = clamp(sUserGated, 0, 100);

	return {
		sB,
		sEff,
		base,
		bStatic,
		bLegacy,
		bDelta,
		gamma,
		legacyActive: Boolean(c.boost.B_legacy_active),
		bTotal,
		sUserRaw,
		livenessFactor,
		sUserGated,
		liveRounded,
		apiLive,
		clipped,
		headline: Math.max(0, apiLive),
		isNegative: apiLive < 0
	};
}

export interface BehaviourBreakdown {
	rContribution: number;
	qContribution: number;
	iContribution: number;
	sB: number;
	weights: { R: number; Q: number; I: number };
}

/** Per-metric weighted contributions to s_b, weights read from config. */
export function behaviourBreakdown(b: BehaviourComponent, cfg: RepConfig): BehaviourBreakdown {
	const w = cfg?.defaults?.behaviour?.weights ?? { R: 0, Q: 0, I: 0 };
	const rContribution = w.R * b.R_bar;
	const qContribution = w.Q * b.Q_bar;
	const iContribution = w.I * b.I_bar;
	return {
		rContribution,
		qContribution,
		iContribution,
		sB: rContribution + qContribution + iContribution,
		weights: { R: w.R, Q: w.Q, I: w.I }
	};
}

export type ScoreBand = 'none' | 'low' | 'medium' | 'high';

/** Coarse band for colour/copy. 0 | 1–33 | 34–66 | 67–100. */
export function scoreBand(headline: number): ScoreBand {
	if (headline <= 0) return 'none';
	if (headline <= 33) return 'low';
	if (headline <= 66) return 'medium';
	return 'high';
}
