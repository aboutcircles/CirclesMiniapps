# Test Account Flag — Requirements

## User Story
As a Circles user with test accounts, I want to flag my own accounts as "test accounts" so that analytics, TMS services, and group management can exclude them from real-user metrics and interactions.

## Functional Requirements
- FR1: User must be logged in (wallet connected) to view or change their flag status
- FR2: On load, display the user's current test-account flag status
- FR3: Provide a toggle button to flag/unflag the connected account as a test account
- FR4: Flagging writes `isTestAccount: true` to the user's Circles profile (IPFS)
- FR5: Unflagging removes the `isTestAccount` field (or sets to false)
- FR6: The flag is stored in the extensible profile metadata — not in a separate database
- FR7: Only the account owner can flag their own account (enforced by wallet signature via NameRegistry update)
- FR8: Show confirmation dialog before flagging/unflagging

## Non-Functional Requirements
- NFR1: Must load inside the Gnosis wallet iframe
- NFR2: Must work with passkey-based Safe accounts
- NFR3: All transaction values in hex
- NFR4: All addresses checksummed
- NFR5: Follow Gnosis wallet design system (warm beige, navy text, brand blue accents)

## Out of Scope
- Bulk flagging of accounts
- Admin/superuser flagging of others' accounts
- Automated bot/contract detection (handled by separate service)
- TMS integration (depends on backend, separate task)
- Analytics dashboard filtering (separate task)
- Invitebot batch processing (separate task)

## Acceptance Criteria
- [ ] Wallet connection shown on load
- [ ] Current test-account flag status displayed
- [ ] User can flag their account as test (writes to profile)
- [ ] User can unflag their account
- [ ] Error states handled gracefully (no profile, RPC failure, tx rejection)
- [ ] Only connected wallet owner can modify their own flag