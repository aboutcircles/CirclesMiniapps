# Test Account Flag — Design

## Architecture

Single-page miniapp with two states: **disconnected** (prompt to connect wallet) and **connected** (show flag status + toggle). The app reads the user's Circles profile, checks for an `isTestAccount` field, and allows toggling it via profile update.

### Data Flow
```
1. onWalletChange → connected address
2. Read profile via sdk.rpc.profile.getProfileByAddress()
3. Check profile.isTestAccount (or profile customFields.isTestAccount)
4. Display current status
5. On toggle: read full profile → merge isTestAccount → pin to IPFS → update NameRegistry CID on-chain
```

### Profile Update Strategy
The Circles profile is stored on IPFS. To update it:
1. Fetch existing profile data
2. Merge the `isTestAccount` field into the profile object
3. Pin updated profile via `sdk.profilesClient.create(updatedProfile)` → gets new CID
4. Convert CID to hex digest via `cidV0ToHex()`
5. Call NameRegistry `updateProfile(CID)` on-chain via the runner bridge
6. Wait for receipt confirmation

## File Structure
```
examples/test-account-flag/
├── index.html          # Main UI
├── main.js             # Application logic
├── style.css           # Gnosis design system styling
├── miniapp-sdk.js      # Host bridge (copied)
├── package.json        # Dependencies
├── vite.config.js      # Vite config with node polyfills
├── vercel.json         # Static deployment config
└── README.md           # Documentation
```

## Key SDK Calls
- `sdk.rpc.profile.getProfileByAddress(address)` — read current profile
- `sdk.profilesClient.create(profileObj)` — pin updated profile to IPFS
- `cidV0ToHex(cid)` — convert CID to on-chain digest
- `sdk.core.nameRegistry.updateProfile(address, metadataDigest)` — update on-chain
- Runner bridge via `sendTransactions()` — execute the name registry update

## State Machine
- **DISCONNECTED**: No wallet connected, show connect prompt
- **LOADING**: Wallet connected, fetching profile
- **VIEWING**: Profile loaded, showing current flag status
- **CONFIRMING**: User clicked toggle, showing confirmation dialog
- **UPDATING**: Transaction sent, waiting for confirmation
- **ERROR**: Something went wrong, show error with retry

## Data Model
```javascript
// Profile shape (from SDK)
{
  name: string,
  description: string,
  imageUrl: string,
  isTestAccount: boolean,  // our custom field
  // ... other extensible fields
}

// App state
{
  connectedAddress: string | null,
  profile: object | null,
  isTestAccount: boolean,
  isLoading: boolean,
  isUpdating: boolean,
  error: string | null
}