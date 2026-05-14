// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import {Edition} from "../src/Edition.sol";
import {EditionsFactory} from "../src/EditionsFactory.sol";

/// @notice Deploys the Edition implementation + EditionsFactory to Gnosis Chain.
///
/// Required env vars:
///   DEPLOYER_PRIVATE_KEY  - deployer EOA, must hold xDAI for gas. Becomes the
///                           treasury for collected fees unless `TREASURY_ADDRESS`
///                           is also set.
///   WRAPPED_CRC_ADDRESS   - s-gCRC ERC-20 address (locked to BaseGroup)
///   OPERATOR_ADDRESS      - App Operator EOA that can call Edition.settle
///
/// Optional:
///   TREASURY_ADDRESS      - Fee recipient (default: deployer)
///   LIST_FEE_BPS          - Listing-fee rate in basis points (default 250 = 2.5%)
///   BUY_FEE_BPS           - Buy-fee rate in basis points (default 250 = 2.5%)
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
    uint16 constant DEFAULT_LIST_FEE_BPS = 250;
    uint16 constant DEFAULT_BUY_FEE_BPS = 250;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployerAddr = vm.addr(deployerKey);
        address wrappedCrc = vm.envOr("WRAPPED_CRC_ADDRESS", DEFAULT_WRAPPED_CRC);
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        address treasury = vm.envOr("TREASURY_ADDRESS", deployerAddr);
        uint256 listFeeBpsRaw = vm.envOr("LIST_FEE_BPS", uint256(DEFAULT_LIST_FEE_BPS));
        uint256 buyFeeBpsRaw = vm.envOr("BUY_FEE_BPS", uint256(DEFAULT_BUY_FEE_BPS));

        require(wrappedCrc != address(0), "wrapped CRC unset");
        require(operator != address(0), "operator unset");
        require(treasury != address(0), "treasury unset");
        require(listFeeBpsRaw < 10_000 && buyFeeBpsRaw < 10_000, "fee bps too high");

        uint16 listFeeBps = uint16(listFeeBpsRaw);
        uint16 buyFeeBps = uint16(buyFeeBpsRaw);

        vm.startBroadcast(deployerKey);
        Edition impl = new Edition();
        EditionsFactory factory = new EditionsFactory(
            address(impl),
            wrappedCrc,
            operator,
            treasury,
            listFeeBps,
            buyFeeBps
        );
        vm.stopBroadcast();

        console.log("Edition implementation:", address(impl));
        console.log("EditionsFactory:       ", address(factory));
        console.log("Wrapped CRC:           ", wrappedCrc);
        console.log("Operator:              ", operator);
        console.log("Treasury:              ", treasury);
        console.log("List fee bps:          ", listFeeBps);
        console.log("Buy fee bps:           ", buyFeeBps);
        console.log("Block number:          ", block.number);

        string memory json = string.concat(
            '{\n',
            '  "chainId": 100,\n',
            '  "factory": "', vm.toString(address(factory)), '",\n',
            '  "implementation": "', vm.toString(address(impl)), '",\n',
            '  "wrappedCrc": "', vm.toString(wrappedCrc), '",\n',
            '  "operator": "', vm.toString(operator), '",\n',
            '  "treasury": "', vm.toString(treasury), '",\n',
            '  "listFeeBps": ', vm.toString(uint256(listFeeBps)), ',\n',
            '  "buyFeeBps": ', vm.toString(uint256(buyFeeBps)), ',\n',
            '  "deployBlock": ', vm.toString(block.number), '\n',
            '}\n'
        );
        vm.writeFile("deployments/gnosis.json", json);
    }
}
