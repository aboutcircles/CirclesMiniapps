/**
 * Rep Score Explorer — event timeline derivation (pure). No DOM.
 *
 * Diffs consecutive /history ticks and attributes each score change to the
 * component that moved the most, in plain language. Momentum uses gamma from
 * config (gamma·ΔB_delta) so it stays config-driven.
 *
 * Each event also carries a `detail` line that names the *specific* sub-driver
 * behind the change — which behaviour metric moved (retention / outflow
 * discipline / qualified inflow), which boost source was added/removed, what
 * "momentum" actually means — using the same human labels as the Breakdown
 * panel so the two views stay consistent.
 */

import type { HistoryItem, RepConfig } from './types';

export type CauseKind =
	| 'behaviour'
	| 'boost-static'
	| 'boost-legacy'
	| 'momentum'
	| 'gate'
	| 'membership'
	| 'mixed';

export interface TimelineEvent {
	at: number; // epoch ms of the later tick
	fromLive: number;
	toLive: number;
	delta: number; // toLive - fromLive (using displayed max(0,live))
	cause: CauseKind;
	headline: string;
	detail?: string;
}

function displayLive(it: HistoryItem): number {
	return Math.max(0, Math.round(it.reputation_score_live ?? 0));
}

function staticTotal(it: HistoryItem): number {
	return it.components?.boost?.B_static ?? 0;
}
function legacyTotal(it: HistoryItem): number {
	return it.components?.boost?.B_legacy ?? 0;
}
function deltaMem(it: HistoryItem): number {
	return it.components?.boost?.B_delta ?? 0;
}

function cap(s: string): string {
	return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "Reputation rose/fell N pt(s) — <reason>". */
function repLine(delta: number, reason: string): string {
	const dir = delta > 0 ? 'rose' : 'fell';
	const pts = `${Math.abs(delta)} pt${Math.abs(delta) === 1 ? '' : 's'}`;
	return `Reputation ${dir} ${pts} — ${reason}`;
}

/** Human copy for a cause + direction (headline only; see describeChange for detail). */
export function causeCopy(cause: CauseKind, delta: number): string {
	switch (cause) {
		case 'behaviour':
			return repLine(delta, 'behaviour changed');
		case 'boost-static':
			return repLine(delta, `a boost ${delta > 0 ? 'was added' : 'changed'}`);
		case 'boost-legacy':
			return repLine(delta, 'legacy credit changed');
		case 'momentum':
			return repLine(delta, 'recent momentum');
		case 'gate':
			return repLine(delta, 'liveness changed');
		case 'membership':
			return delta >= 0 ? 'Joined the group' : 'Left the group';
		default:
			return repLine(delta, 'several factors moved');
	}
}

// ── Sub-driver labels (kept in step with BreakdownPanel.svelte) ──────────────

const BEHAVIOUR_DRIVERS: Record<'R' | 'Q' | 'I', { label: string; explain: string }> = {
	R: { label: 'retention', explain: 'how steadily you hold value rather than passing it straight through' },
	Q: { label: 'outflow discipline', explain: 'sending value mostly to trusted, qualified peers' },
	I: { label: 'qualified inflow', explain: 'receiving value from trusted, qualified peers' }
};

const BOOST_SOURCE_LABELS: Record<string, string> = {
	backer: 'Backer',
	pay_kyc: 'Verified human (KYC)',
	dappcon26: 'DappCon 2026'
};

function boostSourceLabel(name: string): string {
	return (
		BOOST_SOURCE_LABELS[name] ??
		name.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())
	);
}

