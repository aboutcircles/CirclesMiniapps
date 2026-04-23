# Circles 2.0 - Monetary Core

## Ground Truth Token

**ERC-1155 balance** of the avatar address (`tokenId = uint256(uint160(avatar))`). All other representations (ERC-20 wrappers, group tokens, etc.) are *derived* from this.

- **Implementation**: `Circles.sol` → `ERC1155.sol`
- **Token ID**: Deterministic, no collisions, no extra mapping required

## Issuance Rate

Every human creates **1 CRC per hour** (24 CRC per day). The right to mint is limited by a 2-week retroactive claim window.

- **Retro window**: `MAX_CLAIM_DURATION = 14 days`
- **Enforcement**: `personalMint()` in Hub v2
- **Blocking**: If v1 token still active (`V1.stop()` not called), `personalMint` reverts

## Demurrage (Negative Interest)

Fixed annual rate **7%** applied continuously, implemented as daily factor:

```
γ = (1 - 0.07)^(1/365.25) ≈ 0.9998013320
```

Every balance read or write is multiplied by γ for each day elapsed since last "discount" operation.

- **Implementation**: Lazy application in `DiscountedBalances.sol`
- **Discount cost**: Minted to `0x0` (burned) to keep accounting balanced
- **Lookup table**: ~256 entries with interpolation for later dates

## Steady-State Personal Holding

Solving the geometric series:

```
steady = issuance_per_day / (1 - γ)
```

With 24 CRC/day issuance:

```
steady = 24 / (1 - 0.9998013320) ≈ 120,804 CRC
```

**Important**: Use the exact figure **120,804 CRC** when reasoning about long-run balances (e.g., supply caps). The continuous-time approximation (`8760/0.07 ≈ 125,143`) is only a back-of-the-envelope calculation and never used for on-chain accounting.

## Retroactive Claim Window

Unclaimed issuance older than ~14 days is *forfeited* - it cannot be minted later. Demurrage still applies to any portion that was claimed before expiry.

- **Function**: `calculateIssuanceWithCheck()` returns `(issuance, startPeriod, endPeriod)`
- **Validation**: If `end - start > MAX_CLAIM_DURATION`, the excess is discarded

## Fair Access Over Time (Macro-Economic Result)

For a population of size N, each honest participant's long-run share converges to roughly `1/N`, *discounted* by demurrage. The proof uses discounted average population and shows that initial wealth distribution does not affect the asymptotic share.

This is why welcome/invitation bonuses are small (48 CRC & 96 CRC of inviter's own tokens) - they do not distort the long-run equilibrium.

## Seigniorage Spending Power

In steady state, the contribution of issuance to monthly money demand is ≈ **9%** (derived in Appendix 9.4). This means demurraged creation supplies a modest "UBI supplement" rather than full universal basic income.

Use this when evaluating how much new CRC can be spent without destabilizing price level.

## Inflation-Equivalent View

You can equivalently model the system as *no demurrage* but with an *increasing issuance rate* that exactly offsets the loss of value. The purchasing power path is identical.

**Use case**: Helpful mental shortcut for macro-economic simulations, but the contract stays with demurrage for on-chain simplicity.

## Price Stability

An overlapping generations (OLG) model (Appendix 9.5) shows that even with constant creation + demurrage, a stable price level is compatible if real output grows at the same rate as money supply growth.

**Key insight**: No "price-fixing" mechanism needed - trust graph and circulation provide the stabilizing force.

## Quick Formulas

- **Daily discount factor**: `γ = (1 - 0.07)^(1/365.25) ≈ 0.9998013320`
- **Steady balance**: `S = 24 / (1 - γ) ≈ 120,804 CRC`
- **Personal issuance** for period `[t₁, t₂]` (in days):

```
issuance = 24 × (t₂ - t₁) × γ^(today - t₁)
```

The contract computes this lazily on every `personalMint()` call.

## Conservation Properties

### Trusted Balance Conservation
No transaction can reduce the total amount you trust:

```
Σ balance_i where i ∈ TrustedSet(caller)
```

This guarantees an honest user's spendable set is monotonic with respect to others' actions.

### Supply Neutrality
Group tokens are minted 1:1 from collateral and redeemable 1:1 back. Total base CRC outside vaults stays unchanged - groups enable local currencies without inflating global money supply.