/**
 * Rep Score Explorer — config-driven pipeline-stage activation (pure).
 *
 * Single source of truth for "is this stage actually affecting scores right
 * now?". Drives every section's active/inactive presentation so the UI never
 * claims a disabled stage (propagation / network boost / liveness gate) is
 * moving the score. Auto-adapts if ops flip a knob — nothing hardcoded.
 */

import type { GateLive, RepConfig } from './types';

export type StageKey =
	| 'behaviour'
	| 'propagation'
	| 'network'
	| 'legacy'
	| 'momentum'
	| 'gate';

export interface StageStatus {
	key: StageKey;
	label: string;
	active: boolean;
	reason: string;
}

export function deriveStages(cfg: RepConfig): Record<StageKey, StageStatus> {
	const d = cfg?.defaults;
	const aggregation = d?.propagation?.aggregation ?? 'off';
	const perBilateral = d?.boost?.network?.per_bilateral ?? 0;
	const gamma = d?.boost?.delta?.gamma ?? 0;
	const legacyEnabled = Boolean(d?.boost?.legacy?.enabled);
	const gatePenalty = d?.gate?.penalty ?? 0;

	const propagationActive = aggregation !== 'off';
	const networkActive = perBilateral !== 0;
	const momentumActive = gamma !== 0;
	const gateActive = gatePenalty !== 0;

	return {
		behaviour: {
			key: 'behaviour',
			label: 'Behaviour',
			active: true,
			reason: 'Always contributes to the score.'
		},
		propagation: {
			key: 'propagation',
			label: 'Trust propagation',
			active: propagationActive,
			reason: propagationActive
				? 'Trusted endorsers lift the effective score.'
				: `Off in current configuration (aggregation = "${aggregation}").`
		},
		network: {
			key: 'network',
			label: 'Network boost',
			active: networkActive,
			reason: networkActive
				? `Each bilateral trust adds ${perBilateral} points.`
				: 'Off in current configuration (no points per bilateral trust).'
		},
		legacy: {
			key: 'legacy',
			label: 'Legacy credit',
			active: legacyEnabled,
			reason: legacyEnabled
				? 'A decaying credit from the previous scoring era can apply.'
				: 'Disabled in current configuration.'
		},
		momentum: {
			key: 'momentum',
			label: 'Momentum',
			active: momentumActive,
			reason: momentumActive
				? `Recent positive change is amplified (gamma = ${gamma}).`
				: 'Off in current configuration (gamma = 0).'
		},
		gate: {
			key: 'gate',
			label: 'Liveness gate',
			active: gateActive,
			reason: gateActive
				? 'Inactive avatars can have their score scaled down.'
				: 'Off in current configuration (no penalty applied).'
		}
	};
}

/**
 * The liveness gate can be globally off yet still affect a specific avatar if
 * its live snapshot shows a penalty. Lets EconomicSnapshot surface per-avatar
 * gating even when `gate.penalty === 0`.
 */
export function gateActiveForAvatar(globalGate: StageStatus, live?: GateLive | null): boolean {
	if (globalGate.active) return true;
	if (!live) return false;
	return live.gate_triggered === true || (typeof live.liveness_factor === 'number' && live.liveness_factor !== 1);
}
