pragma solidity ^0.6.6;

// import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {RLPReader} from "../../lib/RLPReader.sol";
import {ITokenPredicate} from "./ITokenPredicate.sol";
import {Initializable} from "../../common/Initializable.sol";

contract EtherPredicate is ITokenPredicate, AccessControl, Initializable {
    using RLPReader for bytes;
    using RLPReader for RLPReader.RLPItem;

    bytes32 public constant MANAGER_ROLE = keccak256("MANAGER_ROLE");
    bytes32 public constant TOKEN_TYPE = keccak256("Ether");
    bytes32 public constant TRANSFER_EVENT_SIG = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    event LockedEther(
        address indexed depositor,
        address indexed depositReceiver,
        uint256 amount
    );

    modifier only(bytes32 role) {
        require(hasRole(role, _msgSender()), "EtherPredicate: INSUFFICIENT_PERMISSIONS");
        _;
    }

    constructor() public {}

    function initialize() external initializer {
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _setupRole(MANAGER_ROLE, _msgSender());
    }

    receive() external payable only(MANAGER_ROLE) {}

    function lockTokens(
        address depositor,
        address depositReceiver,
        address,
        bytes calldata depositData
    )
        external
        override
        only(MANAGER_ROLE)
    {
        uint256 amount = abi.decode(depositData, (uint256));
        emit LockedEther(depositor, depositReceiver, amount);
    }

    function validateExitLog(address withdrawer, bytes calldata log)
        external
        override
        pure
    {
        RLPReader.RLPItem[] memory logRLPList = log.toRlpItem().toList();
        RLPReader.RLPItem[] memory logTopicRLPList = logRLPList[1].toList(); // topics
        require(
            bytes32(logTopicRLPList[0].toUint()) == TRANSFER_EVENT_SIG, // topic0 is event sig
            "EtherPredicate: INVALID_SIGNATURE"
        );
        require(
            withdrawer == address(logTopicRLPList[1].toUint()), // topic1 is from address
            "EtherPredicate: INVALID_SENDER"
        );
        require(
            address(logTopicRLPList[2].toUint()) == address(0), // topic2 is to address
            "EtherPredicate: INVALID_RECEIVER"
        );
    }

    function exitTokens(
        address withdrawer,
        address,
        bytes memory log
    )
        public
        override
        only(MANAGER_ROLE)
    {
        address payable _withdrawer = address(uint160(withdrawer));
        RLPReader.RLPItem[] memory logRLPList = log.toRlpItem().toList();
        _withdrawer.transfer(logRLPList[2].toUint());
    }
}
