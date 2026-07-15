// Shared Safe (multisig) helpers used by all three apps: discovering the Safes
// an address owns, verifying ownership on-chain, building prevalidated
// signatures, and wrapping a batch of txs to execute through a Safe.
//
// These are parameterized over the viem public client, the Safe singleton ABI
// and the tx-service base URL, because the apps configure those slightly
// differently (e.g. org uses the legacy tx-service host).

import {
  encodeFunctionData,
  getAddress,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { normalizeAddressList } from './format';

export const SAFE_MULTICALL_BATCH_SIZE = 40;

export interface TxLike {
  to: string;
  data: string;
  value: string;
}

/** Fetch the Safes that `ownerAddress` is listed as an owner of, via the Safe
 *  transaction service. Returns checksummed, de-duplicated addresses. */
export async function fetchOwnerSafeCandidates(
  txServiceUrl: string,
  ownerAddress: string,
): Promise<Address[]> {
  try {
    const response = await fetch(`${txServiceUrl}/api/v1/owners/${ownerAddress}/safes/`);
    if (!response.ok) return [];
    const data = (await response.json()) as { safes?: unknown[] };
    return normalizeAddressList(data?.safes ?? []);
  } catch {
    return [];
  }
}

/** Verify on-chain (via multicall) that `ownerAddress` is an owner of each Safe
 *  and the Safe has a threshold ≥ 1. Returns only the verified Safe addresses. */
export async function getVerifiedOwnerSafes(
  publicClient: PublicClient,
  safeAbi: Abi | undefined,
  safeAddresses: string[],
  ownerAddress: string,
): Promise<Address[]> {
  if (!safeAbi || !safeAddresses.length) return [];

  const normalized = normalizeAddressList(safeAddresses);
  const verified: Address[] = [];

  for (let i = 0; i < normalized.length; i += SAFE_MULTICALL_BATCH_SIZE) {
    const batch = normalized.slice(i, i + SAFE_MULTICALL_BATCH_SIZE);
    const contracts = batch.flatMap((safeAddress) => [
      { address: safeAddress, abi: safeAbi, functionName: 'getOwners' as const },
      { address: safeAddress, abi: safeAbi, functionName: 'getThreshold' as const },
    ]);

    try {
      const results = await publicClient.multicall({ contracts, allowFailure: true });
      batch.forEach((safeAddress, batchIndex) => {
        const ownersResult = results[batchIndex * 2];
        const thresholdResult = results[batchIndex * 2 + 1];
        if (ownersResult?.status !== 'success' || thresholdResult?.status !== 'success') return;
        const owners = ownersResult.result as string[];
        const threshold = thresholdResult.result as bigint;
        if (
          Array.isArray(owners) &&
          owners.some((o) => o.toLowerCase() === ownerAddress.toLowerCase()) &&
          BigInt(threshold) >= 1n
        ) {
          verified.push(getAddress(safeAddress));
        }
      });
    } catch {
      /* skip batch on error */
    }
  }

  return verified;
}

/** Build a prevalidated Safe signature for the given owner address. */
export function buildPrevalidatedSignature(ownerAddress: string): Hex {
  const ownerPadded = ownerAddress.toLowerCase().replace('0x', '').padStart(64, '0');
  return `0x${ownerPadded}${'0'.repeat(64)}01` as Hex;
}

/** Wrap a set of txs so they execute through a Safe multisig owned by
 *  `ownerAddress`, using a prevalidated signature. */
export function wrapTxsForSafe(
  safeAbi: Abi | undefined,
  ownerAddress: string,
  safeAddress: string,
  txs: TxLike[],
): TxLike[] {
  if (!safeAbi) throw new Error('Safe singleton ABI is unavailable.');

  const signature = buildPrevalidatedSignature(ownerAddress);
  return txs.map((tx) => ({
    to: safeAddress,
    value: '0',
    data: encodeFunctionData({
      abi: safeAbi,
      functionName: 'execTransaction',
      args: [
        tx.to as Address,
        tx.value ? BigInt(tx.value) : 0n,
        (tx.data as Hex) || '0x',
        0,
        0n,
        0n,
        0n,
        zeroAddress,
        zeroAddress,
        signature,
      ],
    }),
  }));
}
