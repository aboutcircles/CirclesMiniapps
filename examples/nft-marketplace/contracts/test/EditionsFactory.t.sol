// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {Edition} from "../src/Edition.sol";
import {EditionsFactory} from "../src/EditionsFactory.sol";

contract MockERC20 {
    string public name = "MockCRC";
    string public symbol = "mCRC";
    uint8 public decimals = 18;
}

contract EditionsFactoryTest is Test {
    Edition impl;
    EditionsFactory factory;
    MockERC20 crc;

    address operator = makeAddr("operator");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        impl = new Edition();
        crc = new MockERC20();
        factory = new EditionsFactory(address(impl), address(crc), operator);
    }

    function test_createCollection_setsAllFields() public {
        vm.prank(alice);
        address collection = factory.createCollection("Alice's Editions", "ALICE");

        assertEq(factory.collectionOf(alice), collection);
        assertEq(factory.allCollectionsLength(), 1);
        assertEq(factory.allCollections(0), collection);

        Edition ed = Edition(collection);
        assertEq(ed.creator(), alice);
        assertEq(address(ed.wrappedCrc()), address(crc));
        assertEq(ed.operator(), operator);
        assertEq(ed.name(), "Alice's Editions");
        assertEq(ed.symbol(), "ALICE");
    }

    function test_createCollection_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        // collection address is unknown at expect time, so use indexed only on creator
        emit EditionsFactory.CollectionCreated(alice, address(0), "Alice", "A");
        // we won't strictly compare the collection address; expectEmit with checkData=false on indexed 2
        // simpler: just call and assert the resulting collectionOf changes:
        vm.prank(alice);
        factory.createCollection("Alice", "A");
        assertTrue(factory.collectionOf(alice) != address(0));
    }

    function test_createCollection_twoCreators_independentCollections() public {
        vm.prank(alice);
        address aCol = factory.createCollection("A", "A");
        vm.prank(bob);
        address bCol = factory.createCollection("B", "B");

        assertTrue(aCol != bCol);
        assertEq(factory.allCollectionsLength(), 2);
        assertEq(factory.collectionOf(alice), aCol);
        assertEq(factory.collectionOf(bob), bCol);
    }

    function test_createCollection_revertsOnDuplicate() public {
        vm.prank(alice);
        factory.createCollection("A", "A");

        vm.expectRevert(EditionsFactory.AlreadyHasCollection.selector);
        vm.prank(alice);
        factory.createCollection("A2", "A2");
    }

    function test_implementation_cannotBeInitializedDirectly() public {
        vm.expectRevert();
        impl.initialize(alice, "X", "X", address(crc), operator);
    }
}
