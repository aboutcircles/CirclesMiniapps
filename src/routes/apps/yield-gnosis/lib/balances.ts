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
		const raw = balanceResults[i].status === 'fulfilled'
			? (balanceResults[i] as PromiseFulfilledResult<bigint>).value
			: 0n;

		const num = parseFloat(formatUnits(raw, cfg.decimals));

		let eurValue: number;
		if (cfg.priceType === 'stable-eur') {
			eurValue = num;
		} else if (cfg.priceType === 'stable-usd') {
			eurValue = num * p.usdToEur;
		} else {
			eurValue = num * p.ethUsd * p.usdToEur;
		}

		return {
			...cfg,
			balance: raw,
			depositedBalance: 0n,
			eurValue,
			apy: null,
			tvl: null,
			apyLoading: true,
			aTokenAddress: null
		} satisfies AssetInfo;
	});
}
