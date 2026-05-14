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

contract EditionTest is Test {
    Edition impl;
    EditionsFactory factory;
    MockERC20 crc;
    Edition ed;

    address operator = makeAddr("operator");
    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");
    address attacker = makeAddr("attacker");

    string constant TOKEN_URI = "ipfs://QmTestMetadataCid";

    function setUp() public {
        impl = new Edition();
        crc = new MockERC20();
        factory = new EditionsFactory(address(impl), address(crc), operator);

        vm.prank(creator);
        ed = Edition(factory.createCollection("Creator Editions", "CE"));
    }

    // ============ mint ============

    function test_mint_assignsIdAndOwnerAndUri() public {
        vm.prank(creator);
        uint256 id = ed.mint(TOKEN_URI);

        assertEq(id, 1);
        assertEq(ed.ownerOf(id), creator);
        assertEq(ed.tokenURI(id), TOKEN_URI);
        assertEq(ed.nextId(), 1);
    }

    function test_mint_incrementsId() public {
        vm.startPrank(creator);
        uint256 a = ed.mint("a");
        uint256 b = ed.mint("b");
        vm.stopPrank();
        assertEq(a, 1);
        assertEq(b, 2);
        assertEq(ed.tokenURI(a), "a");
        assertEq(ed.tokenURI(b), "b");
    }

    function test_mint_revertsIfNotCreator() public {
        vm.expectRevert(Edition.NotCreator.selector);
        vm.prank(attacker);
        ed.mint(TOKEN_URI);
    }

    function test_tokenURI_revertsForNonexistent() public {
        vm.expectRevert();
        ed.tokenURI(999);
    }

    // ============ list ============

    function _mint() internal returns (uint256) {
        vm.prank(creator);
        return ed.mint(TOKEN_URI);
    }

    function test_list_escrowsAndStoresListing() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, 100 ether);

        assertEq(ed.ownerOf(id), address(ed));
        (address seller, uint256 price) = ed.listings(id);
        assertEq(seller, creator);
        assertEq(price, 100 ether);
    }

    function test_list_emitsListed() public {
        uint256 id = _mint();
        vm.expectEmit(true, true, false, true, address(ed));
        emit Edition.Listed(id, creator, 100 ether);
        vm.prank(creator);
        ed.list(id, 100 ether);
    }

    function test_list_revertsIfNotOwner() public {
        uint256 id = _mint();
        vm.expectRevert(Edition.NotOwner.selector);
        vm.prank(attacker);
        ed.list(id, 100 ether);
    }

    function test_list_revertsIfAlreadyListed() public {
        uint256 id = _mint();
        vm.startPrank(creator);
        ed.list(id, 100 ether);
        vm.expectRevert(Edition.AlreadyListed.selector);
        ed.list(id, 200 ether);
        vm.stopPrank();
    }

    function test_list_revertsOnZeroPrice() public {
        uint256 id = _mint();
        vm.expectRevert(Edition.PriceZero.selector);
        vm.prank(creator);
        ed.list(id, 0);
    }

    // ============ delist ============

    function test_delist_returnsToken() public {
        uint256 id = _mint();
        vm.startPrank(creator);
        ed.list(id, 100 ether);
        ed.delist(id);
        vm.stopPrank();

        assertEq(ed.ownerOf(id), creator);
        (address seller, uint256 price) = ed.listings(id);
        assertEq(seller, address(0));
        assertEq(price, 0);
    }

    function test_delist_emitsEvent() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, 100 ether);

        vm.expectEmit(true, true, false, false, address(ed));
        emit Edition.Delisted(id, creator);
        vm.prank(creator);
        ed.delist(id);
    }

    function test_delist_revertsIfNotSeller() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, 100 ether);

        vm.expectRevert(Edition.NotSeller.selector);
        vm.prank(attacker);
        ed.delist(id);
    }

    function test_delist_revertsIfNotListed() public {
        uint256 id = _mint();
        vm.expectRevert(Edition.NotListed.selector);
        vm.prank(creator);
        ed.delist(id);
    }

    // ============ settle ============

    function test_settle_transfersToBuyerAndClears() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, 100 ether);

        vm.expectEmit(true, true, true, true, address(ed));
        emit Edition.Sold(id, creator, buyer, 100 ether);
        vm.prank(operator);
        ed.settle(id, buyer);

        assertEq(ed.ownerOf(id), buyer);
        (address seller, uint256 price) = ed.listings(id);
        assertEq(seller, address(0));
        assertEq(price, 0);
    }

    function test_settle_revertsIfNotOperator() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, 100 ether);

        vm.expectRevert(Edition.NotOperator.selector);
        vm.prank(attacker);
        ed.settle(id, buyer);
    }

    function test_settle_revertsIfNotListed() public {
        uint256 id = _mint();
        vm.expectRevert(Edition.NotListed.selector);
        vm.prank(operator);
        ed.settle(id, buyer);
    }

    function test_settle_revertsAfterDelist() public {
        uint256 id = _mint();
        vm.startPrank(creator);
        ed.list(id, 100 ether);
        ed.delist(id);
        vm.stopPrank();

        vm.expectRevert(Edition.NotListed.selector);
        vm.prank(operator);
        ed.settle(id, buyer);
    }

    // ============ end-to-end happy path ============

    function test_endToEnd_mintListSettleOwnership() public {
        vm.prank(creator);
        uint256 id = ed.mint("ipfs://meta");

        vm.prank(creator);
        ed.list(id, 50 ether);
        assertEq(ed.ownerOf(id), address(ed));

        vm.prank(operator);
        ed.settle(id, buyer);
        assertEq(ed.ownerOf(id), buyer);

        // buyer can now list it themselves
        vm.prank(buyer);
        ed.list(id, 75 ether);
        (address seller, uint256 price) = ed.listings(id);
        assertEq(seller, buyer);
        assertEq(price, 75 ether);

        // creator cannot delist buyer's listing
        vm.expectRevert(Edition.NotSeller.selector);
        vm.prank(creator);
        ed.delist(id);
    }
}
