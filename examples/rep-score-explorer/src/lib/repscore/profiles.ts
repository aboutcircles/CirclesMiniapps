/**
 * Rep Score Explorer — profile identity resolution.
 *
 * Focal avatar uses the profile service (clean avatarType enum, may omit image).
 * Neighbour lists use one Circles JSON-RPC `circles_getProfileByAddressBatch`
 * call (verified). All resolution flows through the pure `resolveProfile`, which
 * applies the identicon fallback so the UI never has an empty image.
 *
 * Hand-rolled fetch (no SDK dependency) keeps this module portable for the
 * future standalone build.
 */

import { identiconDataUri } from './identicon';
import { shortAddress, isValidAddress } from './format';
import type { Address, AvatarType, Profile, ResolvedProfile } from './types';
import type { RepEnv } from './env';

/** Normalise the various raw avatarType spellings to the clean enum. */
function normalizeAvatarType(raw?: string): AvatarType | null {
	if (!raw) return null;
	const s = raw.toLowerCase();
	if (s.includes('human')) return 'human';
	if (s.includes('group')) return 'group';
	if (s.includes('organization') || s.includes('organisation')) return 'organization';
	return null;
}

/** Pure: choose best name + image (with identicon fallback) from a raw profile. */
export function resolveProfile(address: Address, raw: Profile | null): ResolvedProfile {
	const addr = address.toLowerCase() as Address;
	// Trim each candidate before the fallback so whitespace-only values fall through.
	const name = (raw?.name ?? '').trim() || (raw?.registeredName ?? '').trim();
	const realImage = (raw?.imageUrl ?? '').trim() || (raw?.previewImageUrl ?? '').trim();
	return {
		address: addr,
		name: name || shortAddress(addr),
		imageUrl: realImage || identiconDataUri(addr),
		avatarType: normalizeAvatarType(raw?.avatarType),
		hasRealImage: realImage.length > 0,
		raw
	};
}

/** Focal avatar profile: GET {profileBase}/{addr}. Never throws — falls back to identicon. */
export async function fetchFocalProfile(
	env: RepEnv,
	address: Address,
	fetchImpl: typeof fetch = fetch
): Promise<ResolvedProfile> {
	const addr = address.toLowerCase() as Address;
	try {
		const res = await fetchImpl(`${env.profileBase}/${addr}`, {
			headers: { Accept: 'application/json' }
		});
		if (!res.ok) return resolveProfile(addr, null);
		const raw = (await res.json()) as Profile;
		return resolveProfile(addr, raw && typeof raw === 'object' ? raw : null);
	} catch {
		return resolveProfile(addr, null);
	}
}

/** Derive the profiles-service search URL from the single-profile base. */
function searchEndpoint(profileBase: string): string {
	// profileBase is `${profilesRoot}/profile`; search lives at `${profilesRoot}/search`.
	const root = profileBase.replace(/\/profile\/?$/, '');
	return `${root}/search`;
}

/**
 * Look up avatars by name via the profiles service:
 *   GET {profilesRoot}/search?name=<query>&limit=<n>
 * Case-insensitive substring match. Returns resolved profiles (identicon
 * fallback applied, invalid/duplicate addresses dropped). Never throws —
 * returns [] on error, empty input, or no matches.
 */
export async function searchProfiles(
	env: RepEnv,
	query: string,
	fetchImpl: typeof fetch = fetch,
	limit = 8
): Promise<ResolvedProfile[]> {
	const q = query.trim();
	if (q.length === 0) return [];

	let rows: Profile[] = [];
	try {
		const url = `${searchEndpoint(env.profileBase)}?name=${encodeURIComponent(q)}&limit=${limit}`;
		const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
		if (!res.ok) return [];
		const json = await res.json();
		rows = Array.isArray(json) ? json : [];
	} catch {
		return [];
	}

	// Keep valid, unique addresses in match order.
	const picked: { row: Profile; address: Address }[] = [];
	const seen = new Set<string>();
	for (const row of rows) {
		const a = (row?.address ?? '').toLowerCase();
		if (!a || seen.has(a) || !isValidAddress(a)) continue;
		seen.add(a);
		picked.push({ row, address: a as Address });
	}
	if (picked.length === 0) return [];

	// The search endpoint omits avatar images; enrich with a single batch RPC
	// call that returns previewImageUrl (the same source neighbour avatars use).
	const images = await fetchProfilesBatch(
		env,
		picked.map((p) => p.address),
		fetchImpl
	);
	return picked.map(({ row, address }) => {
		const enriched = images.get(address);
		const raw: Profile = {
			...row,
			previewImageUrl: enriched?.hasRealImage ? enriched.imageUrl : row.previewImageUrl
		};
		return resolveProfile(address, raw);
	});
}

/**
 * Batch neighbour profiles via Circles JSON-RPC. Returns a Map keyed by
 * lowercased address; addresses with no profile still get an identicon entry.
 */
export async function fetchProfilesBatch(
	env: RepEnv,
	addresses: Address[],
	fetchImpl: typeof fetch = fetch
): Promise<Map<string, ResolvedProfile>> {
	const lower = addresses.map((a) => a.toLowerCase() as Address);
	const out = new Map<string, ResolvedProfile>();
	for (const a of lower) out.set(a, resolveProfile(a, null)); // identicon defaults

	if (lower.length === 0) return out;

	try {
		const res = await fetchImpl(env.rpcBase, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'circles_getProfileByAddressBatch',
				params: [lower]
			})
		});
		if (!res.ok) return out;
		const json = await res.json();
		const rows: Profile[] = Array.isArray(json?.result) ? json.result : [];
		for (const row of rows) {
			const a = (row?.address || '').toLowerCase();
			if (a && out.has(a)) out.set(a, resolveProfile(a as Address, row));
		}
	} catch {
		/* keep identicon defaults */
	}
	return out;
}
