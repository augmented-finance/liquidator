/*eslint-disable*/
import { createServer } from '../src/server'
import * as config from '../src/config'
import BigNumber from 'bignumber.js'

import { networks, NetworkModel } from '../src/database/Network'
import { TokenModel } from '../src/database/Token'

import { evmRevert, evmSnapshot, increaseTime } from '../protocol/helpers/misc-utils'
import { buildFlashLiquidationAdapterParams, convertToCurrencyDecimals } from '../protocol/helpers/contracts-helpers'
import { APPROVAL_AMOUNT_LENDING_POOL, oneEther } from '../protocol/helpers/constants'
import { makeSuite, TestEnv } from '../protocol/test-suites/test-augmented/helpers/make-suite'
import { initListeners, stopListeners } from '../src/listener'
import { getListeners, ListenerModel } from '../src/database/Listener'
import { ProtocolErrors, RateMode } from '../protocol/helpers/types'
import { UserAccountModel } from '../src/database/UserAccount'
import { getWeb3, IContractOptions } from '../src/contract/utils/web3'
import { MockUniswapV2Router02 } from '../types'
import { getMockUniswapRouter } from '../protocol/helpers/contracts-getters'
import { LiquidateModel, LiquidateModelStatus, updateLiquidateQueue } from '../src/database/Liquidate'

import liquidateCheckQueue from '../src/jobs/sheduler/liquidate-check-queue'
import { Monitoring } from '../src/utils/monitoring'
import { MONITORINGS, ZONE } from '../src/utils/zone'
import { getUserData } from '../protocol/test-suites/test-augmented/helpers/utils/helpers'
import { createUserSeeds, inactivesNetworksSeeds } from './utils/seeds'

const kill = require('kill-port')
const hre = require('hardhat')
const { expect } = require('chai')
const wallets = require('../protocol/test-wallets')

// Overwriting system variables in config for testing
config.lpAddressProvider.eth = ''
config.dataProvider.eth = ''
config.account.address = ''
config.account.privateKey = wallets.accounts[wallets.accounts.length - 1].secretKey
config.utils.expectProfit = '0.002'
config.deployBlocks.eth = null

const START_BALANCE = wallets.accounts[0].balance
const PROVIDER_URL = 'http://127.0.0.1:8545/'

