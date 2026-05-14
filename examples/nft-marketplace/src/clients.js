import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';
import { GNOSIS_RPC_URL } from './contracts.js';

let _publicClient;

export function getPublicClient() {
  if (_publicClient) return _publicClient;
  _publicClient = createPublicClient({
    chain: gnosis,
    transport: http(GNOSIS_RPC_URL),
  });
  return _publicClient;
}

export function ipfsToHttp(uri) {
  if (!uri) return null;
  if (uri.startsWith('ipfs://')) {
    const cid = uri.slice('ipfs://'.length);
    return `https://${cid}.ipfs.dweb.link`;
  }
  return uri;
}

export function shortAddr(addr) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatCrc(wei) {
  if (wei == null) return '—';
  const value = typeof wei === 'bigint' ? wei : BigInt(wei);
  const whole = value / 10n ** 18n;
  const frac = value % 10n ** 18n;
  if (frac === 0n) return `${whole}`;
  // Show up to 4 fractional digits, trimmed.
  const fracStr = frac.toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}
