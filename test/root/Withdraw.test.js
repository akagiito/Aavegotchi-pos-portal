import chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
import chaiBN from 'chai-bn'
import BN from 'bn.js'
import { defaultAbiCoder as abi } from 'ethers/utils/abi-coder'
import { bufferToHex, rlp } from 'ethereumjs-util'

import * as deployer from '../helpers/deployer'
import { mockValues } from '../helpers/constants'
import { childWeb3 } from '../helpers/contracts'
import logDecoder from '../helpers/log-decoder'
import { build as buildCheckpoint } from '../helpers/checkpoint'

// Enable and inject BN dependency
chai
  .use(chaiAsPromised)
  .use(chaiBN(BN))
  .should()

const should = chai.should()

// submit checkpoint
const submitCheckpoint = async(checkpointManager, receiptObj) => {
  const tx = await childWeb3.eth.getTransaction(receiptObj.transactionHash)
  const receipt = await childWeb3.eth.getTransactionReceipt(
    receiptObj.transactionHash
  )
  const block = await childWeb3.eth.getBlock(
    receipt.blockHash,
    true /* returnTransactionObjects */
  )
  const event = {
    tx,
    receipt,
    block
  }

  // build checkpoint
  const checkpointData = await buildCheckpoint(event)
  const root = bufferToHex(checkpointData.header.root)

  // submit checkpoint including burn (withdraw) tx
  await checkpointManager.setCheckpoint(root, block.number, block.number)

  // return checkpoint data
  return checkpointData
}