makeSuite('Liquidator', (testEnv: TestEnv) => {
  let server
  let evmSnapshotId: string
  const { INVALID_HF } = ProtocolErrors
  let mockUniswapRouter: MockUniswapV2Router02
  let options: IContractOptions
  let web3

  const delay = (delayInms) => {
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(2)
      }, delayInms)
    })
  }

  const mineBlocks = async (blockNumber) => {
    while (blockNumber > 0) {
      blockNumber--
      await hre.network.provider.request({
        method: 'evm_mine',
        params: []
      })
    }
  }

  const waitForEvent = async () => {
    const BLOCK_CONFIRMATIONS = 12

    await mineBlocks(BLOCK_CONFIRMATIONS)
    await delay(3000)
  }

  const depositAndBorrowAndHFGreaterOne = async () => {
    const { dai, weth, users, pool, oracle } = testEnv
    const depositAmount = '1000'

    const depositor = users[0]
    const borrower = users[1]

    await dai.connect(depositor.signer).mint(await convertToCurrencyDecimals(dai.address, depositAmount))
    await dai.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
    const amountDAItoDeposit = await convertToCurrencyDecimals(dai.address, depositAmount)

    await pool
      .connect(depositor.signer)
      .deposit(dai.address, amountDAItoDeposit, depositor.address, depositAmount)

    await waitForEvent()

    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '1')
    await weth.connect(borrower.signer).mint(await convertToCurrencyDecimals(weth.address, '1000'))
    await weth.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0')

    await waitForEvent()

    const depositerAccount = await UserAccountModel.findOne({ where: { address: depositor.address, networkId: networks.ETH }, raw: true })
    expect(+depositerAccount.healthFactor).to.be.equal(-1)

    const borrowerAccount = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })
    expect(+borrowerAccount.healthFactor).to.be.equal(-1)

    const daiPrice = await oracle.getAssetPrice(dai.address)
    const amountDAIToBorrow = await convertToCurrencyDecimals(
      dai.address,
      new BigNumber(borrowerAccount.availableBorrowsETH.toString())
        .div(daiPrice.toString())
        .multipliedBy(0.95)
        .toFixed(0)
    )

    await pool
      .connect(borrower.signer)
      .borrow(dai.address, amountDAIToBorrow, RateMode.Stable, '0', borrower.address)

    await waitForEvent()
  }

  const monitoringUsers = async () => {
    const monitoringYellow = new Monitoring(ZONE.YELLOW, MONITORINGS[ZONE.YELLOW].updatePeriod)
    const monitoringOrange = new Monitoring(ZONE.ORANGE, MONITORINGS[ZONE.ORANGE].updatePeriod)
    const monitoringRed = new Monitoring(ZONE.RED, MONITORINGS[ZONE.RED].updatePeriod)

    await (monitoringYellow.callback(ZONE.YELLOW, 'monitoring'))()
    await (monitoringOrange.callback(ZONE.ORANGE, 'monitoring'))()
    await (monitoringRed.callback(ZONE.RED, 'monitoring'))()
  }

  const checkLiquidationQueue = async () => {
    await liquidateCheckQueue()
  }

  const depositAndHFBelowOne = async () => {
    const { dai, weth, users, pool, oracle } = testEnv
    const depositor = users[0]
    const borrower = users[1]

    // mints DAI to depositor
    await dai.connect(depositor.signer).mint(await convertToCurrencyDecimals(dai.address, '1000'))

    // approve protocol to access depositor wallet
    await dai.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)

    // user 1 deposits 1000 DAI
    const amountDAItoDeposit = await convertToCurrencyDecimals(dai.address, '1000')

    await pool
      .connect(depositor.signer)
      .deposit(dai.address, amountDAItoDeposit, depositor.address, '0')

    await waitForEvent()

    // user 2 deposits 1 ETH
    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '1')

    // mints WETH to borrower
    await weth.connect(borrower.signer).mint(await convertToCurrencyDecimals(weth.address, '1000'))

    // approve protocol to access the borrower wallet
    await weth.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)

    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0')

    await waitForEvent()
    // user 2 borrows

    const userGlobalDataBefore = await pool.getUserAccountData(borrower.address)
    const daiPrice = await oracle.getAssetPrice(dai.address)

    const amountDAIToBorrow = await convertToCurrencyDecimals(
      dai.address,
      new BigNumber(userGlobalDataBefore.availableBorrowsETH.toString())
        .div(daiPrice.toString())
        .multipliedBy(0.95)
        .toFixed(0)
    )

    await pool
      .connect(borrower.signer)
      .borrow(dai.address, amountDAIToBorrow, RateMode.Stable, '0', borrower.address)

    await waitForEvent()

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address)

    expect(userGlobalDataAfter.currentLiquidationThreshold.toString()).to.be.equal(
      '8250',
      INVALID_HF
    )

    await oracle.setAssetPrice(
      dai.address,
      new BigNumber(daiPrice.toString()).multipliedBy(1.18).toFixed(0)
    )

    const userGlobalData = await pool.getUserAccountData(borrower.address)

    expect(userGlobalData.healthFactor.toString()).to.be.bignumber.lt(
      oneEther.toFixed(0),
      INVALID_HF
    )
  }

  before(async () => {
    try {
      hre.run('node')
      await hre.network.provider.send('hardhat_setLoggingEnabled', [false])
      await delay(5000)
    } catch (e) {}

    mockUniswapRouter = await getMockUniswapRouter()

    config.account.address = testEnv.users[testEnv.users.length - 1].address
    config.lpAddressProvider.eth = testEnv.addressesProvider.address
    config.dataProvider.eth = testEnv.helpersContract.address
    config.generalReserve.eth = testEnv.dai.address
    config.uniswapAddresses.eth = mockUniswapRouter.address
    config.flashloanLiqudationAdapter.eth = testEnv.flashLiquidationAdapter.address
    options = {
      network: networks.ETH,
      provider: PROVIDER_URL
    }

    web3 = await getWeb3(options.network, options.provider)

    server = await createServer()
    await server.start()

    // create AVAX and BSC inactive networks
    const inactiveNetworks = inactivesNetworksSeeds.map((network) => network.id)
    await NetworkModel.bulkCreate(inactivesNetworksSeeds)

    // create user accounts in inactive networks with the same addresses as in the active one
    await UserAccountModel.bulkCreate(createUserSeeds(inactiveNetworks, testEnv.users))
    await delay(5000)
  })

  describe('Setup', () => {
    before(async () => {
      evmSnapshotId = await evmSnapshot()
    })

    after(async () => {
      await stopListeners()
      await evmRevert(evmSnapshotId)
    })

    describe('Networks', () => {
      it('should init available networks', async () => {
        const allNetworks = await NetworkModel.findAll(
          { raw: true, attributes: ['id', 'provider', 'balance', 'isActive'] }
        )

        expect(allNetworks).to.be.an('array')
        expect(allNetworks).to.have.lengthOf(3)

        const activeNetwork = allNetworks.find((network) => network.id === networks.ETH)
        expect(activeNetwork.id).to.be.equal(networks.ETH)
        expect(activeNetwork.provider).to.be.equal(PROVIDER_URL)
        expect(activeNetwork.balance).to.be.equal(START_BALANCE)
        expect(!!activeNetwork.isActive).to.be.true // isActive can be (1 or 0) OR  (true or false)

        const inactiveNetworks = allNetworks.filter((network) => network.id !== networks.ETH)
        expect(inactiveNetworks).to.have.lengthOf(2)
        expect(!!inactiveNetworks[0].isActive).to.be.false
        expect(!!inactiveNetworks[1].isActive).to.be.false
      })
    })

    describe('Tokens', () => {
      it('should init available tokens', async () => {
        const tokens = await TokenModel.findAll({ raw: true })
        expect(tokens).to.be.an('array')
        expect(tokens).to.not.be.empty
      })
    })

    describe('Listeners', () => {
      it('should init listeners', async () => {
        const listeners = await getListeners('lending-pool')
        expect(listeners).to.be.an('array')
        expect(listeners).to.have.lengthOf(1)
        expect(listeners[0].contractAddress).to.be.equal(
          testEnv.pool.address
        )
        expect(listeners[0].network.id).to.be.equal('eth')
        expect(listeners[0].abi).to.exist
      })

      it('should process new event', async () => {
        await depositAndBorrowAndHFGreaterOne()

        const { users } = testEnv

        const depositor = users[0]
        const borrower = users[1]

        const depositerAccount = await UserAccountModel.findOne({ where: { address: depositor.address, networkId: networks.ETH }, raw: true })
        expect(+depositerAccount.healthFactor).to.be.equal(-1)

        const borrowerAccount = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })
        expect(+borrowerAccount.healthFactor).to.be.not.equal(-1)
      })
    })

    describe('Monitoring', () => {
      let daiPrice

      before(async () => {
        const { oracle, dai } = testEnv
        daiPrice = await oracle.getAssetPrice(dai.address)
      })

      it('should correct update user data', async () => {
        const { oracle, dai, users } = testEnv
        const borrower = users[1]

        let borrowerAccount = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })
        expect(borrowerAccount).to.be.exist
        const hf1 = Number(borrowerAccount.healthFactor)

        await oracle.setAssetPrice(
          dai.address,
          new BigNumber(daiPrice.toString()).multipliedBy(0.18).toFixed(0)
        )

        await monitoringUsers()

        borrowerAccount = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })
        const hf2 = Number(borrowerAccount.healthFactor)

        expect(hf2).to.be.bignumber.gt(hf1)
      })

      it('should add users with hf below to liquidation queue', async () => {
        const { oracle, dai, users } = testEnv
        const borrower = users[1]

        await oracle.setAssetPrice(
          dai.address,
          new BigNumber(daiPrice.toString()).multipliedBy(1.18).toFixed(0)
        )

        await monitoringUsers()

        const borrowerAccount = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })
        const hf3 = Number(borrowerAccount.healthFactor)
        expect(hf3).to.be.bignumber.lt(1)

        const liquidationQueue = await LiquidateModel.findAll({ raw: true })
        expect(liquidationQueue.length).to.be.equal(1)
        expect(liquidationQueue[0].status).to.be.equal(LiquidateModelStatus.PENDING)
      })
    })

    describe('Check liquidation queue', () => {
      it('should postpone the liquidation if the position does not already meet expectations', async () => {
        let liquidationQueue = await LiquidateModel.findAll({ raw: true })
        expect(liquidationQueue.length).to.be.equal(1)
        expect(liquidationQueue[0].status).to.be.equal(LiquidateModelStatus.PENDING)

        const oldExpectProfit = config.utils.expectProfit
        config.utils.expectProfit = '1'

        await checkLiquidationQueue()
        liquidationQueue = await LiquidateModel.findAll({ raw: true })
        expect(liquidationQueue.length).to.be.equal(1)
        expect(liquidationQueue[0].status).to.be.equal(LiquidateModelStatus.DEFERRED)

        config.utils.expectProfit = oldExpectProfit

        await delay(15000)
        liquidationQueue = await LiquidateModel.findAll({ raw: true })
        expect(liquidationQueue.length).to.be.equal(1)
        expect(liquidationQueue[0].status).to.be.equal(LiquidateModelStatus.PENDING)
      })
      it('should cancel the liquidation if income exceeds expenses', async () => {
        const { users, pool, weth, dai, flashLiquidationAdapter, helpersContract } = testEnv

        let liquidationQueue = await LiquidateModel.findAll({ raw: true })
        expect(liquidationQueue.length).to.be.equal(1)
        expect(liquidationQueue[0].status).to.be.equal(LiquidateModelStatus.PENDING)

        const liquidator2 = users[3]
        const borrower = users[1]

        // liquidation by another liquidator from 0.91 to 1.07 hf ------------------------------
        let userReserveDataBefore = await getUserData(
          pool,
          helpersContract,
          dai.address,
          borrower.address
        )
        let amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2).toFixed(0)
        let params = buildFlashLiquidationAdapterParams(
          weth.address,
          dai.address,
          borrower.address,
          amountToLiquidate,
          false
        )
        await pool
          .connect(liquidator2.signer)
          .flashLoan(
            flashLiquidationAdapter.address,
            [dai.address],
            [amountToLiquidate],
            [0],
            borrower.address,
            params,
            0
          )

        await waitForEvent()

        userReserveDataBefore = await getUserData(
          pool,
          helpersContract,
          dai.address,
          borrower.address
        )
        amountToLiquidate = userReserveDataBefore.currentStableDebt.div(2).toFixed(0)
        params = buildFlashLiquidationAdapterParams(
          weth.address,
          dai.address,
          borrower.address,
          amountToLiquidate,
          false
        )
        await pool
          .connect(liquidator2.signer)
          .flashLoan(
            flashLiquidationAdapter.address,
            [dai.address],
            [amountToLiquidate],
            [0],
            borrower.address,
            params,
            0
          )

        await waitForEvent()
        // ------------------------------

        await checkLiquidationQueue()
        liquidationQueue = await LiquidateModel.findAll({ raw: true })
        expect(liquidationQueue.length).to.be.equal(1)
        expect(liquidationQueue[0].status).to.be.equal(LiquidateModelStatus.CANCELLED)
      })
      it('should run the liquidation if it is still profitable', async () => {
        await stopListeners()
        await evmRevert(evmSnapshotId)
        await ListenerModel.destroy({ where: {} })
        await initListeners()
        await depositAndHFBelowOne()
        await monitoringUsers()

        const { users } = testEnv
        const borrower = users[1]

        const borrowerAccount  = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })
        const liquidationPosition = await LiquidateModel.findOne({
          where: {
            userId: borrowerAccount.id, status: LiquidateModelStatus.PENDING
          },
          raw: true
        })

        expect(liquidationPosition).to.be.exist

        await liquidateCheckQueue()
        await delay(15000)

        const liquidationPositionPending = await LiquidateModel.findOne({
          where: {
            userId: borrowerAccount.id, status: LiquidateModelStatus.PENDING
          },
          raw: true
        })

        const liquidationPositionDeffered = await LiquidateModel.findOne({
          where: {
            userId: borrowerAccount.id, status: LiquidateModelStatus.DEFERRED
          },
          raw: true
        })

        const liquidationPositionLiquidated = await LiquidateModel.findOne({
          where: {
            userId: borrowerAccount.id, status: LiquidateModelStatus.LIQUIDATED
          },
          raw: true
        })

        expect(liquidationPositionPending).to.be.equal(null)
        expect(liquidationPositionDeffered).to.be.exist
        expect(liquidationPositionLiquidated).to.be.exist
      })
      it('should roll back the liquidations with the "processing" status when time is up', async () => {
        await stopListeners()
        await evmRevert(evmSnapshotId)
        await ListenerModel.destroy({ where: {} })
        await initListeners()
        await depositAndHFBelowOne()
        await monitoringUsers()

        const { users } = testEnv
        const borrower = users[1]
        const borrowerAccount  = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })


        let liquidationPosition = await LiquidateModel.findOne({
          where: {
            userId: borrowerAccount.id, status: LiquidateModelStatus.PENDING
          },
          raw: true
        })
        expect(liquidationPosition).to.be.exist

        const updateAt = new Date(new Date().getTime() - (35 * 60 * 1000)).toISOString()
        const status = LiquidateModelStatus.PROCESSING

        const sequelize = server.plugins.database.sequelize()
        await sequelize.query(`UPDATE public."Liquidations" SET "status" = '${status}', "updatedAt" = '${updateAt}'::timestamp with time zone WHERE id = ${liquidationPosition.id};`)

        liquidationPosition = await LiquidateModel.findOne({
          where: {
            userId: borrowerAccount.id, status: LiquidateModelStatus.PROCESSING
          },
          raw: true
        })

        expect(liquidationPosition).to.be.exist

        await liquidateCheckQueue()
        await delay(10000)

        liquidationPosition = await LiquidateModel.findOne({
          where: {
            userId: borrowerAccount.id, status: LiquidateModelStatus.PROCESSING
          },
          raw: true
        })
        expect(liquidationPosition).to.be.not.exist
      })
    })
  })
})