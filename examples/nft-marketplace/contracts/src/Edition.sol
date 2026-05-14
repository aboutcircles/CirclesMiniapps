// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC721Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Edition is ERC721Upgradeable, ReentrancyGuardUpgradeable {
    uint16 public constant BPS_DENOMINATOR = 10_000;

    struct Listing {
        address seller;
        uint256 price;
    }

    address public creator;
    address public operator;
    IERC20 public wrappedCrc;
    uint256 public nextId;

    address public treasury;
    uint16 public listFeeBps;
    uint16 public buyFeeBps;

    mapping(uint256 tokenId => string uri) private _uris;
    mapping(uint256 tokenId => Listing) public listings;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price, uint256 listFee);
    event Delisted(uint256 indexed tokenId, address indexed seller);
    event Sold(
        uint256 indexed tokenId,
        address indexed seller,
        address indexed buyer,
        uint256 price,
        uint256 buyFee
    );
    /// @dev Emitted when the buy fee could not be collected (e.g. missing allowance).
    /// The NFT is still released to the buyer; the operator should chase the fee out-of-band.
    event BuyFeeSkipped(uint256 indexed tokenId, address indexed buyer, uint256 expectedFee, string reason);

    error NotCreator();
    error NotOperator();
    error NotOwner();
    error NotSeller();
    error AlreadyListed();
    error NotListed();
    error PriceZero();
    error FeeTooHigh();

    constructor() {
        _disableInitializers();
    }

    function initialize(
        address creator_,
        string calldata name_,
        string calldata symbol_,
        address wrappedCrc_,
        address operator_,
        address treasury_,
        uint16 listFeeBps_,
        uint16 buyFeeBps_
    ) external initializer {
        __ERC721_init(name_, symbol_);
        __ReentrancyGuard_init();
        creator = creator_;
        wrappedCrc = IERC20(wrappedCrc_);
        operator = operator_;
        treasury = treasury_;
        if (listFeeBps_ >= BPS_DENOMINATOR || buyFeeBps_ >= BPS_DENOMINATOR) revert FeeTooHigh();
        listFeeBps = listFeeBps_;
        buyFeeBps = buyFeeBps_;
    }

    function mint(string calldata tokenURI_) external returns (uint256 tokenId) {
        if (msg.sender != creator) revert NotCreator();
        tokenId = ++nextId;
        _uris[tokenId] = tokenURI_;
        _safeMint(creator, tokenId);
    }

    /// @notice List `tokenId` for sale at `price`. Pulls the listing fee from
    /// `msg.sender` in s-gCRC and forwards it to the treasury. Caller must
    /// approve the contract for at least `listFee(price)` beforehand.
    function list(uint256 tokenId, uint256 price) external nonReentrant {
        if (price == 0) revert PriceZero();
        if (listings[tokenId].seller != address(0)) revert AlreadyListed();
        if (ownerOf(tokenId) != msg.sender) revert NotOwner();
        listings[tokenId] = Listing({seller: msg.sender, price: price});

        uint256 fee = (price * listFeeBps) / BPS_DENOMINATOR;
        if (fee > 0) {
            // Reverts on missing allowance or insufficient balance - the seller
            // must explicitly opt-in to listing by paying the platform fee.
            require(wrappedCrc.transferFrom(msg.sender, treasury, fee), "list fee transfer failed");
        }

        _transfer(msg.sender, address(this), tokenId);
        emit Listed(tokenId, msg.sender, price, fee);
    }

    function delist(uint256 tokenId) external nonReentrant {
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        if (l.seller != msg.sender) revert NotSeller();
        delete listings[tokenId];
        _transfer(address(this), l.seller, tokenId);
        emit Delisted(tokenId, l.seller);
    }

    /// @notice Operator-only. Releases an escrowed NFT to `buyer` and attempts
    /// to collect the buy fee from the buyer's allowance. If the fee transfer
    /// fails (e.g. no allowance), the NFT is still released and a
    /// `BuyFeeSkipped` event is emitted - the operator should reconcile
    /// off-chain. Rationale: the buyer has already paid the seller for the
    /// NFT via the indexed CRC transfer; punishing them with a stuck NFT for
    /// a missing fee approval would be hostile.
    function settle(uint256 tokenId, address buyer) external nonReentrant {
        if (msg.sender != operator) revert NotOperator();
        Listing memory l = listings[tokenId];
        if (l.seller == address(0)) revert NotListed();
        delete listings[tokenId];

        uint256 fee = (l.price * buyFeeBps) / BPS_DENOMINATOR;
        uint256 collectedFee = 0;
        if (fee > 0) {
            try wrappedCrc.transferFrom(buyer, treasury, fee) returns (bool ok) {
                if (ok) {
                    collectedFee = fee;
                } else {
                    emit BuyFeeSkipped(tokenId, buyer, fee, "transferFrom returned false");
                }
            } catch Error(string memory reason) {
                emit BuyFeeSkipped(tokenId, buyer, fee, reason);
            } catch {
                emit BuyFeeSkipped(tokenId, buyer, fee, "fee transfer reverted");
            }
        }

        _transfer(address(this), buyer, tokenId);
        emit Sold(tokenId, l.seller, buyer, l.price, collectedFee);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return _uris[tokenId];
    }

    /// @notice View helpers for the frontend.
    function quoteListFee(uint256 price) external view returns (uint256) {
        return (price * listFeeBps) / BPS_DENOMINATOR;
    }

    function quoteBuyFee(uint256 price) external view returns (uint256) {
        return (price * buyFeeBps) / BPS_DENOMINATOR;
    }
}
