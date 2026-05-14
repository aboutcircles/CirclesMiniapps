// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import {Edition} from "../src/Edition.sol";
import {EditionsFactory} from "../src/EditionsFactory.sol";
import {MockERC20} from "../src/MockERC20.sol";

/// @notice Local-only deploy. Deploys MockERC20 (as the wrapped-CRC stand-in),
/// the Edition implementation, and the EditionsFactory. Writes the resulting
/// addresses + block to `deployments/local.json` for the dev script to pick up.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  - anvil default account #0 works
///   OPERATOR_ADDRESS      - anvil default account #1 works
///
/// Usage:
///   forge script script/DeployLocal.s.sol --rpc-url http://localhost:8545 --broadcast
contract DeployLocal is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address operator = vm.envAddress("OPERATOR_ADDRESS");

        vm.startBroadcast(deployerKey);
        MockERC20 mock = new MockERC20();
        Edition impl = new Edition();
        EditionsFactory factory = new EditionsFactory(address(impl), address(mock), operator);
        vm.stopBroadcast();

        console.log("MockERC20 (s-gCRC stand-in):", address(mock));
        console.log("Edition implementation:     ", address(impl));
        console.log("EditionsFactory:            ", address(factory));
        console.log("Operator:                   ", operator);
        console.log("Block number:               ", block.number);

        string memory json = string.concat(
            '{\n',
            '  "chainId": 31337,\n',
            '  "factory": "', vm.toString(address(factory)), '",\n',
            '  "implementation": "', vm.toString(address(impl)), '",\n',
            '  "wrappedCrc": "', vm.toString(address(mock)), '",\n',
            '  "operator": "', vm.toString(operator), '",\n',
            '  "deployBlock": ', vm.toString(block.number), '\n',
            '}\n'
        );
        vm.writeFile("deployments/local.json", json);
    }
}
