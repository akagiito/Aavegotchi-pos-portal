pragma solidity "0.6.6";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract DummyToken is ERC20 {
  constructor() public ERC20("Dummy Parent Token", "DUMMY") {
    uint256 value = 10**10 * (10**18);
    _mint(_msgSender(), value);
  }

  function mint(uint256 supply) public {
    _mint(_msgSender(), supply);
  }
}
