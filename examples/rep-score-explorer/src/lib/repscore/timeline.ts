/**
 * Rep Score Explorer — event timeline derivation (pure). No DOM.
 *
 * Diffs consecutive /history ticks and attributes each score change to the
 * component that moved the most, in plain language. Momentum uses gamma from
 * config (gamma·ΔB_delta) so it stays config-driven.
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

/** Human copy for a cause + direction. */
export function causeCopy(cause: CauseKind, delta: number): string {
	const dir = delta > 0 ? 'rose' : 'fell';
	const pts = `${Math.abs(delta)} pt${Math.abs(delta) === 1 ? '' : 's'}`;
	switch (cause) {
		case 'behaviour':
			return `Reputation ${dir} ${pts} — behaviour changed`;
		case 'boost-static':
			return `Reputation ${dir} ${pts} — a boost ${delta > 0 ? 'was added' : 'changed'}`;
		case 'boost-legacy':
			return `Reputation ${dir} ${pts} — legacy credit changed`;
		case 'momentum':
			return `Reputation ${dir} ${pts} — recent momentum`;
		case 'gate':
			return `Reputation ${dir} ${pts} — liveness changed`;
		case 'membership':
			return delta >= 0 ? 'Joined the group' : 'Left the group';
		default:
			return `Reputation ${dir} ${pts}`;
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
			events.push({
				at: Date.parse(cur.snapshot_at),
				fromLive,
				toLive,
				delta,
				cause: 'membership',
				headline: cur.is_member ? 'Joined the group' : 'Left the group'
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

		events.push({
			at: Date.parse(cur.snapshot_at),
			fromLive,
			toLive,
			delta,
			cause,
			headline: causeCopy(cause, delta)
		});
	}

	// newest first for display
	return events.reverse();
}
