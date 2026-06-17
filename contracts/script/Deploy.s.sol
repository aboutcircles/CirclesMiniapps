// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {CoffeeStampNFT} from "../src/CoffeeStampNFT.sol";

/**
 * Deploy CoffeeStampNFT to Gnosis Chain.
 *
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url $RPC_URL --broadcast \
 *     --private-key $DEPLOYER_PRIVATE_KEY
 *
 * MINTER env var = the loyalty backend's operator EOA (defaults to the deployer
 * if unset). After deploy, put the printed address into the backend's
 * NFT_CONTRACT_ADDRESS.
 */
contract Deploy is Script {
    function run() external returns (CoffeeStampNFT nft) {
        address minter = vm.envOr("MINTER", msg.sender);
        vm.startBroadcast();
        nft = new CoffeeStampNFT(minter);
        vm.stopBroadcast();
    }
}
