pragma solidity "0.6.6";

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IChildToken} from "./IChildToken.sol";
import {NetworkAgnostic} from "../../common/NetworkAgnostic.sol";

contract ChildERC20 is ERC721, IChildToken, AccessControl, NetworkAgnostic {
    bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

    address private _rootToken;

    event Burned(
        address indexed rootToken,
        address indexed user,
        uint256 tokenId
    );

    constructor(
        string memory name,
        string memory symbol
    ) public ERC721(name, symbol) NetworkAgnostic(name, "1", 3) {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(DEPOSITOR_ROLE, _msgSender());
    }

    modifier only(bytes32 role) {
        require(hasRole(role, _msgSender()), "ChildERC721: INSUFFICIENT_PERMISSIONS");
        _;
    }

    function setRootToken(address newRootToken)
        external
        only(DEFAULT_ADMIN_ROLE)
    {
        _rootToken = newRootToken;
    }

    function rootToken() public view returns (address) {
        return _rootToken;
    }

    function _msgSender()
        internal
        override
        view
        returns (address payable sender)
    {
        if (msg.sender == address(this)) {
            bytes memory array = msg.data;
            uint256 index = msg.data.length;
            assembly {
                // Load the 32 bytes word from memory with the address on the lower 20 bytes, and mask those.
                sender := and(
                    mload(add(array, index)),
                    0xffffffffffffffffffffffffffffffffffffffff
                )
            }
        } else {
            sender = msg.sender;
        }
        return sender;
    }

    function deposit(address user, bytes calldata depositData)
        external
        override
        only(DEPOSITOR_ROLE)
    {
        uint256 tokenId = abi.decode(depositData, (uint256));
        require(ownerOf(tokenId) == address(0), "ChildERC721: TOKEN_EXISTS");
        require(user != address(0x0), "ChildERC721: INVALID_DEPOSIT_USER");
        _mint(user, tokenId);
    }

    function withdraw(uint256 tokenId) external {
        require(_msgSender() == ownerOf(tokenId), "ChildERC721: INVALID_TOKEN_OWNER");
        _burn(tokenId);
        emit Burned(_rootToken, _msgSender(), tokenId);
    }
}
