/**
 * Rep Score Explorer — shared types.
 *
 * Pure type declarations mirroring the live advanced-analytics `/rep_score`
 * contract (verified against staging) plus the profile service. No logic here,
 * so this module is safe to import from anywhere (route, future standalone
 * build, future phase-2 flagging tool).
 */

export type Address = `0x${string}`;
export type AvatarType = 'human' | 'group' | 'organization';

/** Raw edge direction returned by the API. The UI groups incoming+outgoing as "one-way". */
export type EdgeType = 'bilateral' | 'incoming' | 'outgoing';

// ─── /config ────────────────────────────────────────────────────────────────

export interface BehaviourWeights {
	R: number;
	Q: number;
	I: number;
}

export interface BoostSource {
	name: string;
	group_address: string;
	boost: number;
}

export interface RepConfigDefaults {
	behaviour: {
		weights: BehaviourWeights;
		[k: string]: unknown;
	};
	propagation: {
		aggregation: string; // "off" when disabled
		[k: string]: unknown;
	};
	boost: {
		static: { sources: BoostSource[] };
		network: { per_bilateral: number; [k: string]: unknown };
		delta: { gamma: number; [k: string]: unknown };
		legacy: { enabled: boolean; tau_L_days?: number; [k: string]: unknown };
		[k: string]: unknown;
	};
	composition: { mode: string; [k: string]: unknown };
	gate: { penalty: number; [k: string]: unknown };
	[k: string]: unknown;
}

export interface RepConfig {
	enabled: boolean;
	refresh_interval_seconds: number;
	defaults: RepConfigDefaults;
	groups: GroupInfo[];
}

// ─── /groups ────────────────────────────────────────────────────────────────

export interface GroupInfo {
	id: string;
	group_address: Address;
	default: boolean;
	member_count: number;
	last_run_status: string;
	last_run_started_at?: string;
	last_run_finished_at?: string;
	[k: string]: unknown;
}

// ─── component subtrees (shared by avatar snapshot, history items, neighbours) ─

export interface EmaPrimitives {
	r_bar: number;
	qual_out_bar: number;
	tot_out_bar: number;
	qual_in_bar: number;
	tot_in_bar: number;
	mint_bar: number;
}

export interface BehaviourComponent {
	R_bar: number;
	Q_bar: number;
	I_bar: number;
	s_b: number;
	ema_primitives: EmaPrimitives;
}

export interface Endorser {
	address: Address;
	weight_row: number;
	weight_budget: number;
	d_s_eff: number;
	contribution: number;
	[k: string]: unknown;
}

export interface PropagationComponent {
	s_eff: number;
	alpha_used: number;
	age_days: number;
	iters: number;
	converged: boolean;
	anchor_only?: boolean;
	endorsers?: Endorser[];
}

export interface BoostComponent {
	B_static: number;
	B_static_live: number;
	b_static_sources: Record<string, number>;
	b_static_sources_live: Record<string, number>;
	B_network: number;
	B_delta: number;
	B_legacy: number;
	B_legacy_active: boolean;
	B_total: number;
	delta_state?: { b_mem: number; daily_change: number; [k: string]: unknown };
}

export interface GateLive {
	balance: number;
	outstanding: number;
	non_qualified_outflow_window: number;
	qualified_inflow_window: number;
	gate_debt: number;
	gate_triggered: boolean;
	liveness_factor: number;
	s_user_raw: number;
	s_user_gated: number;
	s_user: number;
	score_uint: number;
}

export interface GateComponent {
	snapshot?: Partial<GateLive> & Record<string, unknown>;
	live: GateLive;
}

export interface CompositionComponent {
	s_eff_used: number;
	base: number;
	s_user_raw: number;
}

export interface Components {
	behaviour: BehaviourComponent;
	propagation: PropagationComponent;
	boost: BoostComponent;
	gate: GateComponent;
	composition: CompositionComponent;
}

// ─── endpoint payloads ────────────────────────────────────────────────────────

/**
 * Avatar snapshot. For an unknown / non-member address the API returns a SLIM
 * object: `is_member: false`, `reputation_score_live: 0`, and **no `components`**.
 * Consumers must branch on `is_member` / presence of `components`.
 */
export interface AvatarScore {
	address: Address;
	is_member: boolean;
	blacklisted: boolean;
	raw_score?: number;
	reputation_score?: number;
	reputation_score_live: number;
	behaviour_score?: number;
	boost_score?: number;
	source?: string;
	computed_at?: string;
	algorithm?: string;
	components?: Components;
	[k: string]: unknown;
}

export interface HistoryItem {
	snapshot_at: string;
	reputation_score: number;
	reputation_score_live: number;
	behaviour_score: number;
	boost_score: number;
	liveness_factor: number;
	is_member: boolean;
	components: Components;
}

export interface HistoryPage {
	total: number;
	limit: number;
	offset: number;
	items: HistoryItem[];
}

export interface Neighbour {
	address: Address;
	edge_type: EdgeType;
	scored: boolean;
	is_member: boolean;
	reputation_score: number;
	behaviour_score: number;
	components?: Components;
}

export interface NeighboursResponse {
	total_neighbours: number;
	neighbours: Neighbour[];
}

// ─── profiles ─────────────────────────────────────────────────────────────────

/** Raw profile shape from the profile service / Circles RPC batch. */
export interface Profile {
	address?: string;
	name?: string;
	imageUrl?: string;
	previewImageUrl?: string;
	avatarType?: string;
	description?: string;
	registeredName?: string;
	CID?: string;
	[k: string]: unknown;
}

/** Display-ready profile: never has an empty image (falls back to identicon). */
export interface ResolvedProfile {
	address: Address;
	name: string;
	imageUrl: string;
	avatarType: AvatarType | null;
	hasRealImage: boolean;
	raw: Profile | null;
}

// ─── async cell helper (used by the route orchestrator) ───────────────────────

export type Async<T> =
	| { kind: 'idle' }
	| { kind: 'loading' }
	| { kind: 'ok'; value: T }
	| { kind: 'error'; error: string };
