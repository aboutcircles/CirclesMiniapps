/**
 * Rep Score Explorer — environment / base-URL resolution.
 *
 * Bases are env-switchable (staging default, prod via env). `resolveEnv` takes
 * an optional bag so it stays pure and testable; the route calls
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
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** A flag is "off" only when explicitly set to the string "false" (default true). */
function flag(bag: EnvBag, key: string, fallback: boolean): boolean {
	const v = bag?.[key];
	if (v === undefined) return fallback;
	if (typeof v === 'boolean') return v;
	return String(v).toLowerCase() !== 'false';
}

/**
 * Resolve runtime config from `import.meta.env` (or an injected bag for tests).
 * Recognised vars (all optional, staging defaults):
 *   VITE_REP_SCORE_BASE, VITE_REP_SCORE_RPC_BASE, VITE_REP_SCORE_PROFILE_BASE,
 *   VITE_REP_SCORE_GROUP_ID, VITE_REP_SCORE_SEARCH_ENABLED, VITE_REP_SCORE_DEBUG.
 */
export function resolveEnv(bag?: EnvBag): RepEnv {
	return {
		repBase: pick(bag, 'VITE_REP_SCORE_BASE') ?? STAGING.rep,
		rpcBase: pick(bag, 'VITE_REP_SCORE_RPC_BASE') ?? STAGING.rpc,
		profileBase: pick(bag, 'VITE_REP_SCORE_PROFILE_BASE') ?? STAGING.profile,
		groupId: pick(bag, 'VITE_REP_SCORE_GROUP_ID') ?? DEFAULT_GROUP_ID,
		searchEnabled: flag(bag, 'VITE_REP_SCORE_SEARCH_ENABLED', true),
		debug: flag(bag, 'VITE_REP_SCORE_DEBUG', false)
	};
}
