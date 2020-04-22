pragma solidity "0.6.6";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { IChildToken } from "./IChildToken.sol";

contract ChildToken is ERC20, IChildToken, AccessControl {
  bytes32 public constant DEPOSITOR_ROLE = keccak256("DEPOSITOR_ROLE");

  address private _rootToken;

  constructor(
    string memory name,
    string memory symbol,
    uint8 decimals
  ) public ERC20(name, symbol) {
    _setupDecimals(decimals);
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _setupRole(DEPOSITOR_ROLE, msg.sender);
  }

  modifier only(bytes32 role) {
    require(
      hasRole(role, msg.sender),
      "Insufficient permissions"
    );
    _;
  }

  function setRootToken(address newRootToken) external only(DEFAULT_ADMIN_ROLE) {
    _rootToken = newRootToken;
  }

  function rootToken() public view returns (address) {
    return _rootToken;
  }

  function deposit(address user, uint256 amount) override external only(DEPOSITOR_ROLE) {
    require(
      amount > 0,
      "amount should be possitive"
    );
    require(
      user != address(0x0),
      "Cannot deposit for zero address"
    );
    _mint(user, amount);
  }

  function withdraw(uint256 amount) override external {
    require(
      amount > 0,
      "withdraw amount should be positie"
    );
    require(
      amount <= balanceOf(msg.sender),
      "withdraw amount cannot be more than balance"
    );

    _burn(msg.sender, amount);
    emit Burned(_rootToken, msg.sender, amount);
  }
}
