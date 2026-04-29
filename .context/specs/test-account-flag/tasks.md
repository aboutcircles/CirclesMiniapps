# Test Account Flag — Tasks

## Phase 1: Scaffold
- [ ] Create directory structure with `miniapp-sdk.js`, `package.json`, `vite.config.js`, `vercel.json`
- [ ] Install dependencies

## Phase 2: Wallet Integration
- [ ] Implement `onWalletChange` handler
- [ ] Show connected/disconnected states

## Phase 3: Profile Reading
- [ ] Fetch profile via `sdk.rpc.profile.getProfileByAddress()`
- [ ] Display current `isTestAccount` flag status
- [ ] Handle no-profile case

## Phase 4: Profile Writing (Flag Toggle)
- [ ] Build updated profile object with `isTestAccount` field
- [ ] Pin to IPFS via `sdk.profilesClient.create()`
- [ ] Build NameRegistry `updateProfile` transaction
- [ ] Send via runner bridge with receipt polling
- [ ] Implement unflag (set `isTestAccount: false`)

## Phase 5: UI Polish
- [ ] Confirmation dialog before flag/unflag
- [ ] Loading states during profile fetch and tx
- [ ] Success/error toast notifications
- [ ] Passkey auto-connect error handling
- [ ] Standalone mode detection

## Phase 6: Deploy
- [ ] Build and deploy to Vercel
- [ ] Disable deployment protection
- [ ] Register in `static/miniapps.json`
- [ ] Open PR