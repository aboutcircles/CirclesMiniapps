# THP for Good — Garage submission

PR target: [aboutcircles/CirclesMiniapps](https://github.com/aboutcircles/CirclesMiniapps) ← fork `gnosis-box/CirclesMiniapps` branch `feat/thp-for-good-garage`.

## App

| Field | Value |
| --- | --- |
| **Slug** | `thp-for-good` |
| **URL** | https://thp.gnosis.box/ |
| **Source repo** | https://github.com/gnosis-box/THP-for-Good |
| **Category** | `garage` |

THP for Good is a Circles miniapp (Next.js) for booking expert mentorship sessions paid in CRC. Revenue splits between experts and the THP for Good treasury.

## PR checklist (Circles Garage)

- [x] Entry in `static/miniapps.json` with `"category": "garage"`
- [x] Square logo `static/app-logos/thp-for-good.png` (512×512)
- [x] HTTPS URL live and embeddable (`frame-ancestors` allows `*.gnosis.io`)
- [x] Unique slug `thp-for-good`
- [x] Transactions via `@aboutcircles/miniapp-sdk` `sendTransactions` only (split PAY, donations, trust) — no Safe-management selectors

## Manual test plan (after merge)

1. Open https://circles.gnosis.io/miniapps/thp-for-good
2. Confirm iframe loads; wallet address appears in header
3. Browse experts on `/`, open an expert profile
4. Complete slot + email + PAY flow (or donate on `/about`)
5. Post-call TRUST on `/calls` (Emitted)

Playground equivalent: https://circles.gnosis.io/playground?url=https://thp.gnosis.box

## Suggested PR title

```
feat: add THP for Good (garage)
```

## Suggested PR body

```markdown
## Summary
Adds **THP for Good** as a Garage mini app — book expert sessions, pay in CRC, fund THP learners.

## Manifest
- **slug:** `thp-for-good`
- **url:** https://thp.gnosis.box/
- **category:** garage

## Testing
- [x] App loads in iframe (CSP `frame-ancestors` includes `*.gnosis.io`)
- [x] Logo committed under `static/app-logos/thp-for-good.png`
- [ ] Verified on `/miniapps/thp-for-good` after deploy (reviewer)

## Transaction policy
Uses `sendTransactions` for CRC split payments and donations only — no `execTransaction` or Safe-management calls.

## Source
https://github.com/gnosis-box/THP-for-Good
```
