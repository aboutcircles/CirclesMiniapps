export type AppPhase = 'idle' | 'loading' | 'table' | 'deposit' | 'deposited';

export interface AssetInfo {
	id: string;
	symbol: string;
	name: string;
	address: `0x${string}`;
	decimals: number;
	logoUrl: string;
	balance: bigint;
	balanceError: boolean;
	depositedBalance: bigint;
	eurValue: number;
	eurPerToken: number;
	apy: number | null;
	tvl: number | null;
	apyLoading: boolean;
	aTokenAddress: `0x${string}` | null;
}
