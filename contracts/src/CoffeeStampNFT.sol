// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title CoffeeStampNFT
 * @notice Free-coffee reward token for the Coffee Loyalty miniapp.
 *
 * Self-contained, minimal ERC-721 (no external dependencies, so it builds with a
 * bare `forge` install). A single `minter` — the loyalty backend's operator EOA —
 * mints one token to a customer when they reach 10 stamps. The store owner reads
 * ownership/`redeemed` state to honour the free coffee, then flips `redeemed`.
 *
 * The contract intentionally has no transfer-restriction logic: it is a simple
 * collectible voucher. Redemption is bookkeeping, not burning, so the customer
 * keeps the NFT as a memento.
 */
contract CoffeeStampNFT {
    // ─── ERC-721 metadata ──────────────────────────────────────────
    string public name = "Coffee Loyalty Free Coffee";
    string public symbol = "FREECUP";

    // ─── Roles ─────────────────────────────────────────────────────
    address public owner; // deployer / admin (can rotate the minter)
    address public minter; // backend operator EOA allowed to mint

    // ─── ERC-721 state ─────────────────────────────────────────────
    uint256 public nextTokenId = 1;
    mapping(uint256 => address) private _ownerOf;
    mapping(address => uint256) private _balanceOf;
    mapping(uint256 => address) private _approved;
    mapping(address => mapping(address => bool)) private _operatorApproval;

    /// @notice Whether a given free-coffee token has been redeemed at the till.
    mapping(uint256 => bool) public redeemed;

    // ─── Events ────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed ownerAddr, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed ownerAddr, address indexed operator, bool approved);
    event MinterUpdated(address indexed previousMinter, address indexed newMinter);
    event Redeemed(uint256 indexed tokenId, address indexed by);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyMinter() {
        require(msg.sender == minter, "NOT_MINTER");
        _;
    }

    constructor(address minter_) {
        owner = msg.sender;
        minter = minter_;
        emit MinterUpdated(address(0), minter_);
    }

    // ─── Admin ─────────────────────────────────────────────────────
    function setMinter(address newMinter) external onlyOwner {
        emit MinterUpdated(minter, newMinter);
        minter = newMinter;
    }

    // ─── Minting / redemption ──────────────────────────────────────
    /// @notice Mint a free-coffee NFT to `to`. Returns the new tokenId.
    function mint(address to) external onlyMinter returns (uint256 tokenId) {
        require(to != address(0), "ZERO_TO");
        tokenId = nextTokenId++;
        _ownerOf[tokenId] = to;
        unchecked {
            _balanceOf[to] += 1;
        }
        emit Transfer(address(0), to, tokenId);
    }

    /// @notice Mark a token as redeemed (free coffee served). Callable by the
    ///         token holder or the minter (the store till), once per token.
    function redeem(uint256 tokenId) external {
        address holder = _ownerOf[tokenId];
        require(holder != address(0), "NO_TOKEN");
        require(msg.sender == holder || msg.sender == minter, "NOT_AUTHORIZED");
        require(!redeemed[tokenId], "ALREADY_REDEEMED");
        redeemed[tokenId] = true;
        emit Redeemed(tokenId, msg.sender);
    }

    // ─── ERC-721 views ─────────────────────────────────────────────
    function ownerOf(uint256 tokenId) public view returns (address) {
        address holder = _ownerOf[tokenId];
        require(holder != address(0), "NO_TOKEN");
        return holder;
    }

    function balanceOf(address account) external view returns (uint256) {
        require(account != address(0), "ZERO_ADDR");
        return _balanceOf[account];
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        require(_ownerOf[tokenId] != address(0), "NO_TOKEN");
        // Static on-chain metadata — no external hosting required.
        return
            "data:application/json;utf8,"
            '{"name":"Free Coffee","description":"A free coffee earned with 10 loyalty stamps.","image":"https://circles.gnosis.io/app-logos/coffee-loyalty.png"}';
    }

    // ─── ERC-721 transfers / approvals ─────────────────────────────
    function approve(address spender, uint256 tokenId) external {
        address holder = _ownerOf[tokenId];
        require(msg.sender == holder || _operatorApproval[holder][msg.sender], "NOT_AUTHORIZED");
        _approved[tokenId] = spender;
        emit Approval(holder, spender, tokenId);
    }

    function getApproved(uint256 tokenId) external view returns (address) {
        require(_ownerOf[tokenId] != address(0), "NO_TOKEN");
        return _approved[tokenId];
    }

    function setApprovalForAll(address operator, bool approved_) external {
        _operatorApproval[msg.sender][operator] = approved_;
        emit ApprovalForAll(msg.sender, operator, approved_);
    }

    function isApprovedForAll(address account, address operator) external view returns (bool) {
        return _operatorApproval[account][operator];
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(from == _ownerOf[tokenId], "WRONG_FROM");
        require(to != address(0), "ZERO_TO");
        require(
            msg.sender == from || _approved[tokenId] == msg.sender || _operatorApproval[from][msg.sender],
            "NOT_AUTHORIZED"
        );
        _ownerOf[tokenId] = to;
        unchecked {
            _balanceOf[from] -= 1;
            _balanceOf[to] += 1;
        }
        delete _approved[tokenId];
        emit Transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) external {
        transferFrom(from, to, tokenId);
        _checkReceiver(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes calldata data) external {
        transferFrom(from, to, tokenId);
        _checkReceiver(from, to, tokenId, data);
    }

    function _checkReceiver(address from, address to, uint256 tokenId, bytes memory data) private {
        if (to.code.length == 0) return;
        require(
            IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data)
                == IERC721Receiver.onERC721Received.selector,
            "UNSAFE_RECIPIENT"
        );
    }

    // ─── ERC-165 ───────────────────────────────────────────────────
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x80ac58cd || // ERC-721
            interfaceId == 0x5b5e139f; // ERC-721 Metadata
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external
        returns (bytes4);
}
