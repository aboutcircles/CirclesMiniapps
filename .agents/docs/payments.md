# Payment patterns

CRC payments come in three distinct flavours depending on what the recipient accepts and what flow you're building. Picking the wrong one is a common source of silent failures.

**Load this when:** building any payment, tipping, donation, or commerce flow.

## Token representations

CRC exists in multiple forms. Which one you use depends on the use case:

| Representation | Standard | Token ID / Address | When to use |
|---|---|---|---|
| **Personal CRC** | Hub V2 ERC1155 | `uint256(avatarAddress)` | Tipping, social apps, direct peer transfers |
| **Group CRC** | Hub V2 ERC1155 | `uint256(groupAddress)` | Rarely held directly - usually wrapped |
| **Wrapped group CRC** | Inflationary ERC20 wrapper | Wrapper contract address | **Most common for payments** - what wallets actually hold |

> **Rule of thumb**: if a recipient accepts payments via "trust" (gateways, orgs, merchants), they accept group tokens, and users pay with the **wrapped ERC20** form. If you're moving CRC between two users socially, use **personal CRC** via Hub V2.

## Discovering accepted tokens

Payment gateways and orgs accept tokens from groups they **trust**. Query the gateway's trust list to find what's accepted:

```javascript
const trustedBy = await circlesQuery(
  'CrcV2_PaymentGateway', 'TrustUpdated',
  ['trustReceiver', 'expiry'],
  [{ column: 'gateway', value: gatewayAddress.toLowerCase() }]
);
// Each trustReceiver is a group whose tokens this gateway accepts
```

For each trusted group, find the wrapper address from the user's balances:

```javascript
const balances = await sdk.rpc.balance.getTokenBalances(userAddress);
const groupWrapped = balances.filter(b =>
  b.isWrapped && b.tokenOwner.toLowerCase() === groupAddress.toLowerCase()
);
// groupWrapped[0].tokenAddress = the ERC20 wrapper contract for this group
```

Present the user with whichever wrapped tokens they hold *and* the recipient trusts.

## Pattern E1: Wrapped group CRC payment (most common)

Standard ERC20 `transfer` to the wrapper contract. Use this for payments to gateways, orgs, or any recipient that trusts a group.

```javascript
import { encodeFunctionData } from 'viem';
import { sendTransactions } from '@aboutcircles/miniapp-sdk';

const ERC20_TRANSFER_ABI = [{
  type: 'function',
  name: 'transfer',
  inputs: [
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  outputs: [{ name: '', type: 'bool' }],
}];

const data = encodeFunctionData({
  abi: ERC20_TRANSFER_ABI,
  functionName: 'transfer',
  args: [recipientAddress, amountWei],
});

const hashes = await sendTransactions([{
  to: wrapperAddress,  // discovered via getTokenBalances - see above
  data,
  value: '0x0',
}]);
```

## Pattern E2: Personal CRC transfer (tipping, social)

Use Hub V2 `safeTransferFrom` with the sender's address as the token ID. This is the right pattern for tipping, vouching, or any social interaction.

```javascript
import { encodeFunctionData } from 'viem';

const HUB_V2 = '0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8';

const HUB_TRANSFER_ABI = [{
  type: 'function',
  name: 'safeTransferFrom',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'id', type: 'uint256' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
}];

const tokenId = BigInt(connectedAddress); // personal CRC = sender's address as uint256
const data = encodeFunctionData({
  abi: HUB_TRANSFER_ABI,
  functionName: 'safeTransferFrom',
  args: [connectedAddress, recipientAddress, tokenId, amountWei, '0x'],
});

const hashes = await sendTransactions([{ to: HUB_V2, data, value: '0x0' }]);
```

## Pattern E3: Marketplace API payment (structured commerce)

For miniapps that sell products through the Circles marketplace (baskets, orders, multi-seller fulfilment), use the Marketplace API instead of direct on-chain transfers. The API handles basket validation, order creation, payment tracking via SSE, and multi-seller settlement.

**Flow**: create basket → add items → preview → checkout → pay on-chain → SSE tracks fulfilment.

```javascript
// 1. Checkout a basket - returns orderId + paymentReference
const checkoutRes = await fetch(
  `${MARKETPLACE_API}/api/cart/v1/baskets/${basketId}/checkout`,
  {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}` },
  }
);
const { orderId, paymentReference } = await checkoutRes.json();

// 2. Pay on-chain using the paymentReference (via Pattern E1 ERC20 transfer)
//    The recipient is the gateway/org address from the order

// 3. Track order status via SSE
const sse = new EventSource(`${MARKETPLACE_API}/api/cart/v1/orders/${orderId}/status`);
sse.addEventListener('order_status_update', (e) => {
  const { status } = JSON.parse(e.data);
  // status: OrderProcessing → OrderDelivered etc.
});
```

For full endpoint reference, load `@.agents/circles-docs/08-marketplace-api.md`.

## Choosing the right pattern

| Scenario | Pattern | Token type |
|---|---|---|
| Pay a gateway/org for goods (simple) | E1 | Wrapped group CRC (ERC20) |
| Pay via Circles marketplace (catalogue, orders) | E3 | Wrapped group CRC via marketplace checkout |
| Tip another user | E2 | Personal CRC (ERC1155) |
| Social interactions (vouch, like, gift) | E2 | Personal CRC (ERC1155) |
| Multi-group acceptance | E1 × N | Query trusted groups, let user choose |
| Multi-seller orders with fulfilment | E3 | Marketplace API handles routing |

> **When deciding between E1 and E3**: E3 if the miniapp integrates with the Circles marketplace catalogue (products, sellers, baskets, orders). E1 for simple direct payments where the miniapp manages its own fulfilment (ticket grants, tips, donations).

> **Beyond E1/E2/E3**: for transitive (pathfinder-routed) transfers across the trust graph, or for embedding a signed payment intent into a transfer so a backend can later match and issue a receipt, see `@.agents/docs/advanced-transfers.md`.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Transfer reverts with "untrusted" error | Recipient doesn't trust the token's group | Query `TrustUpdated` events first, only offer trusted tokens |
| User has the token but transfer still fails | Wrong wrapper address used | Re-fetch from `getTokenBalances` filtered to `isWrapped: true` |
| Personal CRC transfer fails to non-trustor | Recipient hasn't trusted the sender | Personal CRC requires trust between sender and recipient |
| Marketplace SSE drops mid-flow | Connection interruption | Reconnect to the SSE endpoint with `Last-Event-ID` header |
