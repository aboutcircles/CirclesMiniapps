# Circles Oracle — Requirements

## User Story
As a Circles user, I want to ask a mystical oracle questions about my economic future and receive answers derived from on-chain data, so that I can be entertained while learning about my trust network and CRC holdings.

## Functional Requirements
- FR1: On wallet connect, display an animated crystal ball or oracle eye visualisation
- FR2: User asks a question (free text input) and taps "Consult the Oracle"
- FR3: Oracle "thinks" — animated loading with swirling particles
- FR4: Answer is generated from deterministic on-chain data — not AI, but derived from hashes and balances
- FR5: Answer categories: Trust forecast, Balance prophecy, Network fortune, Demurrage wisdom
- FR6: Each answer includes a specific on-chain fact (e.g. "You have trusted 7 souls. The constellation favours expansion.")
- FR7: Share fortune as a beautifully formatted card (canvas-to-image download)
- FR8: Daily fortune — hash(address + date) gives a deterministic "daily reading"
- FR9: Fortune history stored in localStorage (no backend)

## Non-Functional Requirements
- NFR1: Must load inside Gnosis wallet iframe
- NFR2: No AI API calls — all "fortune" logic is deterministic from on-chain data
- NFR3: No backend, no database — localStorage for history only
- NFR4: Responsive down to 320px

## Out of Scope
- Actual AI/LLM integration
- Real financial advice
- Writing any on-chain data

## Acceptance Criteria
- [ ] Wallet connection shows oracle scene
- [ ] Asking a question returns a deterministic fortune from on-chain data
- [ ] Fortune includes real balance/trust facts
- [ ] Daily fortune is consistent for same address + date
- [ ] Download fortune card as image