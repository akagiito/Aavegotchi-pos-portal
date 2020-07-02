import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiBN from 'chai-bn'
import BN from 'bn.js'
import { defaultAbiCoder as abi } from 'ethers/utils/abi-coder'
import { expectRevert } from '@openzeppelin/test-helpers'

import * as deployer from '../helpers/deployer'
import { mockValues, etherAddress } from '../helpers/constants'
import logDecoder from '../helpers/log-decoder.js'
import { constructERC1155DepositData } from '../helpers/utils'

// Enable and inject BN dependency
chai
  .use(chaiAsPromised)
  .use(chaiBN(BN))
  .should()

const should = chai.should()

contract('ChildChainManager', async(accounts) => {
  describe('Map tokens by directly calling function', async() => {
    const mockRootToken = mockValues.addresses[9]
    const mockChildToken = mockValues.addresses[6]
    let contracts
    before(async() => {
      contracts = await deployer.deployFreshChildContracts(accounts)
    })

    it('Can receive map token tx', async() => {
      const mapTx = await contracts.childChainManager.mapToken(mockRootToken, mockChildToken)
      should.exist(mapTx)
    })

    it('Should set rootToChildToken map', async() => {
      const childToken = await contracts.childChainManager.rootToChildToken(mockRootToken)
      childToken.should.equal(mockChildToken)
    })

    it('Should set childToRootToken map', async() => {
      const rootToken = await contracts.childChainManager.childToRootToken(mockChildToken)
      rootToken.should.equal(mockRootToken)
    })
  })

  describe('Map tokens by calling from non mapper account', async() => {
    const mockRootToken = mockValues.addresses[9]
    const mockChildToken = mockValues.addresses[6]
    let contracts
    before(async() => {
      contracts = await deployer.deployFreshChildContracts(accounts)
    })

    it('Tx should revert with correct reason', async() => {
      await expectRevert(
        contracts.childChainManager.mapToken(mockRootToken, mockChildToken, { from: accounts[1] }),
        'ChildChainManager: INSUFFICIENT_PERMISSIONS'
      )
    })
  })

  describe('Map tokens on receiving state', async() => {
    const syncId = mockValues.numbers[8]
    const mockTokenType = mockValues.bytes32[3]
    const mockRootToken = mockValues.addresses[0]
    const mockChildToken = mockValues.addresses[1]
    const syncData = abi.encode(['address', 'address', 'bytes32'], [mockRootToken, mockChildToken, mockTokenType])
    let contracts
    let syncState
    before(async() => {
      contracts = await deployer.deployFreshChildContracts(accounts)
      const parentContracts = await deployer.deployFreshRootContracts(accounts)
      const syncType = await parentContracts.rootChainManager.MAP_TOKEN()
      syncState = abi.encode(['bytes32', 'bytes'], [syncType, syncData])
    })

    it('Can receive map token sync', async() => {
      const stateReceiveTx = await contracts.childChainManager.onStateReceive(syncId, syncState)
      should.exist(stateReceiveTx)
    })

    it('Should set rootToChildToken map', async() => {
      const childToken = await contracts.childChainManager.rootToChildToken(mockRootToken)
      childToken.should.equal(mockChildToken)
    })

    it('Should set childToRootToken map', async() => {
      const rootToken = await contracts.childChainManager.childToRootToken(mockChildToken)
      rootToken.should.equal(mockRootToken)
    })
  })

  describe('Receive state from non state syncer account', () => {
    const syncId = mockValues.numbers[8]
    const mockTokenType = mockValues.bytes32[3]
    const mockRootToken = mockValues.addresses[0]
    const mockChildToken = mockValues.addresses[1]
    const syncData = abi.encode(['address', 'address', 'bytes32'], [mockRootToken, mockChildToken, mockTokenType])
    let contracts
    let syncState
    before(async() => {
      contracts = await deployer.deployFreshChildContracts(accounts)
      const parentContracts = await deployer.deployFreshRootContracts(accounts)
      const syncType = await parentContracts.rootChainManager.MAP_TOKEN()
      syncState = abi.encode(['bytes32', 'bytes'], [syncType, syncData])
    })

    it('Tx should revert with correct reason', async() => {
      await expectRevert(
        contracts.childChainManager.onStateReceive(syncId, syncState, { from: accounts[1] }),
        'ChildChainManager: INSUFFICIENT_PERMISSIONS'
      )
    })
  })

  describe('Receive non supported sync', () => {
    const syncId = mockValues.numbers[3]
    const syncType = mockValues.bytes32[2]
    let contracts
    let syncState
    before(async() => {
      contracts = await deployer.deployFreshChildContracts(accounts)
      syncState = abi.encode(['bytes32', 'bytes'], [syncType, '0x0'])
    })

    it('Tx should revert with correct reason', async() => {
      await expectRevert(
        contracts.childChainManager.onStateReceive(syncId, syncState),
        'ChildChainManager: INVALID_SYNC_TYPE'
      )
    })
  })

  describe('Deposit ERC20 on receiving state', async() => {
    const depositAmount = mockValues.amounts[0]
    const depositReceiver = mockValues.addresses[4]
    const syncId = mockValues.numbers[0]
    let contracts
    let oldAccountBalance
    let syncState
    let stateReceiveTx
    let transferLog

    before(async() => {
      contracts = await deployer.deployInitializedContracts(accounts)
      oldAccountBalance = await contracts.child.dummyERC20.balanceOf(depositReceiver)
    })

    it('Can receive ERC20 deposit sync', async() => {
      const depositData = abi.encode(['uint256'], [depositAmount.toString()])
      const syncData = abi.encode(
        ['address', 'address', 'bytes'],
        [depositReceiver, contracts.root.dummyERC20.address, depositData]
      )
      const syncType = await contracts.child.childChainManager.DEPOSIT()
      syncState = abi.encode(['bytes32', 'bytes'], [syncType, syncData])
      stateReceiveTx = await contracts.child.childChainManager
        .onStateReceive(syncId, syncState, { from: accounts[0] })
      should.exist(stateReceiveTx)
    })

    it('Should emit Transfer log', () => {
      const logs = logDecoder.decodeLogs(stateReceiveTx.receipt.rawLogs)
      transferLog = logs.find(l => l.event === 'Transfer')
      should.exist(transferLog)
    })

    describe('Correct values should be emitted in Transfer log', () => {
      it('Event should be emitted by correct contract', () => {
        transferLog.address.should.equal(
          contracts.child.dummyERC20.address.toLowerCase()
        )
      })

      it('Should emit proper From', () => {
        transferLog.args.from.should.equal(mockValues.zeroAddress)
      })

      it('Should emit proper To', () => {
        transferLog.args.to.should.equal(depositReceiver)
      })

      it('Should emit correct amount', () => {
        const transferLogAmount = new BN(transferLog.args.value.toString())
        transferLogAmount.should.be.bignumber.that.equals(depositAmount)
      })
    })

    it('Deposit amount should be credited to deposit receiver', async() => {
      const newAccountBalance = await contracts.child.dummyERC20.balanceOf(depositReceiver)
      newAccountBalance.should.be.a.bignumber.that.equals(
        oldAccountBalance.add(depositAmount)
      )
    })
  })

  describe('Deposit MaticWETH on receiving state', async() => {
    const depositAmount = mockValues.amounts[0]
    const depositReceiver = mockValues.addresses[4]
    const syncId = mockValues.numbers[0]
    let contracts
    let oldAccountBalance
    let stateReceiveTx
    let transferLog

    before(async() => {
      contracts = await deployer.deployInitializedContracts(accounts)
      oldAccountBalance = await contracts.child.maticWETH.balanceOf(depositReceiver)
    })

    it('Can receive MaticWETH deposit sync', async() => {
      const depositData = abi.encode(['uint256'], [depositAmount.toString()])
      const syncData = abi.encode(
        ['address', 'address', 'bytes'],
        [depositReceiver, etherAddress, depositData]
      )
      const syncType = await contracts.child.childChainManager.DEPOSIT()
      const syncBytes = abi.encode(
        ['bytes32', 'bytes'],
        [syncType, syncData]
      )
      stateReceiveTx = await contracts.child.childChainManager
        .onStateReceive(syncId, syncBytes, { from: accounts[0] })
      should.exist(stateReceiveTx)
    })

    it('Should emit Transfer log', () => {
      const logs = logDecoder.decodeLogs(stateReceiveTx.receipt.rawLogs)
      transferLog = logs.find(l => l.event === 'Transfer')
      should.exist(transferLog)
    })

    describe('Correct values should be emitted in Transfer log', () => {
      it('Event should be emitted by correct contract', () => {
        transferLog.address.should.equal(
          contracts.child.maticWETH.address.toLowerCase()
        )
      })

      it('Should emit proper From', () => {
        transferLog.args.from.should.equal(mockValues.zeroAddress)
      })

      it('Should emit proper To', () => {
        transferLog.args.to.should.equal(depositReceiver)
      })

      it('Should emit correct amount', () => {
        const transferLogAmount = new BN(transferLog.args.value.toString())
        transferLogAmount.should.be.bignumber.that.equals(depositAmount)
      })
    })

    it('Deposit amount should be credited to deposit receiver', async() => {
      const newAccountBalance = await contracts.child.maticWETH.balanceOf(depositReceiver)
      newAccountBalance.should.be.a.bignumber.that.equals(
        oldAccountBalance.add(depositAmount)
      )
    })
  })

  describe('Deposit ERC721 on receiving state', async() => {
    const depositTokenId = mockValues.numbers[9]
    const depositReceiver = mockValues.addresses[3]
    const syncId = mockValues.numbers[4]
    let contracts
    let stateReceiveTx
    let transferLog

    before(async() => {
      contracts = await deployer.deployInitializedContracts(accounts)
    })

    it('Token should not exist before deposit', async() => {
      await expectRevert(contracts.child.dummyERC721.ownerOf(depositTokenId), 'value out of range')
    })

    it('Can receive ERC721 deposit sync', async() => {
      const depositData = abi.encode(['uint256'], [depositTokenId])
      const syncData = abi.encode(
        ['address', 'address', 'bytes'],
        [depositReceiver, contracts.root.dummyERC721.address, depositData]
      )
      const syncType = await contracts.child.childChainManager.DEPOSIT()
      const syncBytes = abi.encode(
        ['bytes32', 'bytes'],
        [syncType, syncData]
      )
      stateReceiveTx = await contracts.child.childChainManager
        .onStateReceive(syncId, syncBytes, { from: accounts[0] })
      should.exist(stateReceiveTx)
    })

    it('Should emit Transfer log', () => {
      const logs = logDecoder.decodeLogs(stateReceiveTx.receipt.rawLogs)
      transferLog = logs.find(l => l.event === 'Transfer')
      should.exist(transferLog)
    })

    describe('Correct values should be emitted in Transfer log', () => {
      it('Event should be emitted by correct contract', () => {
        transferLog.address.should.equal(
          contracts.child.dummyERC721.address.toLowerCase()
        )
      })

      it('Should emit proper From', () => {
        transferLog.args.from.should.equal(mockValues.zeroAddress)
      })

      it('Should emit proper To', () => {
        transferLog.args.to.should.equal(depositReceiver)
      })

      it('Should emit correct tokenId', () => {
        const transferLogTokenId = transferLog.args.tokenId
        transferLogTokenId.toNumber().should.equal(depositTokenId)
      })
    })

    it('Deposit token should be credited to deposit receiver', async() => {
      const owner = await contracts.child.dummyERC721.ownerOf(depositTokenId)
      owner.should.equal(depositReceiver)
    })
  })

  describe('Deposit ERC1155 on receiving state', async() => {
    const depositTokenId = mockValues.numbers[9]
    const depositAmount = mockValues.amounts[2]
    const depositReceiver = mockValues.addresses[3]
    const syncId = mockValues.numbers[4]
    let contracts
    let stateReceiveTx
    let transferLog
    let oldAccountBalance

    before(async() => {
      contracts = await deployer.deployInitializedContracts(accounts)
      oldAccountBalance = await contracts.child.dummyERC1155.balanceOf(depositReceiver, depositTokenId)
    })

    it('Can receive ERC1155 deposit sync', async() => {
      const depositData = constructERC1155DepositData([depositTokenId], [depositAmount])
      const syncData = abi.encode(
        ['address', 'address', 'bytes'],
        [depositReceiver, contracts.root.dummyERC1155.address, depositData]
      )
      const syncType = await contracts.child.childChainManager.DEPOSIT()
      const syncBytes = abi.encode(
        ['bytes32', 'bytes'],
        [syncType, syncData]
      )
      stateReceiveTx = await contracts.child.childChainManager
        .onStateReceive(syncId, syncBytes, { from: accounts[0] })
      should.exist(stateReceiveTx)
    })

    it('Should emit TransferBatch log', () => {
      const logs = logDecoder.decodeLogs(stateReceiveTx.receipt.rawLogs)
      transferLog = logs.find(l => l.event === 'TransferBatch')
      should.exist(transferLog)
    })

    describe('Correct values should be emitted in TransferBatch log', () => {
      it('Event should be emitted by correct contract', () => {
        transferLog.address.should.equal(
          contracts.child.dummyERC1155.address.toLowerCase()
        )
      })

      it('Should emit proper operator', () => {
        transferLog.args.operator.should.equal(contracts.child.childChainManager.address)
      })

      it('Should emit proper from', () => {
        transferLog.args.from.should.equal(mockValues.zeroAddress)
      })

      it('Should emit proper to', () => {
        transferLog.args.to.should.equal(depositReceiver)
      })

      it('Should emit correct tokenId', () => {
        const transferLogTokenId = transferLog.args.ids[0]
        transferLogTokenId.toNumber().should.equal(depositTokenId)
      })

      it('Should emit correct amount', () => {
        const transferLogAmount = new BN(transferLog.args.values[0].toString())
        transferLogAmount.should.be.bignumber.that.equals(depositAmount)
      })
    })

    it('Deposit tokens should be credited to deposit receiver', async() => {
      const newAccountBalance = await contracts.child.dummyERC1155.balanceOf(depositReceiver, depositTokenId)
      newAccountBalance.should.be.a.bignumber.that.equals(
        oldAccountBalance.add(depositAmount)
      )
    })
  })

  describe('Deposit batch ERC1155 on receiving state', async() => {
    const depositTokenIdA = mockValues.numbers[9]
    const depositTokenIdB = mockValues.numbers[3]
    const depositTokenIdC = mockValues.numbers[4]
    const depositAmountA = mockValues.amounts[2]
    const depositAmountB = mockValues.amounts[6]
    const depositAmountC = mockValues.amounts[7]
    const depositReceiver = mockValues.addresses[3]
    const syncId = mockValues.numbers[9]
    let contracts
    let stateReceiveTx
    let transferLog
    let oldAccountBalanceA
    let oldAccountBalanceB
    let oldAccountBalanceC

    before(async() => {
      contracts = await deployer.deployInitializedContracts(accounts)
      oldAccountBalanceA = await contracts.child.dummyERC1155.balanceOf(depositReceiver, depositTokenIdA)
      oldAccountBalanceB = await contracts.child.dummyERC1155.balanceOf(depositReceiver, depositTokenIdB)
      oldAccountBalanceC = await contracts.child.dummyERC1155.balanceOf(depositReceiver, depositTokenIdC)
    })

    it('Can receive ERC1155 deposit sync', async() => {
      const depositData = constructERC1155DepositData(
        [depositTokenIdA, depositTokenIdB, depositTokenIdC],
        [depositAmountA, depositAmountB, depositAmountC]
      )
      const syncData = abi.encode(
        ['address', 'address', 'bytes'],
        [depositReceiver, contracts.root.dummyERC1155.address, depositData]
      )
      const syncType = await contracts.child.childChainManager.DEPOSIT()
      const syncBytes = abi.encode(
        ['bytes32', 'bytes'],
        [syncType, syncData]
      )
      stateReceiveTx = await contracts.child.childChainManager
        .onStateReceive(syncId, syncBytes, { from: accounts[0] })
      should.exist(stateReceiveTx)
    })

    it('Should emit Transfer log', () => {
      const logs = logDecoder.decodeLogs(stateReceiveTx.receipt.rawLogs)
      transferLog = logs.find(l => l.event === 'TransferBatch')
      should.exist(transferLog)
    })

    describe('Correct values should be emitted in TransferBatch log', () => {
      it('Event should be emitted by correct contract', () => {
        transferLog.address.should.equal(
          contracts.child.dummyERC1155.address.toLowerCase()
        )
      })

      it('Should emit proper operator', () => {
        transferLog.args.operator.should.equal(contracts.child.childChainManager.address)
      })

      it('Should emit proper from', () => {
        transferLog.args.from.should.equal(mockValues.zeroAddress)
      })

      it('Should emit proper to', () => {
        transferLog.args.to.should.equal(depositReceiver)
      })

      it('Should emit correct tokenId for A', () => {
        const transferLogTokenId = transferLog.args.ids[0]
        transferLogTokenId.toNumber().should.equal(depositTokenIdA)
      })

      it('Should emit correct tokenId for B', () => {
        const transferLogTokenId = transferLog.args.ids[1]
        transferLogTokenId.toNumber().should.equal(depositTokenIdB)
      })

      it('Should emit correct tokenId for C', () => {
        const transferLogTokenId = transferLog.args.ids[2]
        transferLogTokenId.toNumber().should.equal(depositTokenIdC)
      })

      it('Should emit correct amount for A', () => {
        const transferLogAmount = new BN(transferLog.args.values[0].toString())
        transferLogAmount.should.be.bignumber.that.equals(depositAmountA)
      })

      it('Should emit correct amount for B', () => {
        const transferLogAmount = new BN(transferLog.args.values[1].toString())
        transferLogAmount.should.be.bignumber.that.equals(depositAmountB)
      })

      it('Should emit correct amount for C', () => {
        const transferLogAmount = new BN(transferLog.args.values[2].toString())
        transferLogAmount.should.be.bignumber.that.equals(depositAmountC)
      })
    })

    it('Deposit tokens should be credited to deposit receiver for A', async() => {
      const newAccountBalance = await contracts.child.dummyERC1155.balanceOf(depositReceiver, depositTokenIdA)
      newAccountBalance.should.be.a.bignumber.that.equals(
        oldAccountBalanceA.add(depositAmountA)
      )
    })

    it('Deposit tokens should be credited to deposit receiver for B', async() => {
      const newAccountBalance = await contracts.child.dummyERC1155.balanceOf(depositReceiver, depositTokenIdB)
      newAccountBalance.should.be.a.bignumber.that.equals(
        oldAccountBalanceB.add(depositAmountB)
      )
    })

    it('Deposit tokens should be credited to deposit receiver for C', async() => {
      const newAccountBalance = await contracts.child.dummyERC1155.balanceOf(depositReceiver, depositTokenIdC)
      newAccountBalance.should.be.a.bignumber.that.equals(
        oldAccountBalanceC.add(depositAmountC)
      )
    })
  })
})
