# Trust Garden — Requirements

## User Story
As a Circles user, I want to see my trust network as a living garden where each trusted contact is a plant whose health and growth reflect their CRC activity, so that I can emotionally connect with my economic community.

## Functional Requirements
- FR1: On wallet connect, fetch trust relations and render the user's "garden"
- FR2: Each trusted contact = one plant on an HTML Canvas garden scene
- FR3: Plant species chosen by deterministically hashing the contact's address (e.g. keccak256 → seed → rose/tree/fern/sunflower)
- FR4: Plant height/growth stage proportional to CRC balance (fetched via balances API)
- FR5: Trust depth determines placement distance from garden centre (1-hop near, 2-hop far)
- FR6: Animated scene: gentle sway, butterflies for active senders, rain drops for recent receivers
- FR7: Click a plant to see profile info card (name, address, balance, last activity)
- FR8: Garden stats panel: total plants (trusts), garden health (avg balance), most active contact
- FR9: Share garden snapshot as a canvas-to-image download

## Non-Functional Requirements
- NFR1: Must load inside Gnosis wallet iframe
- NFR2: No backend, no database — all state from on-chain reads
- NFR3: Deterministic — same address always produces same plant species
- NFR4: Canvas rendering smooth at 60fps
- NFR5: Responsive down to 320px

## Out of Scope
- Planting new trust relations (use Gnosis App)
- Real-time growth (user refreshes)
- Saving garden layouts

## Acceptance Criteria
- [ ] Wallet connection shows personalised garden
- [ ] Each trusted contact rendered as unique plant species
- [ ] Plants animate (sway, grow)
- [ ] Click shows profile card
- [ ] Download garden image works