import { createHmac, timingSafeEqual } from 'node:crypto';
import { kv } from '@vercel/kv';
import {
  createPublicClient,
  createWalletClient,
  http,
  getAddress,
  encodeFunctionData,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { decodeCrcV2TransferData } from '@aboutcircles/sdk-utils';
import { editionAbi } from './_abi.js';

const STATE_PENDING = 'pending';
const STATE_SETTLED = 'settled';
const STATE_EXPIRED = 'expired';

function hmac(secret, body) {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function parsePaymentData(paymentData, secret) {
  if (typeof paymentData !== 'string') throw new Error('paymentData must be a string');
  const parts = paymentData.split('.');
  if (parts.length !== 3 || parts[0] !== 'crc-nft') throw new Error('malformed paymentData');
  const [, payload, sig] = parts;
  const expected = hmac(secret, payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('bad HMAC');
  let intent;
  try {
    intent = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('invalid intent payload');
  }
  if (intent.v !== 1) throw new Error('unsupported intent version');
  return intent;
}

let _publicClient;
function publicClient() {
  if (_publicClient) return _publicClient;
  _publicClient = createPublicClient({
    chain: gnosis,
    transport: http(process.env.GNOSIS_RPC_URL || 'https://rpc.aboutcircles.com/'),
  });
  return _publicClient;
}

let _walletClient;
let _operatorAccount;
function walletClient() {
  if (_walletClient) return _walletClient;
  const pk = process.env.APP_OPERATOR_PK;
  if (!pk) throw new Error('APP_OPERATOR_PK unset');
  _operatorAccount = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
  _walletClient = createWalletClient({
    account: _operatorAccount,
    chain: gnosis,
    transport: http(process.env.GNOSIS_RPC_URL || 'https://rpc.aboutcircles.com/'),
  });
  return _walletClient;
}

async function findMatchingTransfer(intent) {
  const url = process.env.CIRCLES_RPC_URL || 'https://rpc.aboutcircles.com/';
  const body = {
    jsonrpc: '2.0',
    id: 1,
    method: 'circles_events',
    params: [intent.s, null, null, ['CrcV2_TransferData']],
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`indexer error ${r.status}`);
  const json = await r.json();
  const events = json?.result || [];

  for (const ev of events) {
    const data = ev?.data ?? ev?.values?.data;
    if (!data || typeof data !== 'string') continue;
    let decoded;
    try {
      decoded = decodeCrcV2TransferData(data);
    } catch {
      continue;
    }
    const payload = decoded?.payload;
    const ref = typeof payload === 'string' ? payload : null;
    if (!ref) continue;
    if (ref === intent.__paymentData) {
      return ev;
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid JSON' });
  }

  const secret = process.env.APP_HMAC_SECRET;
  if (!secret) return res.status(500).json({ error: 'APP_HMAC_SECRET unset' });

  const paymentData = body?.paymentData;
  if (!paymentData) return res.status(400).json({ error: 'paymentData required' });

  let intent;
  try {
    intent = parsePaymentData(paymentData, secret);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // Idempotency: if we've already settled or expired, return the stored result.
  const kvKey = `settle:${paymentData}`;
  const stored = await kv.get(kvKey);
  if (stored) {
    return res.status(200).json(stored);
  }

  const now = Math.floor(Date.now() / 1000);
  if (now > intent.x) {
    const out = { status: STATE_EXPIRED };
    await kv.set(kvKey, out, { ex: 60 * 60 * 24 });
    return res.status(200).json(out);
  }

  // Find a matching CrcV2_TransferData event by reference.
  intent.__paymentData = paymentData;
  let event;
  try {
    event = await findMatchingTransfer(intent);
  } catch (err) {
    return res.status(502).json({ status: STATE_PENDING, error: err.message });
  }

  if (!event) {
    return res.status(200).json({ status: STATE_PENDING });
  }

  // Call Edition.settle(tokenId, buyer) from the operator EOA.
  let txHash;
  try {
    const wc = walletClient();
    const data = encodeFunctionData({
      abi: editionAbi,
      functionName: 'settle',
      args: [BigInt(intent.t), getAddress(intent.b)],
    });
    txHash = await wc.sendTransaction({ to: getAddress(intent.c), data, value: 0n });
    await publicClient().waitForTransactionReceipt({ hash: txHash });
  } catch (err) {
    return res.status(500).json({ status: STATE_PENDING, error: 'settle failed: ' + err.message });
  }

  const out = {
    status: STATE_SETTLED,
    txHash,
    matchTxHash: event?.transactionHash ?? null,
  };
  await kv.set(kvKey, out, { ex: 60 * 60 * 24 * 30 });
  return res.status(200).json(out);
}
