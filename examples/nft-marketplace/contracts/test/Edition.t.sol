// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {Edition} from "../src/Edition.sol";
import {EditionsFactory} from "../src/EditionsFactory.sol";
import {MockERC20} from "../src/MockERC20.sol";

contract EditionTest is Test {
    Edition impl;
    EditionsFactory factory;
    MockERC20 crc;
    Edition ed;

    address operator = makeAddr("operator");
    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");
    address attacker = makeAddr("attacker");
    address treasury = makeAddr("treasury");

    uint16 constant LIST_FEE_BPS = 250; // 2.5%
    uint16 constant BUY_FEE_BPS = 250;  // 2.5%
    uint256 constant PRICE = 100 ether;
    uint256 constant LIST_FEE = (PRICE * LIST_FEE_BPS) / 10_000;
    uint256 constant BUY_FEE = (PRICE * BUY_FEE_BPS) / 10_000;

    string constant TOKEN_URI = "ipfs://QmTestMetadataCid";

    function setUp() public {
        impl = new Edition();
        crc = new MockERC20();
        factory = new EditionsFactory(
            address(impl), address(crc), operator, treasury, LIST_FEE_BPS, BUY_FEE_BPS
        );

        vm.prank(creator);
        ed = Edition(factory.createCollection("Creator Editions", "CE"));

        // Fund actors with mock s-gCRC and pre-approve the collection contract
        // for the typical fees. Each test can override if it needs to assert
        // missing-allowance / missing-balance paths.
        crc.mint(creator, 1_000 ether);
        crc.mint(buyer, 1_000 ether);
        vm.prank(creator);
        crc.approve(address(ed), type(uint256).max);
        vm.prank(buyer);
        crc.approve(address(ed), type(uint256).max);
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
        uint256 creatorBefore = crc.balanceOf(creator);
        uint256 treasuryBefore = crc.balanceOf(treasury);

        vm.prank(creator);
        ed.list(id, PRICE);

        assertEq(ed.ownerOf(id), address(ed));
        (address seller, uint256 price) = ed.listings(id);
        assertEq(seller, creator);
        assertEq(price, PRICE);
        assertEq(crc.balanceOf(creator), creatorBefore - LIST_FEE);
        assertEq(crc.balanceOf(treasury), treasuryBefore + LIST_FEE);
    }

    function test_list_emitsListedWithFee() public {
        uint256 id = _mint();
        vm.expectEmit(true, true, false, true, address(ed));
        emit Edition.Listed(id, creator, PRICE, LIST_FEE);
        vm.prank(creator);
        ed.list(id, PRICE);
    }

    function test_list_revertsIfFeeAllowanceMissing() public {
        uint256 id = _mint();
        vm.prank(creator);
        crc.approve(address(ed), 0);
        vm.expectRevert();
        vm.prank(creator);
        ed.list(id, PRICE);
    }

    function test_list_revertsIfNotOwner() public {
        uint256 id = _mint();
        vm.expectRevert(Edition.NotOwner.selector);
        vm.prank(attacker);
        ed.list(id, PRICE);
    }

    function test_list_revertsIfAlreadyListed() public {
        uint256 id = _mint();
        vm.startPrank(creator);
        ed.list(id, PRICE);
        vm.expectRevert(Edition.AlreadyListed.selector);
        ed.list(id, PRICE * 2);
        vm.stopPrank();
    }

    function test_list_revertsOnZeroPrice() public {
        uint256 id = _mint();
        vm.expectRevert(Edition.PriceZero.selector);
        vm.prank(creator);
        ed.list(id, 0);
    }

    function test_list_skipsFeeTransferWhenBpsIsZero() public {
        // Spin up a fresh factory with zero fees and verify no CRC moves.
        EditionsFactory f2 = new EditionsFactory(address(impl), address(crc), operator, treasury, 0, 0);
        vm.prank(creator);
        Edition ed2 = Edition(f2.createCollection("Z", "Z"));
        vm.prank(creator);
        uint256 id = ed2.mint(TOKEN_URI);

        uint256 treasuryBefore = crc.balanceOf(treasury);
        vm.prank(creator);
        ed2.list(id, PRICE); // no approval needed because fee is 0
        assertEq(crc.balanceOf(treasury), treasuryBefore);
    }

    // ============ delist ============

    function test_delist_returnsToken() public {
        uint256 id = _mint();
        vm.startPrank(creator);
        ed.list(id, PRICE);
        ed.delist(id);
        vm.stopPrank();

        assertEq(ed.ownerOf(id), creator);
        (address seller, uint256 price) = ed.listings(id);
        assertEq(seller, address(0));
        assertEq(price, 0);
    }

    function test_delist_doesNotRefundListFee() public {
        uint256 id = _mint();
        uint256 creatorBefore = crc.balanceOf(creator);

        vm.startPrank(creator);
        ed.list(id, PRICE);
        ed.delist(id);
        vm.stopPrank();

        // Fee was paid at list and is not refunded.
        assertEq(crc.balanceOf(creator), creatorBefore - LIST_FEE);
    }

    function test_delist_revertsIfNotSeller() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, PRICE);

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

    function test_settle_transfersToBuyerAndCollectsBuyFee() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, PRICE);

        uint256 buyerBefore = crc.balanceOf(buyer);
        uint256 treasuryBefore = crc.balanceOf(treasury);

        vm.expectEmit(true, true, true, true, address(ed));
        emit Edition.Sold(id, creator, buyer, PRICE, BUY_FEE);
        vm.prank(operator);
        ed.settle(id, buyer);

        assertEq(ed.ownerOf(id), buyer);
        (address seller, uint256 price) = ed.listings(id);
        assertEq(seller, address(0));
        assertEq(price, 0);
        assertEq(crc.balanceOf(buyer), buyerBefore - BUY_FEE);
        assertEq(crc.balanceOf(treasury), treasuryBefore + BUY_FEE);
    }

    function test_settle_releasesNftEvenWhenBuyerHasNoAllowance() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, PRICE);

        // Buyer revoked their allowance after building the payment intent.
        vm.prank(buyer);
        crc.approve(address(ed), 0);

        uint256 treasuryBefore = crc.balanceOf(treasury);

        // The NFT must still reach the buyer; the operator collects the fee
        // out-of-band. The Sold event records collectedFee = 0.
        vm.expectEmit(true, true, false, false, address(ed));
        emit Edition.BuyFeeSkipped(id, buyer, BUY_FEE, "");
        vm.prank(operator);
        ed.settle(id, buyer);

        assertEq(ed.ownerOf(id), buyer);
        assertEq(crc.balanceOf(treasury), treasuryBefore); // no fee collected
    }

    function test_settle_revertsIfNotOperator() public {
        uint256 id = _mint();
        vm.prank(creator);
        ed.list(id, PRICE);

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
        ed.list(id, PRICE);
        ed.delist(id);
        vm.stopPrank();

        vm.expectRevert(Edition.NotListed.selector);
        vm.prank(operator);
        ed.settle(id, buyer);
    }

    // ============ quoteListFee / quoteBuyFee ============

    function test_quoteListFee_matchesCalculation() public view {
        assertEq(ed.quoteListFee(PRICE), LIST_FEE);
        assertEq(ed.quoteListFee(0), 0);
        assertEq(ed.quoteListFee(1 ether), 0.025 ether);
    }

    function test_quoteBuyFee_matchesCalculation() public view {
        assertEq(ed.quoteBuyFee(PRICE), BUY_FEE);
        assertEq(ed.quoteBuyFee(0), 0);
    }

    // ============ end-to-end happy path ============

    function test_endToEnd_mintListSettleOwnership() public {
        vm.prank(creator);
        uint256 id = ed.mint("ipfs://meta");

        vm.prank(creator);
        ed.list(id, PRICE);
        assertEq(ed.ownerOf(id), address(ed));

        vm.prank(operator);
        ed.settle(id, buyer);
        assertEq(ed.ownerOf(id), buyer);

        // buyer can now list it themselves - first fund + approve them as a seller path
        crc.mint(buyer, 1_000 ether);
        // (already approved address(ed) for type(uint256).max in setUp)
        vm.prank(buyer);
        ed.list(id, PRICE);
        (address seller, uint256 price) = ed.listings(id);
        assertEq(seller, buyer);
        assertEq(price, PRICE);

        // original creator cannot delist buyer's listing
        vm.expectRevert(Edition.NotSeller.selector);
        vm.prank(creator);
        ed.delist(id);
    }
}
