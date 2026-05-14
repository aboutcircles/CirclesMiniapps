import { createPublicClient, http, getAddress, encodeFunctionData } from 'viem';
import { gnosis } from 'viem/chains';
import { encodeCrcV2TransferData } from '@aboutcircles/sdk-utils';
import { Sdk } from '@aboutcircles/sdk';
import { editionAbi, erc20Abi } from './_abi.js';
import { buildPaymentData, newNonce, INTENT_TTL_SECONDS } from './_intent.js';

let _publicClient;
function publicClient() {
  if (_publicClient) return _publicClient;
  _publicClient = createPublicClient({
    chain: gnosis,
    transport: http(process.env.GNOSIS_RPC_URL || 'https://rpc.aboutcircles.com/'),
  });
  return _publicClient;
}

let _sdk;
async function sdk() {
  if (_sdk) return _sdk;
  // Reads only - pass null for the runner. We use the SDK to construct the advanced
  // CRC transfer calldata so the host wallet's host-side execution embeds the
  // signed paymentData on-chain.
  _sdk = new Sdk(null, {
    circlesRpcUrl: process.env.CIRCLES_RPC_URL || 'https://rpc.aboutcircles.com/',
  });
  return _sdk;
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

  const collection = body?.collection ? getAddress(body.collection) : null;
  const buyer = body?.buyer ? getAddress(body.buyer) : null;
  const tokenIdRaw = body?.tokenId;

  if (!collection || !buyer || tokenIdRaw == null) {
    return res.status(400).json({ error: 'collection, tokenId, buyer required' });
  }

  const tokenId = BigInt(tokenIdRaw);

  // Read the on-chain listing + buy fee in parallel.
  let seller, price, buyFee, wrappedCrc;
  try {
    const pc = publicClient();
    const [listing, buyFeeBps, wrappedCrcAddr] = await Promise.all([
      pc.readContract({ address: collection, abi: editionAbi, functionName: 'listings', args: [tokenId] }),
      pc.readContract({ address: collection, abi: editionAbi, functionName: 'buyFeeBps' }),
      pc.readContract({ address: collection, abi: editionAbi, functionName: 'wrappedCrc' }),
    ]);
    seller = listing[0];
    price = listing[1];
    buyFee = (price * BigInt(buyFeeBps)) / 10_000n;
    wrappedCrc = wrappedCrcAddr;
  } catch (err) {
    return res.status(400).json({ error: 'failed to read listing', detail: err.message });
  }

  if (!seller || seller === '0x0000000000000000000000000000000000000000') {
    return res.status(400).json({ error: 'token is not listed' });
  }
  if (price === 0n) {
    return res.status(400).json({ error: 'listing has zero price' });
  }
  if (getAddress(seller) === getAddress(buyer)) {
    return res.status(400).json({ error: 'buyer cannot be seller' });
  }

  const now = Math.floor(Date.now() / 1000);
  const intent = {
    v: 1,
    c: collection,
    t: tokenId.toString(),
    b: buyer,
    s: getAddress(seller),
    p: price.toString(),
    x: now + INTENT_TTL_SECONDS,
    n: newNonce(),
  };
  const paymentData = buildPaymentData(intent, secret);

  // Encode the paymentData into a Circles transfer-data payload (type 0x0001 - UTF-8 ref).
  const encodedTransferData = encodeCrcV2TransferData([paymentData], 0x0001);

  let txs;
  try {
    const builder = await sdk();
    txs = await builder.constructAdvancedTransfer(
      buyer,
      getAddress(seller),
      price,
      { txData: encodedTransferData },
    );
  } catch (err) {
    return res.status(500).json({
      error: 'failed to build CRC transfer',
      detail: err.message,
      hint: 'Verify @aboutcircles/sdk constructAdvancedTransfer signature for this version',
    });
  }

  // Serialise BigInt -> string for the JSON wire boundary.
  const sdkTxs = (Array.isArray(txs) ? txs : [txs]).map((tx) => ({
    to: tx.to,
    data: tx.data,
    value: tx.value != null ? tx.value.toString() : '0',
  }));

  // Prepend an ERC-20 approval so `settle()` can pull the buy fee from the
  // buyer at settlement time. If the buyer has already approved at-or-above
  // this amount (e.g. infinite approval from a previous purchase), the
  // approve is a near-no-op.
  const finalTxs = [];
  if (buyFee > 0n) {
    finalTxs.push({
      to: getAddress(wrappedCrc),
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [collection, buyFee],
      }),
      value: '0',
    });
  }
  finalTxs.push(...sdkTxs);

  return res.status(200).json({
    paymentData,
    expiresAt: intent.x,
    txs: finalTxs,
    listing: {
      collection,
      tokenId: tokenId.toString(),
      seller: intent.s,
      buyer,
      price: intent.p,
      buyFee: buyFee.toString(),
      totalCost: (price + buyFee).toString(),
    },
  });
}
