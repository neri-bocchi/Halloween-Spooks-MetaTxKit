// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

contract HalloweenNFT is ERC721, ERC2771Context, Ownable {
    uint256 private _tokenIdCounter;

    // Guarda si ya mintó (1 NFT por address)
    mapping(address => bool) public minted;

    // URI por token
    mapping(uint256 => string) private _tokenURIs;

    // 🆕 Mapeo de address => tokenId
    mapping(address => uint256) public tokenOf;

    event Minted(address indexed to, uint256 indexed tokenId, string uri);

    constructor(address trustedForwarder)
        ERC721("HalloweenSpooks", "HSPOOK")
        ERC2771Context(trustedForwarder)
        Ownable(msg.sender)
    {}

    // -----------------------------
    // ERC2771 overrides
    // -----------------------------
    function _msgSender()
        internal
        view
        override(Context, ERC2771Context)
        returns (address sender)
    {
        sender = ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        override(Context, ERC2771Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
    }

    // -----------------------------
    // Mint (una vez por address)
    // -----------------------------
    function mint(string calldata tokenUri) external {
        address user = _msgSender();
        require(!minted[user], "Already minted for this address");

        minted[user] = true;
        uint256 newId = ++_tokenIdCounter;

        _safeMint(user, newId);
        _tokenURIs[newId] = tokenUri;

        // 🆕 Guardamos qué token le pertenece
        tokenOf[user] = newId;

        emit Minted(user, newId, tokenUri);
    }

    // -----------------------------
    // tokenURI override
    // -----------------------------
    function tokenURI(uint256 tokenId)
        public
        view
        override
        returns (string memory)
    {
        require(_ownerOf(tokenId) != address(0), "ERC721Metadata: URI query for nonexistent token");
        return _tokenURIs[tokenId];
    }

    // -----------------------------
    // Getter rápido de tu NFT
    // -----------------------------
    function myToken() external view returns (uint256 id, string memory uri) {
        id = tokenOf[_msgSender()];
        uri = _tokenURIs[id];
    }

    // -----------------------------
    // Opcional: cambiar forwarder (no implementado)
    // -----------------------------
    function setTrustedForwarder(address forwarder) external onlyOwner {
        // Implementar si querés hacerlo actualizable
    }
}