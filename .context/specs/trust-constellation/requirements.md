# Trust Constellation — Requirements

## User Story
As a Circles user, I want to see my trust network visualised as an interactive starfield so that I can understand my social connections and their economic weight at a glance.

## Functional Requirements
- FR1: On wallet connect, fetch the user's trust relations via `sdk.data.getTrustRelations(address)`
- FR2: Render each trusted contact as a "star" on an HTML5 Canvas starfield
- FR3: Star brightness proportional to CRC balance (fetched via `avatar.balances.getTokenBalances()`)
- FR4: Star size proportional to trust depth (1-hop = medium, 2-hop = small)
- FR5: Animated glowing lines connect trusted nodes
- FR6: Click a star to see profile info (name, address, balance) in an overlay card
- FR7: Search any address to overlay their constellation on the same canvas
- FR8: Zoom and pan the starfield (mouse wheel + drag on desktop, pinch on mobile)
- FR9: Show count of trusted contacts and total trust connections
- FR10: Animate new connections appearing when data loads

## Non-Functional Requirements
- NFR1: Must load inside an iframe (Gnosis wallet host)
- NFR2: Must work with passkey-based Safe accounts
- NFR3: All addresses checksummed via `getAddress()`
- NFR4: Canvas rendering must be smooth at 60fps
- NFR5: Responsive down to 320px width
- NFR6: No backend, no database — all data from SDK reads and on-chain queries
- NFR7: Must complete initial render within 3 seconds of wallet connect

## Out of Scope
- Editing trust relationships (use Gnosis App for that)
- Real-time updates (user refreshes to see changes)
- 3D rendering (keeping it 2D Canvas for performance)
- Persisting any user data

## Acceptance Criteria
- [ ] Wallet connection shown on load
- [ ] Stars appear for each trusted contact within 3s of connect
- [ ] Clicking a star shows profile card with name + balance
- [ ] Search bar allows exploring another address's constellation
- [ ] Zoom and pan work on both desktop and mobile
- [ ] Gnosis design system CSS tokens used throughout