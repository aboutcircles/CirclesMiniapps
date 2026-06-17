# CoffeeStampNFT

The free-coffee reward token for the [Coffee Loyalty miniapp](../src/routes/apps/coffee-loyalty).
A minimal, self-contained ERC-721 (no external libraries). One `minter` — the
loyalty backend's operator EOA — mints a token to a customer when they reach 10
stamps. The store owner reads ownership + `redeemed` and flips `redeemed` at the till.

## Build & test

Requires [Foundry](https://book.getfoundry.sh/getting-started/installation).

```sh
# forge-std is the only dependency (used by the test + deploy script)
forge install foundry-rs/forge-std --no-git   # or: forge install foundry-rs/forge-std

forge build
forge test
```

## Deploy (Gnosis Chain)

```sh
export RPC_URL=https://rpc.gnosischain.com
export MINTER=0x<backend-operator-eoa>          # the loyalty backend's hot EOA
forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --broadcast \
  --private-key 0x<deployer-key>
```

Put the deployed address into the loyalty backend's `NFT_CONTRACT_ADDRESS`.

## Interface

| Function | Who | Purpose |
|---|---|---|
| `mint(address to) → uint256` | minter | Issue a free-coffee NFT, returns tokenId |
| `redeem(uint256 tokenId)` | holder or minter | Mark the coffee as served (once) |
| `redeemed(uint256) → bool` | anyone | Has this voucher been used |
| `ownerOf` / `balanceOf` / `tokenURI` | anyone | Standard ERC-721 reads |
| `setMinter(address)` | owner | Rotate the backend hot key |
