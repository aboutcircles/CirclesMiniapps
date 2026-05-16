import { createPublicClient, fallback, http } from 'viem';
import { gnosis } from 'viem/chains';

export const publicClient = createPublicClient({
	chain: gnosis,
	transport: fallback([
		http('https://rpc.gnosischain.com'),
		http('https://rpc2.gnosischain.com')
	])
});

export const EURE_ADDRESS = '0xcb444e90d8198415266c6a2724b7900fb12fc56e' as const;
export const AAVE_POOL = '0xb50201558B00496A145fE76f7424749556E326D8' as const;

export const ERC20_ABI = [
	{
		name: 'balanceOf',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }]
	},
	{
		name: 'approve',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' }
		],
		outputs: [{ name: '', type: 'bool' }]
	},
	{
		name: 'allowance',
		type: 'function',
		stateMutability: 'view',
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' }
		],
		outputs: [{ name: '', type: 'uint256' }]
	}
] as const;

export const AAVE_POOL_ABI = [
	{
		name: 'supply',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'asset', type: 'address' },
			{ name: 'amount', type: 'uint256' },
			{ name: 'onBehalfOf', type: 'address' },
			{ name: 'referralCode', type: 'uint16' }
		],
		outputs: []
	},
	{
		name: 'withdraw',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'asset', type: 'address' },
			{ name: 'amount', type: 'uint256' },
			{ name: 'to', type: 'address' }
		],
		outputs: [{ name: '', type: 'uint256' }]
	},
	{
		name: 'getReserveData',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'asset', type: 'address' }],
		outputs: [
			{
				name: '',
				type: 'tuple',
				components: [
					{
						name: 'configuration',
						type: 'tuple',
						components: [{ name: 'data', type: 'uint256' }]
					},
					{ name: 'liquidityIndex', type: 'uint128' },
					{ name: 'currentLiquidityRate', type: 'uint128' },
					{ name: 'variableBorrowIndex', type: 'uint128' },
					{ name: 'currentVariableBorrowRate', type: 'uint128' },
					{ name: 'currentStableBorrowRate', type: 'uint128' },
					{ name: 'lastUpdateTimestamp', type: 'uint40' },
					{ name: 'id', type: 'uint16' },
					{ name: 'aTokenAddress', type: 'address' },
					{ name: 'stableDebtTokenAddress', type: 'address' },
					{ name: 'variableDebtTokenAddress', type: 'address' },
					{ name: 'interestRateStrategyAddress', type: 'address' },
					{ name: 'accruedToTreasury', type: 'uint128' },
					{ name: 'unbacked', type: 'uint128' },
					{ name: 'isolationModeTotalDebt', type: 'uint128' }
				]
			}
		]
	}
] as const;
