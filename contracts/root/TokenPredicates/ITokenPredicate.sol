pragma solidity ^0.6.6;

import {RLPReader} from "../../lib/RLPReader.sol";

/// @title Token predicate interface for all pos portal predicates
/// @notice Abstract interface that defines methods for custom predicates
interface ITokenPredicate {

    /// @notice Deposit tokens into pos portal
    /// @dev When `depositor` deposits tokens into pos portal, tokens get locked into predicate contract.
    /// @param depositor Address who wants to deposit tokens
    /// @param depositReceiver Address (address) who wants to receive tokens on side chain
    /// @param rootToken Token which gets deposited
    /// @param depositData Extra data for deposit (amount for ERC20, token id for ERC721 etc.) [ABI encoded]
    function lockTokens(
        address depositor,
        address depositReceiver,
        address rootToken,
        bytes calldata depositData
    ) external;

    /// @notice Validates exit while withdraw process
    /// @dev Validates exit log while withdrawing. Reverts if validation fails
    /// @param withdrawer Address who wants to withdraw tokens
    /// @param logRLPList Log bytes from sidechain
    function validateExitLog(address withdrawer, bytes calldata logRLPList)
        external
        pure;

    /// @notice Processes exit after success withdraw
    /// @dev It processes withdraw based on custom logic. Example: transfer ERC20/ERC721, mint ERC721 if mintable withdraw
    /// @param withdrawer Address who wants to withdraw tokens
    /// @param rootToken Token which gets withdrawn
    /// @param logRLPList Valid sidechain log for data like amount, token id etc.
    function exitTokens(
        address withdrawer,
        address rootToken,
        bytes calldata logRLPList
    ) external;
}
