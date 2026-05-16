import { ASSET_CONFIGS } from './assets.js';

interface LlamaPool {
	project: string;
	chain: string;
	symbol: string;
	apy: number;
	tvlUsd: number;
	underlyingTokens?: string[];
}

interface LlamaResponse {
	data: LlamaPool[];
}

export interface PoolData {
	apy: number;
	tvl: number;
}

let cachedPools: Map<string, PoolData> | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

const WATCHED_ADDRESSES = new Set(ASSET_CONFIGS.map(a => a.address.toLowerCase()));

export async function fetchAaveApys(): Promise<Map<string, PoolData>> {
	const now = Date.now();
	if (cachedPools && now - cacheTs < CACHE_TTL_MS) return cachedPools;

	const res = await fetch('https://yields.llama.fi/pools', { signal: AbortSignal.timeout(8000) });
	if (!res.ok) throw new Error(`DeFiLlama HTTP ${res.status}`);

	const json: LlamaResponse = await res.json();

	const poolMap = new Map<string, PoolData>();

	for (const pool of json.data) {
		if (pool.project.toLowerCase() !== 'aave-v3') continue;
		if (pool.chain.toLowerCase() !== 'gnosis') continue;
		if (!pool.underlyingTokens?.length) continue;

		for (const token of pool.underlyingTokens) {
			const addr = token.toLowerCase();
			if (WATCHED_ADDRESSES.has(addr) && !poolMap.has(addr)) {
				poolMap.set(addr, { apy: pool.apy, tvl: pool.tvlUsd });
			}
		}
	}

	cachedPools = poolMap;
	cacheTs = now;
	return poolMap;
}
