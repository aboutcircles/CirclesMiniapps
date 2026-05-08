# Circles 2.0 - Economics & Network Properties

## Trust Graph & Global Payments

Each avatar only needs to maintain *outgoing* trust edges. When Alice wants to pay Bob, the protocol finds a **trust-consistent path** through intermediate avatars (each edge respects the trust rule). The user sees a single payment; internally value hops across multiple balances, preserving total demurraged supply.

## Conservation of "Trusted Balance"

No transaction can reduce the *total amount you trust* (`Σ balance_i where i ∈ TrustedSet(caller)`). This guarantees an honest user's spendable set is monotonic with respect to others' actions - a key anti-censorship property (white-paper §§4.2-4.3).

## Sybil Resistance (Relative)

Suppose an attacker controls **M** malicious avatars. Their ability to push value into honest region **R** is bounded by the *trusted balance on the boundary*:

```
F = Σ_{h∈Boundary(R)} balance_h
```

The more you limit trust to unknown accounts, the smaller `F` becomes - attacks are throttled (Fig 5 in white-paper).

## Average Spendable Fraction (ASF)

**ASF** = expected fraction of a user's total holdings that can be spent within a given subset of avatars. In dense social graphs with diversified holdings, ASF quickly approaches 1, meaning the network behaves like a single fungible currency for practical purposes (white-paper §4.4).

## Liquidity Clusters & Exchange Rates

### Liquidity Cluster Definition
A set where every member holds at least α of its own token and trusts all others. Inside the cluster, any α of currency A can be swapped for α of currency B (and back). Within such clusters, exchange rates collapse to 1:1.

### Exchange-Rate Monotonicity
If avatar *n* trusts *n'*, then the value function satisfies `V(n') ≥ V(n)`. Arbitrage forces all rates to be representable as a ratio of these values (white-paper §§4.5.2-4.5.3).

## Max-Flow Characterisation

The **maximum transferable trusted balance** from sender set Nₛ to receiver set Nᵣ equals the **minimum cut capacity** in a graph where:
- Each node is an `(avatar, currency)` pair
- Edges are trust relationships with capacities equal to the *trusted balance*

(Appendix 9.7) This gives a tight upper bound on any single-shot payment.

## Price Stability & Inflation Equivalence

### OLG Model
The overlapping-generations model in Appendix 9.5 proves that despite constant creation and demurrage, **prices can be stable** if real output grows at the same rate as money supply (true when demurraged creation matches economic growth).

### Equivalence Proof
You can think of the system either as:
- **Demurrage on balances**, OR
- **Inflationary issuance**

Both give identical real-price paths. No arbitrage opportunities arise from the accounting choice.

## Economic Recap (One Paragraph)

Every human continuously creates a *fixed* amount of demurraged CRC, while 7% annual decay automatically reallocates purchasing power toward currently active participants. Trust relationships form a directed graph that guarantees any value transfer can be routed without decreasing the total "trusted balance" of any participant. The max-flow/min-cut theorem bounds how much an attacker can push into the honest region, giving *relative* Sybil resistance. Because groups mint 1:1 against collateral and redeem 1:1 back, they don't alter global supply but enable local currencies and liquidity clusters where exchange rates collapse to 1:1. The OLG macro model shows that with demurrage, the price level can remain stable even while money is constantly created, and the system's equivalence to an inflationary issuance model guarantees no arbitrage opportunities arise from the accounting choice. Hence the protocol behaves like a *self-stabilising* universal basic income + trust-based payment network.

## Key Economic Formulas

- **Seigniorage spending power**: ≈ 9% of monthly money demand
- **Steady-state balance**: 120,804 CRC per active human
- **Sybil attack bound**: `F = Σ_{h∈Boundary(R)} balance_h`
- **ASF in dense graphs**: Approaches 1.0
- **Exchange rate monotonicity**: `V(n') ≥ V(n)` if n trusts n'