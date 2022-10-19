//SPDX-License-Identifier:MIT

pragma solidity 0.8.7;
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ZeroKageMock is ERC20 {
    constructor(uint256 totalSupply) ERC20("ZeroKageMock", "0KAGE") {
        _mint(msg.sender, totalSupply);
    }
}
