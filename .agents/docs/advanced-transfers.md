# Advanced transfers & the backend-trusted pattern

Transitive (pathfinder-routed) CRC transfers, and the "intermediate" miniapp pattern where a backend embeds a signed intent into a transfer and later issues a verifiable receipt.

**Load this when:** building a payment that must route across the trust graph (no direct trust edge), or any flow where a backend must verify a payment landed and issue a signed proof (tickets, receipts, entitlements, payouts).

Reference implementation: `github.com/aboutcircles/intermediate-miniapp-tutorial`. Code below is illustrative from that tutorial (TypeScript - the backend is typically TS even though the standalone `examples/` frontends are JS).

## Pattern R: Transitive / pathfinder transfers

Personal CRC only moves along trust edges. When sender and recipient are not directly trusted, the SDK routes the transfer through the trust graph via the pathfinder.

```javascript
// High-level: SDK builds the routed transfer, host submits it
const route = await sdk.rpc.pathfinder.findMaxFlow(/* from, to, amount */);
if (route.maxFlow === 0n) {
  // No liquid trust path, or balances need wrapping - see failure modes
}

const txs = await avatar.transfer.advanced(recipient, amount, {
  useWrappedBalances: true, // route through wrapped ERC20 balances too
});
// show the route to the user, then submit via the host bridge
```

**Notes:**
- Always confirm a path with `rpc.pathfinder.findMaxFlow` (or inspect the route) before submitting - surface the route to the user.
- `useWrappedBalances: true` lets the pathfinder use wrapped ERC20 holdings, not just raw ERC1155 personal CRC. This often turns a `maxFlow: 0` into a viable route.
- Full pathfinder reference: `@.agents/circles-docs/06-pathfinder-api-reference.md`.

## Pattern S: Backend-trusted payment intent + receipt

The core principle: **the frontend is not trusted.** It may ask the backend to build transactions and ask the host to submit them, but it never verifies payments, signs receipts, or holds secrets.

Roles:

```
Circles Host
  └─ MiniApp iframe (UI + @aboutcircles/miniapp-sdk)
MiniApp Backend
  ├─ builds CRC payment calldata
  ├─ HMAC-signs payment intents
  ├─ matches transfers via the Circles indexer
  └─ signs EIP-712 ticket receipts (dedicated operator key)
Circles RPC / Indexer  → indexed transfer events
User Wallet            → Safe + ERC-4337, via the host
```

### 1. Backend builds an HMAC-signed intent

```ts
type PaymentPayload = {
  v: 1;
  e: string;          // eventId
  t: string;          // ticketTypeId
  b: `0x${string}`;   // buyer address
  x: number;          // expiry timestamp
  n: string;          // random nonce
};
```

Serialize and HMAC-sign it into a single opaque token:

```
crc-ticket.<base64url(payload)>.<hmac>
```

Because the backend can re-verify the HMAC later, the intent does **not** need to be stored in a database.

### 2. Embed the intent into the CRC transfer

The signed token is embedded into the transfer metadata via the transfers builder:

```ts
const txs = await builder.constructAdvancedTransfer(
  buyerAddress,
  organizerAddress,
  amount,
  { txData: paymentDataToBytes(paymentData) },
);

// BigInt cannot cross the JSON boundary - stringify value before returning
return txs.map((tx) => ({ to: tx.to, data: tx.data, value: tx.value.toString() }));
```

The frontend passes these to the host: `await sendTransactions(txs)` (re-hex-encode via `formatTxForHost` - see `@.agents/docs/transactions.md`).

### 3. Match the transfer, then issue a signed receipt

The frontend navigates to `/ticket/<paymentData>` and polls `POST /api/issue-receipt`. The backend verifies the HMAC and searches the Circles indexer for a transfer where:

- recipient equals the organizer address
- embedded metadata contains the same `crc-ticket…` token
- the token HMAC is valid
- buyer / event / ticket fields are valid

On a match, the backend signs an EIP-712 receipt with a **dedicated App Operator EOA**:

```ts
type TicketReceipt = {
  ticketId: string;
  eventId: string;
  ticketTypeId: string;
  buyerAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  amountCrc: string;
  paymentData: string;
  issuedAt: string;
  expiresAt: string;
};

const signature = await operator.signTypedData({
  domain, types, primaryType: 'TicketReceipt', message,
});
```

The operator key **only attests**. It does not hold CRC, receive payments, send transactions, or control organizer funds - the organizer address receives the actual payment. Keep it as a separate key; all secrets stay server-side, never in the frontend or commits.

### 4. Eventual consistency

`sendTransactions()` resolving proves only that the request was submitted - not that the payment is indexed. There are multiple async layers:

```
host approval → ERC-4337 submission → inclusion → indexing → backend verification
```

So `/api/issue-receipt` returns one of three states and the frontend polls with backoff:

```ts
{ status: 'pending' }
{ status: 'ready', signedTicket }
{ status: 'expired' }
```

### 5. Portable proof (offline QR)

When ready, encode the signed receipt as the QR payload:

```ts
base64url(JSON.stringify(signedTicket))
```

A scanner verifies it offline by checking the EIP-712 signature against the operator's public address - no backend call at the door. `signed receipt + operator public address = verifiable ticket`.

## Deployment implication

This pattern needs a **server** (build-payment, issue-receipt, HMAC + operator signing). The static Vite / Vercel-SPA model in `@.agents/docs/ui-shell.md` cannot host the backend - that model is frontend-only. Plan for a backend deployment (or use the Circles Org Manager miniapp, `https://circles.gnosis.io/admin/miniapps-org-manager`, to set up an Org for backend CRC payment processing and payouts).

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `findMaxFlow` returns `maxFlow: 0` | No liquid trust path, or balances unwrapped | Pass `useWrappedBalances: true`; inspect `rpc.pathfinder.findMaxFlow` to confirm any path exists |
| `sendTransactions` resolved but receipt stays `pending` | Indexing/inclusion lag - normal | Keep polling with backoff until `ready` or `expired`; do not assume failure |
| Backend never matches the transfer | Embedded `txData` ≠ the HMAC token the backend expects | Ensure `paymentDataToBytes` is byte-identical on both sides; recipient must equal the organizer address |
| Receipt verifies at build time but fails at the door | Verifier checking wrong key/type | Verify EIP-712 against the operator public address; persist the exact `primaryType`/`domain` |
| Operator key exposure | Key used for anything beyond signing | Keep the operator EOA isolated (no funds, no tx); secrets server-side only, never committed |
