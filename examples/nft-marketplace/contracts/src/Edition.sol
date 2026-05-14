// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Edition is ERC721Upgradeable, ReentrancyGuardUpgradeable {
    struct Listing {
        address seller;
        uint256 price;
    }

    address public creator;
    address public operator;
    IERC20 public wrappedCrc;
    uint256 public nextId;

    mapping(uint256 tokenId => string uri) private _uris;
    mapping(uint256 tokenId => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Delisted(uint256 indexed tokenId, address indexed seller);
    event Sold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);

    error NotCreator();
    error NotOperator();
    error NotOwner();
    error NotSeller();
    error AlreadyListed();
    error NotListed();
    error PriceZero();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address creator_,
        string calldata name_,
        string calldata symbol_,
        address wrappedCrc_,
        address operator_
    ) external initializer {
        __ERC721_init(name_, symbol_);
        __ReentrancyGuard_init();
        creator = creator_;
        wrappedCrc = IERC20(wrappedCrc_);
        operator = operator_;
    }

    function mint(string calldata tokenURI_) external returns (uint256 tokenId) {
        if (msg.sender != creator) revert NotCreator();
        tokenId = ++nextId;
        _uris[tokenId] = tokenURI_;
        _safeMint(creator, tokenId);
    }

    function list(uint256 tokenId, uint256 price) external nonReentrant {
        if (price == 0) revert PriceZero();
        if (listings[tokenId].seller != address(0)) revert AlreadyListed();
        if (ownerOf(tokenId) != msg.sender) revert NotOwner();
        listings[tokenId] = Listing({seller: msg.sender, price: price});
        _transfer(msg.sender, address(this), tokenId);
        emit Listed(tokenId, msg.sender, price);
    }

    function delist(uint256 tokenId) external nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[tokenId];
        _transfer(address(this), l.seller, tokenId);
        emit Delisted(tokenId, l.seller);
    }

    function settle(uint256 tokenId, address buyer) external nonReentrant {
        if (msg.sender != operator) revert NotOperator();
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        delete listings[tokenId];
        _transfer(address(this), buyer, tokenId);
        emit Sold(tokenId, l.seller, buyer, l.price);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _uris[tokenId];
    }
}