function weightOf(v: unknown): number {
	return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Which weighted behaviour metric (R/Q/I) moved most between two ticks. */
function dominantBehaviourDriver(
	prev: HistoryItem,
	cur: HistoryItem,
	cfg: RepConfig
): { key: 'R' | 'Q' | 'I'; sign: number } | null {
	const pb = prev.components?.behaviour;
	const cb = cur.components?.behaviour;
	if (!pb || !cb) return null;
	const w = cfg?.defaults?.behaviour?.weights;
	const deltas: Record<'R' | 'Q' | 'I', number> = {
		R: weightOf(w?.R) * ((cb.R_bar ?? 0) - (pb.R_bar ?? 0)),
		Q: weightOf(w?.Q) * ((cb.Q_bar ?? 0) - (pb.Q_bar ?? 0)),
		I: weightOf(w?.I) * ((cb.I_bar ?? 0) - (pb.I_bar ?? 0))
	};
	let key: 'R' | 'Q' | 'I' = 'R';
	(['Q', 'I'] as const).forEach((k) => {
		if (Math.abs(deltas[k]) > Math.abs(deltas[key])) key = k;
	});
	if (deltas[key] === 0) return null;
	return { key, sign: deltas[key] > 0 ? 1 : -1 };
}

/** Which static boost source changed most between two ticks. */
function dominantBoostSource(
	prev: HistoryItem,
	cur: HistoryItem
): { label: string; added: boolean; removed: boolean; sign: number } | null {
	const ps = prev.components?.boost?.b_static_sources ?? {};
	const cs = cur.components?.boost?.b_static_sources ?? {};
	const keys = new Set([...Object.keys(ps), ...Object.keys(cs)]);
	let bestKey: string | null = null;
	let bestDelta = 0;
	for (const k of keys) {
		const d = (cs[k] ?? 0) - (ps[k] ?? 0);
		if (Math.abs(d) > Math.abs(bestDelta)) {
			bestDelta = d;
			bestKey = k;
		}
	}
	if (!bestKey || bestDelta === 0) return null;
	const before = ps[bestKey] ?? 0;
	const after = cs[bestKey] ?? 0;
	return {
		label: boostSourceLabel(bestKey),
		added: before === 0 && after !== 0,
		removed: after === 0 && before !== 0,
		sign: bestDelta > 0 ? 1 : -1
	};
}

/** Build the headline + plain-language detail for one change. */
function describeChange(
	prev: HistoryItem,
	cur: HistoryItem,
	cause: CauseKind,
	delta: number,
	cfg: RepConfig,
	gamma: number
): { headline: string; detail?: string } {
	switch (cause) {
		case 'behaviour': {
			const drv = dominantBehaviourDriver(prev, cur, cfg);
			if (drv) {
				const d = BEHAVIOUR_DRIVERS[drv.key];
				const adj = drv.sign > 0 ? 'stronger' : 'weaker';
				return { headline: repLine(delta, `${adj} ${d.label}`), detail: `${cap(d.explain)}.` };
			}
			return {
				headline: causeCopy('behaviour', delta),
				detail: 'Your conduct in the network — retention, outflow discipline and qualified inflow.'
			};
		}
		case 'boost-static': {
			const src = dominantBoostSource(prev, cur);
			const detail = 'Static boosts are fixed credit for verifications and group memberships.';
			if (src) {
				const verb = src.added
					? 'was added'
					: src.removed
						? 'was removed'
						: src.sign > 0
							? 'increased'
							: 'decreased';
				return { headline: repLine(delta, `${src.label} boost ${verb}`), detail };
			}
			return { headline: causeCopy('boost-static', delta), detail };
		}
		case 'boost-legacy':
			return {
				headline: causeCopy('boost-legacy', delta),
				detail: 'Credit carried over from the previous scoring era, which fades over time.'
			};
		case 'momentum': {
			const mult = Number.isFinite(gamma) && gamma > 0 ? ` — amplified ×${Math.round(gamma)}` : '';
			return {
				headline: causeCopy('momentum', delta),
				detail: `A recent change in your boosts is still settling in${mult}, then fades over time.`
			};
		}
		case 'gate':
			return {
				headline: causeCopy('gate', delta),
				detail: 'Your liveness gate reflects recent account activity and scales the whole score.'
			};
		case 'membership':
			// Keyed off membership state, not the score delta: a join can coincide
			// with a score drop and must still read "Joined the group".
			return {
				headline: cur.is_member ? 'Joined the group' : 'Left the group',
				detail: cur.is_member
					? 'You became a member of the scoring group.'
					: 'You left the scoring group.'
			};
		default:
			return {
				headline: repLine(delta, 'several factors'),
				detail: 'Several drivers moved together, with no single dominant cause.'
			};
	}
}

/**
 * @param opts.minDelta suppress changes whose absolute displayed delta is below
 *        this threshold (default 1) to avoid sub-point noise.
 */
export function deriveTimeline(
	items: HistoryItem[],
	cfg: RepConfig,
	opts?: { minDelta?: number }
): TimelineEvent[] {
	const minDelta = opts?.minDelta ?? 1;
	const rawGamma = cfg?.defaults?.boost?.delta?.gamma;
	const gamma = typeof rawGamma === 'number' && Number.isFinite(rawGamma) ? rawGamma : 0;
	const sorted = items
		.filter((it) => Number.isFinite(Date.parse(it.snapshot_at)))
		.sort((a, b) => Date.parse(a.snapshot_at) - Date.parse(b.snapshot_at));

	const events: TimelineEvent[] = [];
	for (let i = 1; i < sorted.length; i++) {
		const prev = sorted[i - 1];
		const cur = sorted[i];
		const fromLive = displayLive(prev);
		const toLive = displayLive(cur);
		const delta = toLive - fromLive;

		// membership flip dominates
		if (prev.is_member !== cur.is_member) {
			const { headline, detail } = describeChange(prev, cur, 'membership', delta, cfg, gamma);
			events.push({
				at: Date.parse(cur.snapshot_at),
				fromLive,
				toLive,
				delta,
				cause: 'membership',
				headline,
				detail
			});
			continue;
		}

		if (Math.abs(delta) < minDelta) continue;

		const dBehaviour = Math.abs((cur.behaviour_score ?? 0) - (prev.behaviour_score ?? 0));
		const dStatic = Math.abs(staticTotal(cur) - staticTotal(prev));
		const dLegacy = Math.abs(legacyTotal(cur) - legacyTotal(prev));
		const dMomentum = Math.abs(gamma * (deltaMem(cur) - deltaMem(prev)));
		const dGate = Math.abs((cur.liveness_factor ?? 1) - (prev.liveness_factor ?? 1));

		const candidates: { cause: CauseKind; mag: number }[] = [
			{ cause: 'behaviour', mag: dBehaviour },
			{ cause: 'boost-static', mag: dStatic },
			{ cause: 'boost-legacy', mag: dLegacy },
			{ cause: 'momentum', mag: dMomentum },
			{ cause: 'gate', mag: dGate * 100 }
		];
		candidates.sort((a, b) => b.mag - a.mag);

		const top = candidates[0];
		const second = candidates[1];
		// near-tie (within 15% of the leader) → mixed
		let cause: CauseKind = top.cause;
		if (top.mag <= 0 || (second && second.mag > 0 && second.mag >= top.mag * 0.85)) {
			cause = 'mixed';
		}

		const { headline, detail } = describeChange(prev, cur, cause, delta, cfg, gamma);
		events.push({
			at: Date.parse(cur.snapshot_at),
			fromLive,
			toLive,
			delta,
			cause,
			headline,
			detail
		});
	}

	// newest first for display
	return events.reverse();
}
