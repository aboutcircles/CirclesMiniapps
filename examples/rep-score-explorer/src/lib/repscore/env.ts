/**
 * Rep Score Explorer — environment / base-URL resolution.
 *
 * Bases are env-switchable (production default, staging via env). `resolveEnv`
 * takes an optional bag so it stays pure and testable; the route calls
 * `resolveEnv(import.meta.env)`.
 */

export const STAGING = {
	rep: 'https://rpc.staging.aboutcircles.com/analytics/rep_score',
	rpc: 'https://rpc.staging.aboutcircles.com/', // JSON-RPC (batch profiles)
	profile: 'https://rpc.staging.aboutcircles.com/profiles/profile' // focal single profile
} as const;

export const PROD = {
	rep: 'https://rpc.aboutcircles.com/analytics/rep_score',
	rpc: 'https://rpc.aboutcircles.com/',
	profile: 'https://rpc.aboutcircles.com/profiles/profile'
} as const;

export const DEFAULT_GROUP_ID = 'score_group';

export interface RepEnv {
	repBase: string;
	rpcBase: string;
	profileBase: string;
	groupId: string;
	searchEnabled: boolean;
	debug: boolean;
}

type EnvBag = Record<string, string | boolean | undefined> | undefined;

function pick(bag: EnvBag, key: string): string | undefined {
	const v = bag?.[key];
	if (typeof v !== 'string') return undefined;
	const trimmed = v.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Parse a boolean flag symmetrically: true/1/yes/on → true, false/0/no/off →
 * false (any case), and an empty or unrecognised value falls back to `fallback`.
 * This keeps DEBUG (default false) off unless explicitly enabled — e.g.
 * `VITE_REP_SCORE_DEBUG=0` does NOT turn it on.
 */
function flag(bag: EnvBag, key: string, fallback: boolean): boolean {
	const v = bag?.[key];
	if (v === undefined) return fallback;
	if (typeof v === 'boolean') return v;
	const s = String(v).trim().toLowerCase();
	if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
	if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
	return fallback;
}

/**
 * Resolve runtime config from `import.meta.env` (or an injected bag for tests).
 * Recognised vars (all optional, production defaults):
 *   VITE_REP_SCORE_BASE, VITE_REP_SCORE_RPC_BASE, VITE_REP_SCORE_PROFILE_BASE,
 *   VITE_REP_SCORE_GROUP_ID, VITE_REP_SCORE_SEARCH_ENABLED, VITE_REP_SCORE_DEBUG.
 * Point the three base URLs at STAGING.* (see above) for the staging dataset.
 */
export function resolveEnv(bag?: EnvBag): RepEnv {
	return {
		repBase: pick(bag, 'VITE_REP_SCORE_BASE') ?? PROD.rep,
		rpcBase: pick(bag, 'VITE_REP_SCORE_RPC_BASE') ?? PROD.rpc,
		profileBase: pick(bag, 'VITE_REP_SCORE_PROFILE_BASE') ?? PROD.profile,
		groupId: pick(bag, 'VITE_REP_SCORE_GROUP_ID') ?? DEFAULT_GROUP_ID,
		searchEnabled: flag(bag, 'VITE_REP_SCORE_SEARCH_ENABLED', true),
		debug: flag(bag, 'VITE_REP_SCORE_DEBUG', false)
	};
}
