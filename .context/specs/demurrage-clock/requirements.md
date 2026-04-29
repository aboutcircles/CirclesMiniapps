# Demurrage Clock — Requirements

## User Story
As a Circles user, I want to see a beautiful live countdown showing exactly how much CRC I lose to demurrage each second, with visual projections of my future balance, so that I understand and feel motivated to use my Circles.

## Functional Requirements
- FR1: On wallet connect, fetch total CRC balance via `sdk.getAvatar(addr).balances.getTokenBalances()`
- FR2: Display a large animated clock showing real-time demurrage erosion (CRC/year → CRC/day → CRC/second)
- FR3: Animated "melting" effect — balance number visually drips/dissolves
- FR4: Projected balance chart: SVG line graph showing balance decay over 1/7/30/365 days
- FR5: "Time to zero" calculator — when does balance reach 0 at current rate
- FR6: Demurrage rate explanation card (educational: why it exists, how it works)
- FR7: Comparison mode: show erosion vs. potential minting income
- FR8: Share "demurrage snapshot" card as downloadable image

## Non-Functional Requirements
- NFR1: Must load inside Gnosis wallet iframe
- NFR2: No backend — demurrage calculated client-side from on-chain balance
- NFR3: Demurrage formula: approximately 6.8% annual (implemented as per-block decay on-chain)
- NFR4: Timer updates every second, projection chart recalculates on refresh
- NFR5: Responsive down to 320px

## Out of Scope
- Stopping demurrage (impossible)
- Real-time balance sync (refresh to update)
- Financial advice

## Acceptance Criteria
- [ ] Wallet connection shows balance + live demurrage counter
- [ ] Counter ticks down every second in real-time
- [ ] Projection chart shows future balance decay
- [ ] "Time to zero" calculation displays
- [ ] Download snapshot card works