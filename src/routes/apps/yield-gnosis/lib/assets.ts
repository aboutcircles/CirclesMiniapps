export type PriceType = 'stable-eur' | 'stable-usd' | 'eth';

export interface AssetConfig {
	id: string;
	symbol: string;
	name: string;
	address: `0x${string}`;
	decimals: number;
	logoUrl: string;
	priceType: PriceType;
}

export const ASSET_CONFIGS: AssetConfig[] = [
	{
		id: 'eure',
		symbol: 'EURe',
		name: 'Euro',
		address: '0xcb444e90d8198415266c6a2724b7900fb12fc56e',
		decimals: 18,
		logoUrl: '/apps/yield-gnosis/eure.svg',
		priceType: 'stable-eur'
	},
	{
		id: 'usdc',
		symbol: 'USDC.e',
		name: 'USD Coin',
		address: '0x2a22f9c3b484c3629090feed35f17ff8f88f76f0',
		decimals: 6,
		logoUrl: '/apps/yield-gnosis/usdc.svg',
		priceType: 'stable-usd'
	},

];
