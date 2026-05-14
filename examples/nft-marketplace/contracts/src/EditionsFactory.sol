// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Edition} from "./Edition.sol";

contract EditionsFactory {
    address public immutable IMPLEMENTATION;
    address public immutable WRAPPED_CRC;
    address public immutable OPERATOR;
    address public immutable TREASURY;
    uint16 public immutable LIST_FEE_BPS;
    uint16 public immutable BUY_FEE_BPS;

    mapping(address creator => address collection) public collectionOf;
    address[] public allCollections;

    event CollectionCreated(
        address indexed creator,
        address indexed collection,
        string name,
        string symbol
    );

    error AlreadyHasCollection();
    error FeeTooHigh();

    /// @param implementation_ Address of the deployed `Edition` singleton.
    /// @param wrappedCrc_     s-gCRC ERC-20 used for fees and sale payments.
    /// @param operator_       App operator EOA, can call `settle` on every clone.
    /// @param treasury_       Fee recipient (defaults to deployer when invoked from `Deploy.s.sol`).
    /// @param listFeeBps_     Listing-fee rate in basis points (e.g. 250 = 2.5%). Must be < 10_000.
    /// @param buyFeeBps_      Buy-fee rate in basis points (e.g. 250 = 2.5%). Must be < 10_000.
    constructor(
        address implementation_,
        address wrappedCrc_,
        address operator_,
        address treasury_,
        uint16 listFeeBps_,
        uint16 buyFeeBps_
    ) {
        if (listFeeBps_ >= 10_000 || buyFeeBps_ >= 10_000) revert FeeTooHigh();
        IMPLEMENTATION = implementation_;
        WRAPPED_CRC = wrappedCrc_;
        OPERATOR = operator_;
        TREASURY = treasury_;
        LIST_FEE_BPS = listFeeBps_;
        BUY_FEE_BPS = buyFeeBps_;
    }

    function createCollection(string calldata name, string calldata symbol)
        external
        returns (address collection)
    {
        if (collectionOf[msg.sender] != address(0)) revert AlreadyHasCollection();
        collection = Clones.clone(IMPLEMENTATION);
        Edition(collection).initialize(
            msg.sender,
            name,
            symbol,
            WRAPPED_CRC,
            OPERATOR,
            TREASURY,
            LIST_FEE_BPS,
            BUY_FEE_BPS
        );
        collectionOf[msg.sender] = collection;
        allCollections.push(collection);
        emit CollectionCreated(msg.sender, collection, name, symbol);
    }

    function allCollectionsLength() external view returns (uint256) {
        return allCollections.length;
    }
}
