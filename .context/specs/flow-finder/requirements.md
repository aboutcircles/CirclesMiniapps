# Flow Finder — Requirements

## User Story
As a Circles user, I want to visualise the transfer paths between my wallet and any other address so that I can understand how value flows through the trust network.

## Functional Requirements
- FR1: On wallet connect, show the user's address as the source node
- FR2: Accept a destination address input (text field or ENS)
- FR3: Query transfer history between source and destination via `circlesQuery('CrcV2', 'Transfer', ...)`
- FR4: Render path as animated SVG/Canvas flow diagram — nodes are addresses, edges are transfers
- FR5: Edge thickness proportional to transfer volume
- FR6: Edge direction shown with animated particles flowing along the path
- FR7: Hover/click a node to see profile name, address, total sent/received
- FR8: Hover/click an edge to see transfer count and total value
- FR9: Show summary stats: total transfers, total volume, unique intermediaries
- FR10: Auto-resolve profile names for all addresses in the path

## Non-Functional Requirements
- NFR1: Must load inside Gnosis wallet iframe
- NFR2: All addresses checksummed
- NFR3: No backend — all data from SDK + CirclesRPC queries
- NFR4: Canvas/SVG must render smoothly for up to 50 nodes
- NFR5: Responsive down to 320px

## Out of Scope
- Predicting future flows
- Real-time streaming updates
- Payment execution (read-only visualisation)

## Acceptance Criteria
- [ ] Wallet connection works
- [ ] Entering a destination address shows transfer paths
- [ ] Animated particles flow along edges
- [ ] Clicking nodes/edges shows detail cards
- [ ] Summary stats display correctly