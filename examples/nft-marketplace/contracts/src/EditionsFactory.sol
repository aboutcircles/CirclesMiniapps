// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Edition} from "./Edition.sol";

contract EditionsFactory {
    address public immutable IMPLEMENTATION;
    address public immutable WRAPPED_CRC;
    address public immutable OPERATOR;

    mapping(address creator => address collection) public collectionOf;
    address[] public allCollections;

    event CollectionCreated(
        address indexed creator,
        address indexed collection,
        string name,
        string symbol
    );

    error AlreadyHasCollection();

    constructor(address implementation_, address wrappedCrc_, address operator_) {
        IMPLEMENTATION = implementation_;
        WRAPPED_CRC = wrappedCrc_;
        OPERATOR = operator_;
    }

    function createCollection(string calldata name, string calldata symbol)
        external
        returns (address collection)
    {
        if (collectionOf[msg.sender] != address(0)) revert AlreadyHasCollection();
        collection = Clones.clone(IMPLEMENTATION);
        Edition(collection).initialize(msg.sender, name, symbol, WRAPPED_CRC, OPERATOR);
        collectionOf[msg.sender] = collection;
        allCollections.push(collection);
        emit CollectionCreated(msg.sender, collection, name, symbol);
    }

    function allCollectionsLength() external view returns (uint256) {
        return allCollections.length;
    }
}
