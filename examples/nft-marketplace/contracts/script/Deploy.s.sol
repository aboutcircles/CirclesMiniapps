// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import {Edition} from "../src/Edition.sol";
import {EditionsFactory} from "../src/EditionsFactory.sol";

/// @notice Deploys the Edition implementation + EditionsFactory to Gnosis Chain.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  - deployer EOA, must hold xDAI for gas
///   WRAPPED_CRC_ADDRESS   - s-gCRC ERC-20 address (locked to BaseGroup)
///   OPERATOR_ADDRESS      - App Operator EOA that can call Edition.settle
///
/// Usage:
///   forge script script/Deploy.s.sol \
///     --rpc-url https://rpc.gnosischain.com \
///     --broadcast \
///     --verify \
///     --verifier-url https://api.gnosisscan.io/api \
///     --etherscan-api-key $GNOSISSCAN_API_KEY
contract Deploy is Script {
    address constant DEFAULT_WRAPPED_CRC = 0xeeF7B1f06B092625228C835Dd5D5B14641D1e54A;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address wrappedCrc = vm.envOr("WRAPPED_CRC_ADDRESS", DEFAULT_WRAPPED_CRC);
        address operator = vm.envAddress("OPERATOR_ADDRESS");

        require(wrappedCrc != address(0), "wrapped CRC unset");
        require(operator != address(0), "operator unset");

        vm.startBroadcast(deployerKey);
        Edition impl = new Edition();
        EditionsFactory factory = new EditionsFactory(address(impl), wrappedCrc, operator);
        vm.stopBroadcast();

        console.log("Edition implementation:", address(impl));
        console.log("EditionsFactory:       ", address(factory));
        console.log("Wrapped CRC:           ", wrappedCrc);
        console.log("Operator:              ", operator);
        console.log("Block number:          ", block.number);

        // Persist deployment to deployments/gnosis.json for the frontend to consume.
        string memory json = string.concat(
            '{\n',
            '  "chainId": 100,\n',
            '  "factory": "', vm.toString(address(factory)), '",\n',
            '  "implementation": "', vm.toString(address(impl)), '",\n',
            '  "wrappedCrc": "', vm.toString(wrappedCrc), '",\n',
            '  "operator": "', vm.toString(operator), '",\n',
            '  "deployBlock": ', vm.toString(block.number), '\n',
            '}\n'
        );
        vm.writeFile("deployments/gnosis.json", json);
    }
}
