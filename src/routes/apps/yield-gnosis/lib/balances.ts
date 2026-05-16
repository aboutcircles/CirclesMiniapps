import { formatUnits } from 'viem';
import { publicClient, ERC20_ABI } from './chains.js';
import { fetchTokenPrices } from './prices.js';
import { ASSET_CONFIGS } from './assets.js';
import type { AssetInfo } from './types.js';

export async function fetchAllBalances(address: `0x${string}`): Promise<AssetInfo[]> {
	const [pricesResult, ...balanceResults] = await Promise.allSettled([
		fetchTokenPrices(),
		...ASSET_CONFIGS.map(cfg =>
			publicClient.readContract({
				address: cfg.address,
				abi: ERC20_ABI,
				functionName: 'balanceOf',
				args: [address]
			})
		)
	]);

	const p = pricesResult.status === 'fulfilled'
		? pricesResult.value
		: { ethUsd: 2500, usdToEur: 0.92 };

	return ASSET_CONFIGS.map((cfg, i) => {
		const result = balanceResults[i];
		const balanceError = result.status === 'rejected';
		const raw = result.status === 'fulfilled'
			? (result as PromiseFulfilledResult<bigint>).value
			: 0n;

		const num = parseFloat(formatUnits(raw, cfg.decimals));

		let eurPerToken: number;
		if (cfg.priceType === 'stable-eur') {
			eurPerToken = 1;
		} else if (cfg.priceType === 'stable-usd') {
			eurPerToken = p.usdToEur;
		} else {
			eurPerToken = p.ethUsd * p.usdToEur;
		}

		return {
			...cfg,
			balance: raw,
			balanceError,
			depositedBalance: 0n,
			eurValue: num * eurPerToken,
			eurPerToken,
			apy: null,
			tvl: null,
			apyLoading: true,
			aTokenAddress: null
		} satisfies AssetInfo;
	});
}
