// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CoffeeStampNFT} from "../src/CoffeeStampNFT.sol";

contract CoffeeStampNFTTest is Test {
    CoffeeStampNFT nft;
    address minter = address(0xBEEF);
    address customer = address(0xCAFE);
    address stranger = address(0xDEAD);

    function setUp() public {
        nft = new CoffeeStampNFT(minter);
    }

    function test_MinterCanMint() public {
        vm.prank(minter);
        uint256 id = nft.mint(customer);
        assertEq(id, 1);
        assertEq(nft.ownerOf(1), customer);
        assertEq(nft.balanceOf(customer), 1);
        assertFalse(nft.redeemed(1));
    }

    function test_NonMinterCannotMint() public {
        vm.prank(stranger);
        vm.expectRevert("NOT_MINTER");
        nft.mint(customer);
    }

    function test_TokenIdsIncrement() public {
        vm.startPrank(minter);
        assertEq(nft.mint(customer), 1);
        assertEq(nft.mint(customer), 2);
        vm.stopPrank();
        assertEq(nft.balanceOf(customer), 2);
    }

    function test_HolderCanRedeemOnce() public {
        vm.prank(minter);
        nft.mint(customer);

        vm.prank(customer);
        nft.redeem(1);
        assertTrue(nft.redeemed(1));

        vm.prank(customer);
        vm.expectRevert("ALREADY_REDEEMED");
        nft.redeem(1);
    }

    function test_StrangerCannotRedeem() public {
        vm.prank(minter);
        nft.mint(customer);
        vm.prank(stranger);
        vm.expectRevert("NOT_AUTHORIZED");
        nft.redeem(1);
    }

    function test_OwnerCanRotateMinter() public {
        nft.setMinter(stranger);
        assertEq(nft.minter(), stranger);
        vm.prank(stranger);
        nft.mint(customer);
        assertEq(nft.ownerOf(1), customer);
    }

    function test_SupportsInterfaces() public view {
        assertTrue(nft.supportsInterface(0x80ac58cd)); // ERC-721
        assertTrue(nft.supportsInterface(0x5b5e139f)); // metadata
        assertTrue(nft.supportsInterface(0x01ffc9a7)); // ERC-165
        assertFalse(nft.supportsInterface(0xffffffff));
    }
}
