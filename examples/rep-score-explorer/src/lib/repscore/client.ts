/**
 * Rep Score Explorer — analytics API client.
 *
 * All HTTP access to the advanced-analytics `/rep_score` service. Read-only,
 * plain `fetch`, CORS-`*` so no proxy. Addresses are lowercased before
 * interpolation. `fetchImpl` is injectable for tests.
 *
 * This module (and all of `src/lib/repscore/`) is framework-agnostic so it can
 * be reused by the future standalone build and the phase-2 flagging tool.
 */

import type {
	Address,
	AvatarScore,
	GroupInfo,
	HistoryItem,
	HistoryPage,
	NeighboursResponse,
	RepConfig
} from './types';
import type { RepEnv } from './env';

export class RepApiError extends Error {
	status?: number;
	constructor(message: string, status?: number) {
		super(message);
		this.name = 'RepApiError';
		this.status = status;
	}
}

export class NotFoundError extends RepApiError {
	constructor(message = 'Not found') {
		super(message, 404);
		this.name = 'NotFoundError';
	}
}

const HISTORY_PAGE_LIMIT = 500; // server max
const DEFAULT_HISTORY_MAX = 1500; // cap total fetched to bound payload size

export interface RepScoreClientOptions {
	env: RepEnv;
	fetchImpl?: typeof fetch;
}

export class RepScoreClient {
	private env: RepEnv;
	private fetchImpl: typeof fetch;

	constructor(opts: RepScoreClientOptions) {
		this.env = opts.env;
		// Wrap the global fetch. Calling a stored `this.fetchImpl(...)` passes the
		// client instance as `this`, which native fetch rejects with "Illegal
		// invocation". The bare call inside the arrow keeps fetch bound to the
		// global. An injected fetchImpl (tests) is used as-is.
		this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
	}

	private async getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
		let res: Response;
		try {
			res = await this.fetchImpl(`${this.env.repBase}${path}`, {
				headers: { Accept: 'application/json' },
				signal
			});
		} catch (e) {
			if ((e as Error)?.name === 'AbortError') throw e;
			throw new RepApiError(`Network error: ${(e as Error)?.message ?? 'request failed'}`);
		}
		if (res.status === 404) throw new NotFoundError();
		if (!res.ok) throw new RepApiError(`Request failed (${res.status})`, res.status);
		return (await res.json()) as T;
	}

	getConfig(signal?: AbortSignal): Promise<RepConfig> {
		return this.getJson<RepConfig>('/config', signal);
	}

	async getGroups(signal?: AbortSignal): Promise<GroupInfo[]> {
		const r = await this.getJson<{ groups: GroupInfo[] }>('/groups', signal);
		return r.groups ?? [];
	}

	getAvatar(address: Address, signal?: AbortSignal): Promise<AvatarScore> {
		const g = encodeURIComponent(this.env.groupId);
		const a = encodeURIComponent(address.toLowerCase());
		return this.getJson<AvatarScore>(`/groups/${g}/avatars/${a}`, signal);
	}

	/**
	 * Per-avatar history (the only timeline source). Auto-paginates via `offset`
	 * when `total > limit`, capping at `maxItems` to bound the (potentially
	 * multi-MB) payload. Returns items sorted ascending by `snapshot_at`.
	 */
	async getHistory(
		address: Address,
		opts?: { maxItems?: number; signal?: AbortSignal }
	): Promise<HistoryItem[]> {
		const g = encodeURIComponent(this.env.groupId);
		const a = encodeURIComponent(address.toLowerCase());
		const maxItems = opts?.maxItems ?? DEFAULT_HISTORY_MAX;

		const all: HistoryItem[] = [];
		let offset = 0;
		let total = Infinity;
		while (all.length < maxItems && offset < total) {
			const page = await this.getJson<HistoryPage>(
				`/groups/${g}/avatars/${a}/history?limit=${HISTORY_PAGE_LIMIT}&offset=${offset}`,
				opts?.signal
			);
			total = page.total ?? page.items.length;
			if (!page.items.length) break;
			all.push(...page.items.slice(0, maxItems - all.length));
			offset += page.items.length;
			if (page.items.length < HISTORY_PAGE_LIMIT) break;
		}
		all.sort((x, y) => Date.parse(x.snapshot_at) - Date.parse(y.snapshot_at));
		return all;
	}

	getNeighbours(
		address: Address,
		max = 80,
		signal?: AbortSignal
	): Promise<NeighboursResponse> {
		const g = encodeURIComponent(this.env.groupId);
		const a = encodeURIComponent(address.toLowerCase());
		return this.getJson<NeighboursResponse>(
			`/groups/${g}/avatars/${a}/neighbours?max_neighbours=${max}`,
			signal
		);
	}
}

// Lazy, cached factory mirroring direct-transfer's getSdk().
let _client: RepScoreClient | null = null;
let _clientKey = '';

export function getRepScoreClient(env: RepEnv): RepScoreClient {
	const key = `${env.repBase}|${env.groupId}`;
	if (!_client || _clientKey !== key) {
		_client = new RepScoreClient({ env });
		_clientKey = key;
	}
	return _client;
}
