# Circles Marketplace API

> Context7 library ID: `/aboutcircles/marketplace-api`
> Always fetch latest docs from Context7 before implementing marketplace integrations.

## Overview

The Marketplace API provides structured commerce for Circles — product catalogues, baskets, orders, and CRC payment tracking. It sits between the miniapp frontend and on-chain CRC payments, handling validation, multi-seller routing, and fulfilment status.

## Core Flow

```
Browse → Add to basket → Preview order → Checkout → Pay on-chain → Track via SSE
```

## Authentication

All buyer/seller endpoints require a JWT with `addr` (Gnosis address) and `chainId` claims.

## Key Endpoints

### Baskets

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/cart/v1/baskets/{basketId}/preview` | Generate a non-persistent order preview (totals, line items) |
| POST | `/api/cart/v1/baskets/{basketId}/checkout` | Convert basket → immutable Order; returns `orderId` + `paymentReference` |

### Orders

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/cart/v1/orders/{orderId}` | Full order details (buyer view) |
| GET | `/api/cart/v1/orders/{orderId}/status` | SSE stream of order status updates |
| GET | `/api/cart/v1/orders/by-buyer` | List orders for authenticated buyer |
| GET | `/api/cart/v1/orders/{orderId}/as-seller` | Single order (seller view, filtered line items) |
| GET | `/api/cart/v1/orders/by-seller` | List orders for authenticated seller |

### Order Status Values

Orders follow schema.org status URIs:
- `https://schema.org/OrderProcessing` — payment pending or being confirmed
- `https://schema.org/OrderDelivered` — fulfilment complete

### Checkout Response

```json
{
  "orderId": "ord_A1B2...",
  "basketId": "bkt_01JC...",
  "paymentReference": "pay_X1Y2...",
  "orderCid": null
}
```

The `paymentReference` is used to link the on-chain CRC payment back to the order.

### Order Snapshot (schema.org)

```json
{
  "@context": "https://schema.org/",
  "@type": "Order",
  "orderNumber": "ord_01JC...",
  "orderStatus": "https://schema.org/OrderProcessing",
  "customer": { "@type": "Person", "@id": "eip155:100:0x<buyer>" },
  "broker": { "@type": "Organization", "@id": "eip155:100:0x<operator>" },
  "acceptedOffer": [
    {
      "@type": "Offer",
      "price": 19.0,
      "priceCurrency": "EUR",
      "seller": { "@type": "Organization", "@id": "eip155:100:0x<seller>" }
    }
  ],
  "orderedItem": [
    {
      "@type": "OrderItem",
      "orderQuantity": 2,
      "orderedItem": { "@type": "Product", "sku": "tee-black" },
      "productCid": "Qm..."
    }
  ],
  "totalPaymentDue": {
    "@type": "PriceSpecification",
    "price": 38.0,
    "priceCurrency": "EUR"
  },
  "paymentUrl": "https://pay.example/tx/..."
}
```

## Payment Integration

After checkout, the buyer pays on-chain using the gateway/org address from the order. The on-chain payment uses **wrapped group CRC** (ERC20 `transfer`) — see AGENT.md Pattern E1.

The marketplace API tracks payment confirmation and updates the order status. Miniapps can subscribe to status changes via the SSE endpoint.

## When to Use

| Use case | Use marketplace API? |
|---|---|
| Product catalogue with multiple sellers | Yes — handles multi-seller routing |
| Order history / receipts | Yes — provides buyer and seller order views |
| Simple one-off payment (ticket, tip, donation) | No — use Pattern E1/E2 directly |
| Structured commerce with fulfilment tracking | Yes — SSE status updates |
