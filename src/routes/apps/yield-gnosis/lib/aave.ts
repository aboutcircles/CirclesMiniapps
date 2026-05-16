import { encodeFunctionData, formatUnits, maxUint256, parseUnits } from 'viem';
import { publicClient, AAVE_POOL, ERC20_ABI, AAVE_POOL_ABI } from './chains.js';

const aTokenCache = new Map<string, `0x${string}`>();

export async function getATokenAddress(assetAddress: `0x${string}`): Promise<`0x${string}`> {
	const key = assetAddress.toLowerCase();
	if (aTokenCache.has(key)) return aTokenCache.get(key)!;

	const data = await publicClient.readContract({
		address: AAVE_POOL,
		abi: AAVE_POOL_ABI,
		functionName: 'getReserveData',
		args: [assetAddress]
	});

	const aToken = data.aTokenAddress as `0x${string}`;
	aTokenCache.set(key, aToken);
	return aToken;
}

export async function getATokenBalance(
	address: `0x${string}`,
	aTokenAddress: `0x${string}`
): Promise<bigint> {
	try {
		return await publicClient.readContract({
			address: aTokenAddress,
			abi: ERC20_ABI,
			functionName: 'balanceOf',
			args: [address]
		});
	} catch {
		return 0n;
	}
}

// Legacy alias used by LiveCounter
export const getAEureBalance = getATokenBalance;

export function encodeApprove(spender: `0x${string}`, amount: bigint): `0x${string}` {
	return encodeFunctionData({
		abi: ERC20_ABI,
		functionName: 'approve',
		args: [spender, amount]
	});
}

export function encodeSupply(
	asset: `0x${string}`,
	amount: bigint,
	onBehalfOf: `0x${string}`
): `0x${string}` {
	return encodeFunctionData({
		abi: AAVE_POOL_ABI,
		functionName: 'supply',
		args: [asset, amount, onBehalfOf, 0]
	});
}

export function encodeWithdraw(
	asset: `0x${string}`,
	to: `0x${string}`,
	amount: bigint = maxUint256
): `0x${string}` {
	return encodeFunctionData({
		abi: AAVE_POOL_ABI,
		functionName: 'withdraw',
		args: [asset, amount, to]
	});
}

export function formatBalance(raw: bigint, tokenDecimals: number, displayDecimals = 4): string {
	return parseFloat(formatUnits(raw, tokenDecimals)).toFixed(displayDecimals);
}

export function parseAmount(input: string, decimals = 18): bigint {
	try {
		return parseUnits(input.trim(), decimals);
	} catch {
		return 0n;
	}
}
