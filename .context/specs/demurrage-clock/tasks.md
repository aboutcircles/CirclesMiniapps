# Demurrage Clock — Tasks

## Phase 1: Scaffold
- [ ] Run `./scripts/new-miniapp.sh demurrage-clock "Demurrage Clock"`
- [ ] Install deps

## Phase 2: Demurrage Engine
- [ ] Implement demurrage formula (per-second decay rate)
- [ ] Real-time counter (setInterval every 1000ms)
- [ ] "Time to zero" calculation
- [ ] Projection calculations (1/7/30/365 day forecasts)

## Phase 3: Wallet + Data
- [ ] `onWalletChange` handler
- [ ] Fetch token balances on connect
- [ ] Lazy SDK init

## Phase 4: Visualisation
- [ ] Large animated balance counter with "melting" CSS effect
- [ ] Circular progress ring (daily erosion %)
- [ ] SVG line chart for balance projections
- [ ] Hourglass "time to zero" display
- [ ] Period selector (1d / 7d / 30d / 1y)

## Phase 5: Polish
- [ ] Educational demurrage card
- [ ] Download snapshot as PNG
- [ ] Loading/error states
- [ ] Responsive layout

## Phase 6: Deploy
- [ ] Build, deploy, register, PR