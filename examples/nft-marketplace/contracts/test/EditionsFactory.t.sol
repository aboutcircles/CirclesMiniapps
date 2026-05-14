// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {Edition} from "../src/Edition.sol";
import {EditionsFactory} from "../src/EditionsFactory.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract EditionsFactoryTest is Test {
    Edition impl;
    EditionsFactory factory;
    MockERC20 crc;

    address operator = makeAddr("operator");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint16 constant LIST_FEE_BPS = 250;
    uint16 constant BUY_FEE_BPS = 250;

    function setUp() public {
        impl = new Edition();
        crc = new MockERC20();
        factory = new EditionsFactory(
            address(impl), address(crc), operator, treasury, LIST_FEE_BPS, BUY_FEE_BPS
        );
    }

    function test_factory_storesImmutables() public view {
        assertEq(factory.IMPLEMENTATION(), address(impl));
        assertEq(factory.WRAPPED_CRC(), address(crc));
        assertEq(factory.OPERATOR(), operator);
        assertEq(factory.TREASURY(), treasury);
        assertEq(factory.LIST_FEE_BPS(), LIST_FEE_BPS);
        assertEq(factory.BUY_FEE_BPS(), BUY_FEE_BPS);
    }

    function test_factory_revertsOnExcessiveFee() public {
        vm.expectRevert(EditionsFactory.FeeTooHigh.selector);
        new EditionsFactory(address(impl), address(crc), operator, treasury, 10_000, 250);
        vm.expectRevert(EditionsFactory.FeeTooHigh.selector);
        new EditionsFactory(address(impl), address(crc), operator, treasury, 250, 10_000);
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
        assertEq(ed.treasury(), treasury);
        assertEq(ed.listFeeBps(), LIST_FEE_BPS);
        assertEq(ed.buyFeeBps(), BUY_FEE_BPS);
        assertEq(ed.name(), "Alice's Editions");
        assertEq(ed.symbol(), "ALICE");
    }

    function test_createCollection_emitsCollectionCreatedEvent() public {
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
        impl.initialize(alice, "X", "X", address(crc), operator, treasury, LIST_FEE_BPS, BUY_FEE_BPS);
    }
}
