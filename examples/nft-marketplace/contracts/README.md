# NFT Marketplace contracts

Foundry project. Solidity 0.8.24, OpenZeppelin 5.1.

## Install deps

`lib/` is gitignored. After cloning, restore the deps:

```bash
forge install --no-git \
  OpenZeppelin/openzeppelin-contracts@v5.1.0 \
  OpenZeppelin/openzeppelin-contracts-upgradeable@v5.1.0
forge install --no-git foundry-rs/forge-std
```

## Build & test

```bash
forge build
forge test
```

## Deploy to Gnosis

```bash
export DEPLOYER_PRIVATE_KEY=0x...   # EOA with xDAI for gas
export OPERATOR_ADDRESS=0x...        # App Operator EOA - settles paid listings
export GNOSISSCAN_API_KEY=...        # for verification

forge script script/Deploy.s.sol \
  --rpc-url https://rpc.gnosischain.com \
  --broadcast --verify \
  --verifier-url https://api.gnosisscan.io/api \
  --etherscan-api-key $GNOSISSCAN_API_KEY
```

After deploy, `deployments/gnosis.json` will hold the factory address, impl address, and the deploy block. Copy those into the miniapp's Vercel env (`VITE_FACTORY_ADDRESS`, `VITE_DEPLOY_BLOCK`).

The wrapped CRC defaults to the locked s-gCRC at `0xeeF7B1f06B092625228C835Dd5D5B14641D1e54A`.
