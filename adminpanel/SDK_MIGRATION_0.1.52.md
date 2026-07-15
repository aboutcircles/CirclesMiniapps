# SDK migration map: 0.1.24/0.1.23 → 0.1.52

Reference for adapting the group (was 0.1.24) and org (was 0.1.23) apps to the
unified `@aboutcircles` SDK `0.1.52`. Invitations was already on 0.1.25 ≈ 0.1.52.

**Everything not listed below is UNCHANGED** (avatars, trust, transfers,
balances, `Core`, `BaseGroupContract`, `TransferBuilder`, `cidV0ToHex`,
`onWalletChange`, `sendTransactions`, `registerOrganization`, `getProfileByAddress`,
`getAvatarInfo`, pathfinder, `getGroupHolders` which is still a `PagedQuery`).

## The breaking pattern: paginated query methods now return `PagedResponse`

Several RPC methods changed from returning a raw array (or a sync `PagedQuery`)
to returning `Promise<PagedResponse<T>>` where
`PagedResponse<T> = { results: T[]; hasMore: boolean; nextCursor: string | null }`.
The old code does `(x || []).filter(...)` → throws "filter is not a function".
Row field names inside `.results` are unchanged.

### group (`src/apps/group/`)

1. **`rpc.group.findGroups(limit, params)`** — now `Promise<PagedResponse<GroupRow>>`.
   - `app.js:1813` (fetchGroupsByOwners) → `return normalizeGroups((await ...).results || [])`
   - `app.js:3396` (openGroup) → `groupMeta = (await ...).results?.[0] || null`
2. **`rpc.group.getGroupMembers(group, limit, cursor)`** — was sync `PagedQuery`,
   now `Promise<PagedResponse<GroupMembershipRow>>`. 3rd arg `sortOrder`→`cursor`.
   Re-plumb members paging from `.queryNextPage()/.currentPage` to cursor-based.
   - wrapper `circlesClient.js:157`; consumers around `app.js:2424-2474`.
   - NOTE: sort order no longer controllable here → verify UI ordering w/ wallet.
3. **`new Profiles(...)`** — constructor now `(circlesRpcUrl, profileServiceUrl?)`.
   Passing only the profileServiceUrl double-appends `profiles/` → 404.
   - `circlesClient.js:17` → `new Profiles(core.config.circlesRpcUrl, core.config.profileServiceUrl)`
   - `circlesClient.js:147` → `new Profiles(config.circlesRpcUrl, config.profileServiceUrl)`
4. **`rpc.profile.searchByAddressOrName(q, limit, cursor, avatarTypes)`** — now
   `Promise<ProfileSearchResponse>` (`{results, hasMore, nextCursor, ...}`); 3rd
   arg `offset`→`cursor` (pass `null`, not `0`). Read `.results`.
   - `app.js:1845, 2560, 2660, 2729`

### org (`src/apps/org/`)

1. **`rpc.profile.searchByAddressOrName(q, limit, cursor, avatarTypes)`** — same as
   group #4. `.filter` crash in `filterAcceptedCrcTrustResults`. Pass `null` for
   cursor, read `.results`.
   - `app.js:2058, 2106`
2. **`rpc.group.getGroupMemberships(addr, limit, cursor)`** — was sync `PagedQuery`,
   now `Promise<PagedResponse<GroupMembershipRow>>`. Replace
   `q=...; await q.queryNextPage(); q.currentPage.results` with
   `(await ...).results`.
   - `app.js:431`

## Verify-with-wallet (couldn't fully resolve from typings)

- group member sort order (getGroupMembers cursor change) — confirm UI ordering.
- `Profile` vs old `SearchResultProfile` fields: code reads `.name`,
  `.registeredName`, `.address` on search results — confirm present at runtime.
- org trust search ("Allow CRC") end-to-end after the searchByAddressOrName fix.
- org "Your group" badges (getGroupMemberships) after the fix.