contract('RootChainManager', async(accounts) => {
  describe('Withdraw ERC20', async() => {
    const depositAmount = mockValues.amounts[1]
    const withdrawAmount = mockValues.amounts[1]
    const depositReceiver = accounts[0]
    const depositData = abi.encode(['uint256'], [depositAmount.toString()])
    let contracts
    let dummyERC20
    let rootChainManager
    let accountBalance
    let contractBalance
    let transferLog
    let withdrawTx
    let checkpointData
    let headerNumber
    let exitTx

    before(async() => {
      contracts = await deployer.deployInitializedContracts(accounts)
      dummyERC20 = contracts.root.dummyERC20
      rootChainManager = contracts.root.rootChainManager
      accountBalance = await dummyERC20.balanceOf(accounts[0])
      contractBalance = await dummyERC20.balanceOf(contracts.root.erc20Predicate.address)
    })

    it('Depositor should be able to approve and deposit', async() => {
      await dummyERC20.approve(contracts.root.erc20Predicate.address, depositAmount)
      const depositTx = await rootChainManager.depositFor(depositReceiver, dummyERC20.address, depositData)
      should.exist(depositTx)
    })

    it('Deposit amount should be deducted from depositor account', async() => {
      const newAccountBalance = await dummyERC20.balanceOf(accounts[0])
      newAccountBalance.should.be.a.bignumber.that.equals(
        accountBalance.sub(depositAmount)
      )

      // update account balance
      accountBalance = newAccountBalance
    })

    it('Deposit amount should be credited to correct contract', async() => {
      const newContractBalance = await dummyERC20.balanceOf(contracts.root.erc20Predicate.address)
      newContractBalance.should.be.a.bignumber.that.equals(
        contractBalance.add(depositAmount)
      )

      // update balance
      contractBalance = newContractBalance
    })

    it('Can receive deposit tx', async() => {
      const depositTx = await contracts.child.dummyERC20.deposit(depositReceiver, depositData)
      should.exist(depositTx)
      const logs = logDecoder.decodeLogs(depositTx.receipt.rawLogs)
      const transferLog = logs.find(l => l.event === 'Transfer')
      should.exist(transferLog)
    })

    it('Can receive withdraw tx', async() => {
      withdrawTx = await contracts.child.dummyERC20.withdraw(withdrawAmount, { from: depositReceiver })
      should.exist(withdrawTx)
    })

    it('Should emit Transfer log in withdraw tx', () => {
      const logs = logDecoder.decodeLogs(withdrawTx.receipt.rawLogs)
      transferLog = logs.find(l => l.event === 'Transfer')
      should.exist(transferLog)
    })

    it('Should submit checkpoint', async() => {
      // submit checkpoint including burn (withdraw) tx
      checkpointData = await submitCheckpoint(contracts.root.checkpointManager, withdrawTx.receipt)
      should.exist(checkpointData)
    })

    it('Should match checkpoint details', async() => {
      const root = bufferToHex(checkpointData.header.root)
      should.exist(root)

      // fetch latest header number
      headerNumber = await contracts.root.checkpointManager.currentCheckpointNumber()
      headerNumber.should.be.bignumber.gt('0')

      // fetch header block details and validate
      const headerData = await contracts.root.checkpointManager.headerBlocks(headerNumber)
      root.should.equal(headerData.root)
    })

    it('Should start exit', async() => {
      const logIndex = 0
      const data = bufferToHex(
        rlp.encode([
          headerNumber,
          bufferToHex(Buffer.concat(checkpointData.proof)),
          checkpointData.number,
          checkpointData.timestamp,
          bufferToHex(checkpointData.transactionsRoot),
          bufferToHex(checkpointData.receiptsRoot),
          bufferToHex(checkpointData.receipt),
          bufferToHex(rlp.encode(checkpointData.receiptParentNodes)),
          bufferToHex(rlp.encode(checkpointData.path)), // branch mask,
          logIndex
        ])
      )

      // start exit
      exitTx = await contracts.root.rootChainManager.exit(data, { from: depositReceiver })
      should.exist(exitTx)
    })

    it('Should emit Transfer log in exit tx', () => {
      const logs = logDecoder.decodeLogs(exitTx.receipt.rawLogs)
      const exitTransferLog = logs.find(l => l.event === 'Transfer')
      should.exist(exitTransferLog)
    })

    it('Should have more amount in withdrawer account after withdraw', async() => {
      const newAccountBalance = await dummyERC20.balanceOf(depositReceiver)
      newAccountBalance.should.be.a.bignumber.that.equals(
        accountBalance.add(depositAmount)
      )
    })

    it('Should have less amount in predicate contract after withdraw', async() => {
      const newContractBalance = await dummyERC20.balanceOf(contracts.root.erc20Predicate.address)
      newContractBalance.should.be.a.bignumber.that.equals(
        contractBalance.sub(withdrawAmount)
      )
    })
  })

  describe('Withdraw ERC721', async() => {
    const depositTokenId = mockValues.numbers[4]
    const depositForAccount = mockValues.addresses[0]
    const depositAmount = new BN('1')
    const withdrawAmount = new BN('1')
    const depositReceiver = accounts[0]
    const depositData = abi.encode(['uint256'], [depositTokenId.toString()])
    let contracts
    let dummyERC721
    let rootChainManager
    let accountBalance
    let contractBalance
    let transferLog
    let withdrawTx
    let checkpointData
    let headerNumber
    let exitTx

    before(async() => {
      contracts = await deployer.deployInitializedContracts(accounts)
      dummyERC721 = contracts.root.dummyERC721
      rootChainManager = contracts.root.rootChainManager
      await dummyERC721.mint(depositTokenId)
      accountBalance = await dummyERC721.balanceOf(accounts[0])
      contractBalance = await dummyERC721.balanceOf(contracts.root.erc721Predicate.address)
    })

    it('Depositor should be able to approve and deposit', async() => {
      await dummyERC721.approve(contracts.root.erc721Predicate.address, depositTokenId)
      const depositTx = await rootChainManager.depositFor(depositForAccount, dummyERC721.address, depositData)
      should.exist(depositTx)
    })

    it('Deposit amount should be deducted from depositor account', async() => {
      const newAccountBalance = await dummyERC721.balanceOf(accounts[0])
      newAccountBalance.should.be.a.bignumber.that.equals(
        accountBalance.sub(depositAmount)
      )

      // update account balance
      accountBalance = newAccountBalance
    })

    it('Deposit amount should be credited to correct contract', async() => {
      const newContractBalance = await dummyERC721.balanceOf(contracts.root.erc721Predicate.address)
      newContractBalance.should.be.a.bignumber.that.equals(
        contractBalance.add(depositAmount)
      )

      // update balance
      contractBalance = newContractBalance
    })

    it('Can receive deposit tx', async() => {
      const depositTx = await contracts.child.dummyERC721.deposit(depositReceiver, depositData)
      should.exist(depositTx)
      const logs = logDecoder.decodeLogs(depositTx.receipt.rawLogs)
      const transferLog = logs.find(l => l.event === 'Transfer')
      should.exist(transferLog)
    })

    it('Can receive withdraw tx', async() => {
      withdrawTx = await contracts.child.dummyERC721.withdraw(depositTokenId, { from: depositReceiver })
      should.exist(withdrawTx)
    })

    it('Should emit Transfer log in withdraw tx', () => {
      const logs = logDecoder.decodeLogs(withdrawTx.receipt.rawLogs)
      transferLog = logs.find(l => l.event === 'Transfer')
      should.exist(transferLog)
    })

    it('Should submit checkpoint', async() => {
      // submit checkpoint including burn (withdraw) tx
      checkpointData = await submitCheckpoint(contracts.root.checkpointManager, withdrawTx.receipt)
      should.exist(checkpointData)
    })

    it('Should match checkpoint details', async() => {
      const root = bufferToHex(checkpointData.header.root)
      should.exist(root)

      // fetch latest header number
      headerNumber = await contracts.root.checkpointManager.currentCheckpointNumber()
      headerNumber.should.be.bignumber.gt('0')

      // fetch header block details and validate
      const headerData = await contracts.root.checkpointManager.headerBlocks(headerNumber)
      root.should.equal(headerData.root)
    })

    it('Should start exit', async() => {
      const logIndex = 1
      const data = bufferToHex(
        rlp.encode([
          headerNumber,
          bufferToHex(Buffer.concat(checkpointData.proof)),
          checkpointData.number,
          checkpointData.timestamp,
          bufferToHex(checkpointData.transactionsRoot),
          bufferToHex(checkpointData.receiptsRoot),
          bufferToHex(checkpointData.receipt),
          bufferToHex(rlp.encode(checkpointData.receiptParentNodes)),
          bufferToHex(rlp.encode(checkpointData.path)), // branch mask,
          logIndex
        ])
      )

      // start exit
      exitTx = await contracts.root.rootChainManager.exit(data, { from: depositReceiver })
      should.exist(exitTx)
    })

    it('Should emit Transfer log in exit tx', () => {
      const logs = logDecoder.decodeLogs(exitTx.receipt.rawLogs)
      const exitTransferLog = logs.find(l => l.event === 'Transfer')
      should.exist(exitTransferLog)
    })

    it('Should have more amount in withdrawer account after withdraw', async() => {
      const newAccountBalance = await dummyERC721.balanceOf(depositReceiver)
      newAccountBalance.should.be.a.bignumber.that.equals(
        accountBalance.add(depositAmount)
      )
    })

    it('Should have less amount in predicate contract after withdraw', async() => {
      const newContractBalance = await dummyERC721.balanceOf(contracts.root.erc721Predicate.address)
      newContractBalance.should.be.a.bignumber.that.equals(
        contractBalance.sub(withdrawAmount)
      )
    })
  })

  describe.only('Withdraw ERC1155', async() => {
    const tokenId = mockValues.numbers[8]
    const depositAmount = mockValues.amounts[1]
    const withdrawAmount = mockValues.amounts[1]
    const depositReceiver = accounts[0]
    const depositData = abi.encode(
      [
        'uint256[]',
        'uint256[]',
        'bytes'
      ],
      [
        [tokenId.toString()],
        [depositAmount.toString()],
        ['0x0']
      ]
    )
    let contracts
    let dummyERC1155
    let rootChainManager
    let accountBalance
    let contractBalance
    let transferLog
    let withdrawTx
    let checkpointData
    let headerNumber
    let exitTx

    before(async() => {
      contracts = await deployer.deployInitializedContracts(accounts)
      dummyERC1155 = contracts.root.dummyERC1155
      rootChainManager = contracts.root.rootChainManager
      const mintAmount = depositAmount.add(mockValues.amounts[2])
      await dummyERC1155.mint(accounts[0], tokenId, mintAmount)
      accountBalance = await dummyERC1155.balanceOf(accounts[0], tokenId)
      contractBalance = await dummyERC1155.balanceOf(contracts.root.erc1155Predicate.address, tokenId)
    })

    it('Depositor should be able to approve and deposit', async() => {
      await dummyERC1155.setApprovalForAll(contracts.root.erc1155Predicate.address, true)
      const depositTx = await rootChainManager.depositFor(depositReceiver, dummyERC1155.address, depositData)
      should.exist(depositTx)
    })

    it('Deposit amount should be deducted from depositor account', async() => {
      const newAccountBalance = await dummyERC1155.balanceOf(accounts[0], tokenId)
      newAccountBalance.should.be.a.bignumber.that.equals(
        accountBalance.sub(depositAmount)
      )

      // update account balance
      accountBalance = newAccountBalance
    })

    it('Deposit amount should be credited to correct contract', async() => {
      const newContractBalance = await dummyERC1155.balanceOf(contracts.root.erc1155Predicate.address, tokenId)
      newContractBalance.should.be.a.bignumber.that.equals(
        contractBalance.add(depositAmount)
      )

      // update balance
      contractBalance = newContractBalance
    })

    it('Can receive deposit tx', async() => {
      const depositTx = await contracts.child.dummyERC1155.deposit(depositReceiver, depositData)
      should.exist(depositTx)
      const logs = logDecoder.decodeLogs(depositTx.receipt.rawLogs)
      const transferLog = logs.find(l => l.event === 'TransferBatch')
      should.exist(transferLog)
    })

    it('Can receive withdraw tx', async() => {
      withdrawTx = await contracts.child.dummyERC1155.withdrawSingle(tokenId, withdrawAmount, { from: depositReceiver })
      should.exist(withdrawTx)
    })

    it('Should emit Transfer log in withdraw tx', () => {
      const logs = logDecoder.decodeLogs(withdrawTx.receipt.rawLogs)
      transferLog = logs.find(l => l.event === 'TransferSingle')
      should.exist(transferLog)
    })

    it('Should submit checkpoint', async() => {
      // submit checkpoint including burn (withdraw) tx
      checkpointData = await submitCheckpoint(contracts.root.checkpointManager, withdrawTx.receipt)
      should.exist(checkpointData)
    })

    it('Should match checkpoint details', async() => {
      const root = bufferToHex(checkpointData.header.root)
      should.exist(root)

      // fetch latest header number
      headerNumber = await contracts.root.checkpointManager.currentCheckpointNumber()
      headerNumber.should.be.bignumber.gt('0')

      // fetch header block details and validate
      const headerData = await contracts.root.checkpointManager.headerBlocks(headerNumber)
      root.should.equal(headerData.root)
    })

    it('Should start exit', async() => {
      const logIndex = 0
      console.log(withdrawTx.receipt)
      const data = bufferToHex(
        rlp.encode([
          headerNumber,
          bufferToHex(Buffer.concat(checkpointData.proof)),
          checkpointData.number,
          checkpointData.timestamp,
          bufferToHex(checkpointData.transactionsRoot),
          bufferToHex(checkpointData.receiptsRoot),
          bufferToHex(checkpointData.receipt),
          bufferToHex(rlp.encode(checkpointData.receiptParentNodes)),
          bufferToHex(rlp.encode(checkpointData.path)), // branch mask,
          logIndex
        ])
      )

      // start exit
      exitTx = await contracts.root.rootChainManager.exit(data, { from: depositReceiver })
      should.exist(exitTx)
    })

    it('Should emit Transfer log in exit tx', () => {
      const logs = logDecoder.decodeLogs(exitTx.receipt.rawLogs)
      const exitTransferLog = logs.find(l => l.event === 'TransferSingle')
      should.exist(exitTransferLog)
    })

    it('Should have more amount in withdrawer account after withdraw', async() => {
      const newAccountBalance = await dummyERC1155.balanceOf(depositReceiver, tokenId)
      newAccountBalance.should.be.a.bignumber.that.equals(
        accountBalance.add(depositAmount)
      )
    })

    it('Should have less amount in predicate contract after withdraw', async() => {
      const newContractBalance = await dummyERC1155.balanceOf(contracts.root.erc1155Predicate.address, tokenId)
      newContractBalance.should.be.a.bignumber.that.equals(
        contractBalance.sub(withdrawAmount)
      )
    })
  })
})
