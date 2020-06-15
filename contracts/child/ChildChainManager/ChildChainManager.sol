pragma solidity "0.6.6";

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ChildChainManagerStorage} from "./ChildChainManagerStorage.sol";
import {IChildChainManager} from "./IChildChainManager.sol";
import {IChildToken} from "../ChildToken/IChildToken.sol";

contract ChildChainManager is ChildChainManagerStorage, IChildChainManager {
    bytes32 private constant DEPOSIT = keccak256("DEPOSIT");
    bytes32 private constant MAP_TOKEN = keccak256("MAP_TOKEN");

    function rootToChildToken(address rootToken)
        public
        override
        view
        returns (address)
    {
        return _rootToChildToken[rootToken];
    }

    function childToRootToken(address childToken)
        public
        override
        view
        returns (address)
    {
        return _childToRootToken[childToken];
    }

    function mapToken(address rootToken, address childToken)
        external
        override
        only(MAPPER_ROLE)
    {
        _rootToChildToken[rootToken] = childToken;
        _childToRootToken[childToken] = rootToken;
        emit TokenMapped(rootToken, childToken);
    }

    function onStateReceive(uint256 id, bytes calldata data)
        external
        override
        only(STATE_SYNCER_ROLE)
    {
        (bytes32 syncType, bytes memory syncData) = abi.decode(
            data,
            (bytes32, bytes)
        );

        if (syncType == DEPOSIT) {
            _syncDeposit(syncData);
        }
    }

    function _syncDeposit(bytes memory syncData) private {
        (address user, address rootToken, bytes memory depositData) = abi
            .decode(syncData, (address, address, bytes));
        address childTokenAddress = _rootToChildToken[rootToken];
        require(
            childTokenAddress != address(0x0),
            "ChildChainManager: TOKEN_NOT_MAPPED"
        );
        IChildToken childTokenContract = IChildToken(childTokenAddress);
        childTokenContract.deposit(user, depositData);
    }
}
