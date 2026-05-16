export interface TokenPrices {
	ethUsd: number;
	usdToEur: number;
}

let cached: TokenPrices | null = null;
let cacheTs = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function fetchTokenPrices(): Promise<TokenPrices> {
	if (cached && Date.now() - cacheTs < CACHE_TTL_MS) return cached;

	const [llamaResult, fxResult] = await Promise.allSettled([
		fetch('https://coins.llama.fi/prices/current/coingecko:ethereum', { signal: AbortSignal.timeout(5000) })
			.then(r => r.json()),
		fetch('https://api.frankfurter.app/latest?from=USD&to=EUR', { signal: AbortSignal.timeout(5000) })
			.then(r => r.json())
	]);

	const prices: TokenPrices = {
		ethUsd:   llamaResult.status === 'fulfilled' ? (llamaResult.value.coins?.['coingecko:ethereum']?.price ?? 2500) : 2500,
		usdToEur: fxResult.status === 'fulfilled'   ? (fxResult.value.rates?.EUR ?? 0.92)                             : 0.92
	};

	cached = prices;
	cacheTs = Date.now();
	return prices;
}
