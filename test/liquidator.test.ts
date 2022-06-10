/*eslint-disable*/
import { lpGetPastEvents, getReservesList } from './../src/contract/utils/lp'
import { balanceOf } from './../src/contract/utils/erc20'
import { getAllReservesTokens, getReserveConfigurationData, getReserveTokensAddresses } from './../src/contract/utils/data-provider'
import { createServer } from '../src/server'
import * as config from '../src/config'
import BigNumber from 'bignumber.js'

import { initNetworks, networks, NetworkModel } from '../src/database/Network'
import { fillTokens, getAvailableLiquidity, getGeneralReserveToken, swapFromReserveToken, swapToReserveToken, TokenModel, updateTokenBalance } from '../src/database/Token'

import { DRE, evmRevert, evmSnapshot, increaseTime } from '../protocol/helpers/misc-utils'
import { convertToCurrencyDecimals } from '../protocol/helpers/contracts-helpers'
import { APPROVAL_AMOUNT_LENDING_POOL, oneEther } from '../protocol/helpers/constants'
import { makeSuite, TestEnv } from '../protocol/test-suites/test-augmented/helpers/make-suite'
import { initListeners } from '../src/listener'
import { getListeners } from '../src/database/Listener'
import { ProtocolErrors, RateMode } from '../protocol/helpers/types'
import { getEstimatedLiquidateDataWithMaxRevenue, getUserReserves, tryLiquidate, updateUserAccountData, UserAccountModel } from '../src/database/UserAccount'
import { confirmedBlock } from '../src/listener/handle/collect-users'
import { ContractReceipt } from '@ethersproject/contracts'
import { getBalance, getWeb3, IContractOptions } from '../src/contract/utils/web3'
import { MockUniswapV2Router02 } from '../types'
import { getMockUniswapRouter } from '../protocol/helpers/contracts-getters'
import { getAmountIn, getAmountOut } from '../src/contract/utils/uniswapRouter'
import { parseEther } from '@ethersproject/units'
import { LiquidateModel, LiquidateModelStatus } from '../src/database/Liquidate'

import liquidateCheckQueue from '../src/jobs/sheduler/liquidate-check-queue'
import { createUserSeeds, inactivesNetworksSeeds } from './utils/seeds'
import chalk from 'chalk'

const kill = require('kill-port')
const hre = require('hardhat')
const { expect } = require('chai')
const wallets = require('../protocol/test-wallets')

// Overwriting system variables in config for testing
config.lpAddressProvider.eth = ''
config.dataProvider.eth = ''
config.account.address = ''
config.account.privateKey = wallets.accounts[wallets.accounts.length - 1].secretKey
config.utils.expectProfit = '0.01'
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
    // user 2 deposits 1 ETH
    const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '1')

    // mints WETH to borrower
    await weth.connect(borrower.signer).mint(await convertToCurrencyDecimals(weth.address, '1000'))

    // approve protocol to access the borrower wallet
    await weth.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)

    await pool
      .connect(borrower.signer)
      .deposit(weth.address, amountETHtoDeposit, borrower.address, '0')

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

  const mintGeneralReserve = async () => {
    const { dai, users } = testEnv
    const liquidator = users[users.length - 1]

    await dai.connect(liquidator.signer).mint(await convertToCurrencyDecimals(dai.address, '100000'))
    await updateTokenBalance(dai.address, networks.ETH, PROVIDER_URL)
  }

  const getTokenBalance = async (token, address) => {
    return (await token.balanceOf(address)).toString()
  }

  const convertToken = async (from, to, amount) => {
    const { oracle } = testEnv

    const priceFrom = await oracle.getAssetPrice(from.address)
    const priceTo = await oracle.getAssetPrice(to.address)

    return new BigNumber(amount)
      .shiftedBy(-(await from.decimals()))
      .times(new BigNumber(priceFrom.toString()).shiftedBy(-18))
      .div(new BigNumber(priceTo.toString()).shiftedBy(-18))
      .shiftedBy((await to.decimals()))
      .toFixed(0)
  }

  const liquidateScript = async () => {
    /*

      swap DAI to USDC -> liquidate -> swap WETH to DAI

      1 USDC = 0.0013 ETH
      1 DAI = 0.001 ETH
      1 WETH = 1 ETH

      borrower depostis: 1 DAI, 1 WETH
      borrower debts: 700 USDC

      expected collateral: WETH
      expected cover debt: 350 USDC

      expected liquidation bonus: 22.75 DAI (liquidation bonus: 5%)

    */

    const { dai, usdc, weth, users, pool, oracle } = testEnv

    const daiDecimals = await dai.decimals()
    const wethDecimals = await weth.decimals()
    const usdcDecimals = await usdc.decimals()

    const _wethPrice = new BigNumber(1).shiftedBy(18).toFixed(0)
    const _daiPrice = new BigNumber(0.001).shiftedBy(18).toFixed(0)
    const _usdcPrice = new BigNumber(0.001).shiftedBy(18).toFixed(0)

    await oracle.setAssetPrice(weth.address, _wethPrice)
    await oracle.setAssetPrice(dai.address, _daiPrice)
    await oracle.setAssetPrice(usdc.address, _usdcPrice)

    const depositor = users[0]
    const borrower = users[1]

    const depositorAmountDaiBN = await convertToCurrencyDecimals(dai.address, '100000')
    const depositerAmountUsdcBN = await convertToCurrencyDecimals(usdc.address, '100000')
    const depositerAmountWethBN = await convertToCurrencyDecimals(weth.address, '1000')

    const borrowerAmountDaiBN = await convertToCurrencyDecimals(dai.address, '1')
    const borrowerAmountWethBN = await convertToCurrencyDecimals(weth.address, '1')

    //  depositer provide liquidity: 1000 DAI | 1000 USDC | 1000 WETH
    await dai.connect(depositor.signer).mint(depositorAmountDaiBN)
    await dai.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
    await pool
      .connect(depositor.signer)
      .deposit(dai.address, depositorAmountDaiBN, depositor.address, '0')

    await weth.connect(depositor.signer).mint(depositerAmountWethBN)
    await weth.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
    await pool
      .connect(depositor.signer)
      .deposit(weth.address, depositerAmountWethBN, depositor.address, '0')

    await usdc.connect(depositor.signer).mint(depositerAmountUsdcBN)
    await usdc.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
    await pool
      .connect(depositor.signer)
      .deposit(usdc.address, depositerAmountUsdcBN, depositor.address, '0')
    // ------------------------

    // borrower provider liquidity: 1 DAI | 1 WETH
    await weth.connect(borrower.signer).mint(borrowerAmountWethBN)
    await weth.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
    await pool
      .connect(borrower.signer)
      .deposit(weth.address, borrowerAmountWethBN, borrower.address, '0')

    await dai.connect(borrower.signer).mint(borrowerAmountDaiBN)
    await dai.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
    await pool
      .connect(borrower.signer)
      .deposit(dai.address, borrowerAmountDaiBN, borrower.address, '0')
    // ------------------------

    // borrow
    const amountUsdcToBorrow = await convertToCurrencyDecimals(usdc.address, '700')

    await pool
      .connect(borrower.signer)
      .borrow(usdc.address, amountUsdcToBorrow, RateMode.Stable, '0', borrower.address)

    await oracle.setAssetPrice(usdc.address, new BigNumber(_usdcPrice).times(1.3).toFixed(0)) // grow 30 %

    const userGlobalDataAfter = await pool.getUserAccountData(borrower.address)

    expect(userGlobalDataAfter.healthFactor.toString()).to.be.bignumber.lt(
      oneEther.toFixed(0),
      INVALID_HF
    )
    // -----------------------

    const _borrowerReserves = await getUserReserves(borrower.address, networks.ETH)
    const _liquidationData = await getEstimatedLiquidateDataWithMaxRevenue(_borrowerReserves)

    const daiPrice = await oracle.getAssetPrice(dai.address)
    const wethPrice = await oracle.getAssetPrice(weth.address)
    const usdcPrice = await oracle.getAssetPrice(usdc.address)

    if (_liquidationData) {
      // swap tokens FROM resserve. setup uniswap mock
      const debtToCoverDai = new BigNumber(_liquidationData.debtToCover) // 350 USDC -> 455 DAI
        .shiftedBy(-usdcDecimals)
        .times(new BigNumber(usdcPrice.toString()).shiftedBy(-18))
        .div(new BigNumber(daiPrice.toString()).shiftedBy(-18)).toFixed()

      const debtToCoverDaiBN = await convertToCurrencyDecimals(dai.address, debtToCoverDai)
      const debtToCoverUsdcBN = await convertToCurrencyDecimals(usdc.address, new BigNumber(_liquidationData.debtToCover).shiftedBy(-usdcDecimals).toFixed())

      await mockUniswapRouter.setAmountIn(new BigNumber(debtToCoverUsdcBN.toString()).plus(2).toFixed(0), dai.address, usdc.address, debtToCoverDaiBN)
      await mockUniswapRouter.setAmountToSwap(dai.address, debtToCoverDaiBN.toString())

      // swap tokens TO resserve. setup uniswap mock
      const expectedWethbalance = '0.47775000273' // magic number. the debt will grow by 0.00000000273 WETH
      const expectedWethbalanceBN = await convertToCurrencyDecimals(weth.address, expectedWethbalance)
      const amountOutDai = new BigNumber(expectedWethbalance) // 0.47775 WETH -> 477.75 DAI
        .times(new BigNumber(wethPrice.toString()).shiftedBy(-wethDecimals))
        .div(new BigNumber(daiPrice.toString()).shiftedBy(-daiDecimals))
        .toFixed()
      const amountOutDaiBN = await convertToCurrencyDecimals(dai.address, amountOutDai)

      await mockUniswapRouter.setAmountOut(expectedWethbalanceBN, weth.address, dai.address, amountOutDaiBN)
      await mockUniswapRouter.setAmountToReturn(weth.address, amountOutDaiBN.toString())
    }
  }

  before(async () => {
    server = await createServer()
    await server.start()

    // create AVAX and BSC inactive networks
    const inactiveNetworks = inactivesNetworksSeeds.map((network) => network.id)
    await NetworkModel.bulkCreate(inactivesNetworksSeeds)

    await UserAccountModel.bulkCreate(createUserSeeds(inactiveNetworks, testEnv.users))

    try {
      hre.run('node')
      await hre.network.provider.send('hardhat_setLoggingEnabled', [false])
      await new Promise(resolve => setTimeout(resolve, 5000))
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
  })

  after(async () => {
    // await server.stop();
    // await kill(8545, 'tcp');
  })

  beforeEach(async () => {
    evmSnapshotId = await evmSnapshot()
  })

  afterEach(async () => {
    await evmRevert(evmSnapshotId)
  })

  describe('Setup', () => {
    describe('Networks', () => {
      it('should init available networks', async () => {
        await initNetworks()

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
        await fillTokens()

        const tokens = await TokenModel.findAll({ raw: true })
        expect(tokens).to.be.an('array')
        expect(tokens).to.not.be.empty
      })

      it('should correctly return actual protocol reserve', async () => {
        const { dai, users, pool } = testEnv
        const token = await TokenModel.findOne({ where: { symbol: 'DAI' } })
        const tokenDecimal = token.decimals
        const amount = '1000'
        const reserveBefore = '0'

        let reserve = await getAvailableLiquidity(token.tokenAddress)
        expect(reserve).to.be.eql({
          tokenAddress: token.tokenAddress,
          value: reserveBefore
        })

        const depositor = users[0]
        await dai.connect(depositor.signer).mint(await convertToCurrencyDecimals(dai.address, amount))
        await dai.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
        const amountDAItoDeposit = await convertToCurrencyDecimals(dai.address, amount)

        await pool
          .connect(depositor.signer)
          .deposit(dai.address, amountDAItoDeposit, depositor.address, amount)

        reserve = await getAvailableLiquidity(token.tokenAddress)
        expect(reserve).to.be.eql({
          tokenAddress: token.tokenAddress,
          value: new BigNumber(amount).shiftedBy(tokenDecimal).toFixed(0)
        })
      })
    })

    describe('Listeners', () => {
      before(async () => {
        await initListeners()
      })

      const processEvents = async (receipt: ContractReceipt, eventName: string) => {
        const event : any = { ...(receipt.events?.filter((x) => { return x.event == eventName }))[0] }
        event.contract = 'eth.lending-pool'
        await confirmedBlock(networks.ETH)(event.blockNumber, [event], () => {})
      }

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
        const { dai, weth, users, pool, oracle } = testEnv
        const depositAmount = '1000'

        const depositor = users[0]
        const borrower = users[1]

        await dai.connect(depositor.signer).mint(await convertToCurrencyDecimals(dai.address, depositAmount))
        await dai.connect(depositor.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
        const amountDAItoDeposit = await convertToCurrencyDecimals(dai.address, depositAmount)

        let receipt : ContractReceipt = await (await pool
          .connect(depositor.signer)
          .deposit(dai.address, amountDAItoDeposit, depositor.address, depositAmount)).wait()

        await processEvents(receipt, 'Deposit')

        const amountETHtoDeposit = await convertToCurrencyDecimals(weth.address, '1')
        await weth.connect(borrower.signer).mint(await convertToCurrencyDecimals(weth.address, '1000'))
        await weth.connect(borrower.signer).approve(pool.address, APPROVAL_AMOUNT_LENDING_POOL)
        receipt = await (await pool
          .connect(borrower.signer)
          .deposit(weth.address, amountETHtoDeposit, borrower.address, '0')).wait()

        await processEvents(receipt, 'Deposit')

        const depositerAccount = await UserAccountModel.findOne({ where: { address: depositor.address, networkId: networks.ETH }, raw: true })
        expect(depositerAccount.healthFactor).to.be.equal(-1)

        let borrowerAccount = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })
        expect(borrowerAccount.healthFactor).to.be.equal(-1)

        const daiPrice = await oracle.getAssetPrice(dai.address)
        const amountDAIToBorrow = await convertToCurrencyDecimals(
          dai.address,
          new BigNumber(borrowerAccount.availableBorrowsETH.toString())
            .div(daiPrice.toString())
            .multipliedBy(0.95)
            .toFixed(0)
        )

        receipt = await (await pool
          .connect(borrower.signer)
          .borrow(dai.address, amountDAIToBorrow, RateMode.Stable, '0', borrower.address)).wait()

        await processEvents(receipt, 'Borrow')

        borrowerAccount = await UserAccountModel.findOne({ where: { address: borrower.address, networkId: networks.ETH }, raw: true })
        expect(borrowerAccount.healthFactor).to.be.not.equal(-1)
      })
    })
  })

  describe('UserAccount methods', () => {
    it('Get user reserves', async () => {
      const { dai, weth, users, oracle } = testEnv
      const borrower = users[1]
      // borrower deposeted 1 WETH and borrow 95% of available in DAI
      await depositAndHFBelowOne()
      await increaseTime(100)

      const borrowerReserves = await getUserReserves(borrower.address, networks.ETH)

      expect(borrowerReserves.collateral.WETH).to.be.exist
      expect(borrowerReserves.debt.DAI).to.be.exist

      expect(borrowerReserves.collateral.WETH.contractAddress).to.be.equal(weth.address)
      expect(borrowerReserves.debt.DAI.contractAddress).to.be.equal(dai.address)

      expect(borrowerReserves.collateral.WETH.amount).to.be.equal(new BigNumber(1).shiftedBy(18).toFixed(0))
      expect(borrowerReserves.collateral.WETH.amountETH).to.be.equal(new BigNumber(1).shiftedBy(18).toFixed(0))
      expect(borrowerReserves.collateral.WETH.rate).to.be.equal(new BigNumber(1).shiftedBy(18).toFixed(0))

      const daiPrice = (await oracle.getAssetPrice(dai.address)).toString()
      const daiDecimals = await dai.decimals()
      expect(borrowerReserves.debt.DAI.decimal).to.be.equal(daiDecimals)
      expect(borrowerReserves.debt.DAI.rate).to.be.equal(daiPrice)
      expect(borrowerReserves.debt.DAI.amountETH).to.be.equal(
        new BigNumber(borrowerReserves.debt.DAI.amount)
          .shiftedBy(-daiDecimals)
          .times(new BigNumber(daiPrice).shiftedBy(-18))
          .shiftedBy(18).toFixed(0)
      )
    })
  })

  describe('Uniswap', () => {
    const { dai, weth, users } = testEnv

    const wethAmount = '1'
    const daiAmount = '1000'

    const wethAmountWei = new BigNumber(wethAmount).shiftedBy(18).toFixed(0)
    const daiAmountWei = new BigNumber(daiAmount).shiftedBy(18).toFixed(0)

    const wethAmountBN = parseEther(wethAmount)
    const daiAmountBN = parseEther(daiAmount)

    const getTokenBalance = async (token, address) => {
      return (await token.balanceOf(address)).toString()
    }

    before(async () => {
      const { dai, weth } = testEnv

      await mockUniswapRouter.setAmountIn(wethAmountBN, dai.address, weth.address, daiAmountBN)
      await mockUniswapRouter.setAmountOut(wethAmountBN, weth.address, dai.address, daiAmountBN)
    })

    it('getAmountIn', async () => {
      const { dai, weth } = testEnv

      const amountIn = await getAmountIn({
        amountOut: wethAmountWei,
        fromToken: dai.address,
        toToken: weth.address
      }, options)

      expect(amountIn).to.be.equal(daiAmountWei)
    })

    it('getAmountOut', async () => {
      const { dai, weth } = testEnv

      const amountOut = await getAmountOut({
        amountIn: wethAmountWei,
        fromToken: weth.address,
        toToken: dai.address
      }, options)

      expect(amountOut).to.be.equal(daiAmountWei)
    })

    it('swapFromReserve: 1000 DAI -> 1 WETH', async () => {
      await mintGeneralReserve()

      const { dai, weth, users } = testEnv
      const liquidator = users[users.length - 1]

      const amountIn = await getAmountIn({
        amountOut: wethAmountWei,
        fromToken: dai.address,
        toToken: weth.address
      }, options)

      const reserveBalanceBefore = await getTokenBalance(dai, liquidator.address)
      const wethBalanceBefore = await getTokenBalance(weth, liquidator.address)

      await mockUniswapRouter.setAmountToSwap(dai.address, daiAmountWei)
      await (await swapFromReserveToken(weth.address, wethAmountWei, options)).send()

      const reserveBalanceAfter = await getTokenBalance(dai, liquidator.address)
      const wethBalanceAfter = await getTokenBalance(weth, liquidator.address)

      expect(wethBalanceAfter).equal(
        new BigNumber(wethBalanceBefore).plus(wethAmountWei).toFixed(0)
      )
      expect(reserveBalanceAfter).equal(
        new BigNumber(reserveBalanceBefore).minus(amountIn).toFixed(0)
      )
    })

    it('swapToReserve: 1 WETH -> 1000 DAI', async () => {
      const { dai, weth, users } = testEnv
      const liquidator = users[users.length - 1]

      // mint 1 WETH
      await weth.connect(liquidator.signer).mint(await convertToCurrencyDecimals(dai.address, wethAmount))
      await updateTokenBalance(weth.address, networks.ETH, PROVIDER_URL)

      const amountOut = await getAmountOut({
        amountIn: wethAmountWei,
        fromToken: weth.address,
        toToken: dai.address
      }, options)

      const reserveBalanceBefore = await getTokenBalance(dai, liquidator.address)
      const wethBalanceBefore = await getTokenBalance(weth, liquidator.address)

      await mockUniswapRouter.setAmountToReturn(weth.address, amountOut)
      await (await swapToReserveToken(weth.address, wethAmountWei, options)).send()

      const reserveBalanceAfter = await getTokenBalance(dai, liquidator.address)
      const wethBalanceAfter = await getTokenBalance(weth, liquidator.address)

      expect(reserveBalanceAfter).equal(
        new BigNumber(reserveBalanceBefore).plus(amountOut).toFixed(0)
      )

      expect(wethBalanceAfter).equal(
        new BigNumber(wethBalanceBefore).minus(wethAmountWei).toFixed(0)
      )
    })
  })

  describe('Liquidiation', () => {
    beforeEach(async () => {

    })
    afterEach(async () => {
      await LiquidateModel.destroy({ where: {} })
    })

    it('tryLiquidate: should correctly calculate the estimated and fact fees (own liquidity)', async () => {
      await mintGeneralReserve()
      const { users, dai, weth, usdc, oracle } = testEnv

      await liquidateScript()

      const borrower = users[1]
      const liquidator = users[users.length - 1]

      const web3 = await getWeb3(options.network, options.provider)
      const nativeBalanceBefore = await getBalance(web3, liquidator.address)

      const estimate = await tryLiquidate(borrower.address, false, options)

      expect(estimate.maxRevenueETH).to.be.bignumber.gt('0')
      expect(estimate.feeEstimated).to.be.bignumber.gt('0')
      expect(estimate.feeFact).to.be.equal('0')
      expect(estimate.txs.length).to.be.equal(0)

      const result = await tryLiquidate(borrower.address, true, options)

      const gasUsed = result.txs.map((tx) => tx.gasUsed).reduce((prev, curr) => prev + curr)
      const fee = new BigNumber(gasUsed).times(result.gasPrice).toFixed()

      expect(result.feeFact).to.be.equal(fee)
      expect(result.feeFact).to.be.bignumber.lte(result.feeEstimated)

      /*
        1. approve tokens for swap from reserve
        2. swap tokens from reserve
        3. approve tokens for liquidate
        4. liquidate
        5. approve tokens for swap to reserve
        6. swap tokens to reserve
        => should be 6 txs
      */
      expect(result.txs.length).to.be.equal(6)

      const nativeBalanceAfter = await getBalance(web3, liquidator.address)
      expect(nativeBalanceAfter).to.be.equal(
        new BigNumber(nativeBalanceBefore).minus(result.feeFact).toFixed()
      )

      const wethBalance = await getTokenBalance(weth, liquidator.address)
      const usdcBalance = await getTokenBalance(usdc, liquidator.address)

      expect(wethBalance).to.be.equal('0')
      expect(usdcBalance).to.be.equal('0')
    })

    it('tryLiquidate: should correctly calculate the estimated and fact fees (flashloan)', async () => {
      const { users, dai, weth, usdc } = testEnv

      await updateTokenBalance(dai.address, options.network, options.provider)
      await updateTokenBalance(weth.address, options.network, options.provider)
      await updateTokenBalance(usdc.address, options.network, options.provider)

      await liquidateScript()

      const borrower = users[1]
      const liquidator = users[users.length - 1]

      const web3 = await getWeb3(options.network, options.provider)
      const nativeBalanceBefore = await getBalance(web3, liquidator.address)

      const estimate = await tryLiquidate(borrower.address, false, options)

      expect(estimate.maxRevenueETH).to.be.bignumber.gt('0')
      expect(estimate.feeEstimated).to.be.bignumber.gt('0')
      expect(estimate.feeFact).to.be.equal('0')
      expect(estimate.txs.length).to.be.equal(0)

      estimate.liquidateData.debtToCover = new BigNumber(estimate.liquidateData.debtToCover).plus(2).toFixed() // note: correction debt

      const flashLoanDebt = new BigNumber(estimate.liquidateData.debtToCover) // -> USDC
        .multipliedBy(1.0009)
        .toFixed(0)

      const swapToDebtAssetFL = await convertToken(usdc, weth, flashLoanDebt) // =>  WETH
      await mockUniswapRouter.setAmountToSwap(estimate.liquidateData.collateralAsset, swapToDebtAssetFL) // swap to repay flashloaan

      const expectCollateralWithoutBonus = await convertToken(usdc, weth, estimate.liquidateData.debtToCover)
      const expectCollateralWithBonus = new BigNumber(expectCollateralWithoutBonus).times(1.05).toFixed()
      const expectCollateralAfterRepayFL = new BigNumber(expectCollateralWithBonus).minus(swapToDebtAssetFL).toFixed()
      const expectProfitInReserveToekn = await convertToken(weth, dai, expectCollateralAfterRepayFL)
      await mockUniswapRouter.setAmountToReturn(weth.address, expectProfitInReserveToekn)

      const result = await tryLiquidate(borrower.address, true, options)

      const daiBalance = await getTokenBalance(dai, liquidator.address)
      const wethBalance = await getTokenBalance(weth, liquidator.address)
      const usdcBalance = await getTokenBalance(usdc, liquidator.address)

      expect(daiBalance).to.be.equal(expectProfitInReserveToekn)
      expect(wethBalance).to.be.equal('0')
      expect(usdcBalance).to.be.equal('0')

      const gasUsed = result.txs.map((tx) => tx.gasUsed).reduce((prev, curr) => prev + curr)
      const fee = new BigNumber(gasUsed).times(result.gasPrice).toFixed()

      expect(result.feeFact).to.be.equal(fee)
      expect(result.feeFact).to.be.bignumber.lte(result.feeEstimated)

      /*
        1. flashloan liquidation
        2. approve tokens for swap to reserve
        3. swap tokens to reserve
        => should be 3 txs
      */
      expect(result.txs.length).to.be.equal(3)

      const nativeBalanceAfter = await getBalance(web3, liquidator.address)
      expect(nativeBalanceAfter).to.be.equal(
        new BigNumber(nativeBalanceBefore).minus(result.feeFact).toFixed()
      )
    })

    it('liquidate with own liquidity', async () => {
      const { dai, weth, usdc, users, oracle } = testEnv

      await mintGeneralReserve() // add liquidity to liquidator reserve (100 000 DAI)
      await updateTokenBalance(dai.address, options.network, options.provider)

      await liquidateScript() // DEBT: 700 USDC | COLLATERAL: WETH
      const daiDecimals = await dai.decimals()
      const usdcDecimals = await usdc.decimals()
      const daiPrice = await oracle.getAssetPrice(dai.address)
      const usdcPrice = await oracle.getAssetPrice(usdc.address)

      // users
      const liquidator = users[users.length - 1]
      const borrower = users[1]

      // check balances before
      const balanceDaiBefore = await getTokenBalance(dai, liquidator.address)
      const balanceNativeBefore = await getBalance(web3, liquidator.address)

      // fix the borrower in db
      await updateUserAccountData({ userAddress: borrower.address, network: options.network })

      // the borrower must get into the queue for liquidation
      let activeLiquidateList = await LiquidateModel.findAll({ raw: true })
      expect(activeLiquidateList.length).to.be.equal(1)
      expect(activeLiquidateList[0].status).to.be.equal(LiquidateModelStatus.PENDING)

      const userInLiquidationQueue = await UserAccountModel.findByPk(activeLiquidateList[0].userId, { raw: true })
      expect(userInLiquidationQueue.address).to.be.equal(borrower.address)

      // simulation of monitoring liquidate list job
      await liquidateCheckQueue() // should liquidate position from 0.9 HF to 0.94 HF
      activeLiquidateList = await LiquidateModel.findAll({ raw: true })
      console.log('🤑 PROFIT: ', new BigNumber(activeLiquidateList[0].factProfitETH).shiftedBy(-18).toFixed(), 'ETH')

      expect(activeLiquidateList.length).to.be.equal(2)
      expect(activeLiquidateList[0].status).to.be.equal(LiquidateModelStatus.LIQUIDATED)
      expect(activeLiquidateList[1].status).to.be.equal(LiquidateModelStatus.DEFERRED) // estimated profit less then in configuration -> deferred status
      expect(activeLiquidateList[1].toUpdateDate).to.be.exist
      expect(activeLiquidateList[1].estimatedProfitETH).to.be.bignumber.lt(
        new BigNumber(config.utils.expectProfit).shiftedBy(18).toFixed()
      )

      // check balances after
      const balanceDaiAfter = await getTokenBalance(dai, liquidator.address)
      const balanceNativeAfter = await getBalance(web3, liquidator.address)

      const reserveBalance = await getGeneralReserveToken(options)
      expect(balanceDaiAfter).to.be.equal(reserveBalance.balance) // should correct update balance of reserve token in DB

      const diffDaiBalance = new BigNumber(balanceDaiAfter).minus(balanceDaiBefore).toFixed() // revenue (DAI)
      const deffDaiBalanceETH = await convertToken(dai, weth, diffDaiBalance) // revenue (ETH) 1 weth = 1 eth
      const diffNativeBalance = new BigNumber(balanceNativeBefore).minus(balanceNativeAfter).toFixed() // expenses (ETH)
      const profitETH = new BigNumber(deffDaiBalanceETH).minus(diffNativeBalance).toFixed()

      expect(profitETH).to.be.bignumber.gte(new BigNumber(config.utils.expectProfit).shiftedBy(18).toFixed())
      expect(profitETH).to.be.bignumber.equal(activeLiquidateList[0].factProfitETH)

      // check the tokens participating in the liquidation - should be zero balances
      const balanceWethAfter = await getTokenBalance(weth, liquidator.address)
      const balanceUsdcAfter = await getTokenBalance(usdc, liquidator.address)
      expect(balanceWethAfter).to.be.equal('0')
      expect(balanceUsdcAfter).to.be.equal('0')

      // check the expected balance after and the real one
      const expectBalanceAfterFixed = new BigNumber(balanceDaiAfter).shiftedBy(-daiDecimals).toFixed(4, 1)
      const balanceBeforeFixed = new BigNumber(balanceDaiBefore).shiftedBy(-daiDecimals).toFixed(4, 1)
      const userReserves = await getUserReserves(borrower.address, networks.ETH)
      expect(expectBalanceAfterFixed).to.be.equal( // expect balance before + liquidation bonus
        new BigNumber(balanceBeforeFixed)
          .plus(
            new BigNumber(new BigNumber(userReserves.debt.USDC.amount).shiftedBy(-usdcDecimals).toFixed(0))
              .times(new BigNumber(usdcPrice.toString()).shiftedBy(-18))
              .div(new BigNumber(daiPrice.toString()).shiftedBy(-18))
              .times(new BigNumber(userReserves.debt.USDC.liquidationBonus).shiftedBy(-4).minus(1)).toFixed()
          )
          .toFixed(4, 1)
      )
    })

    it('liquidate with flashloan', async () => {
      const { dai, weth, usdc, users, oracle } = testEnv

      await updateTokenBalance(dai.address, options.network, options.provider) // should be zero

      await liquidateScript() // DEBT: 700 USDC | COLLATERAL: WETH

      // users
      const liquidator = users[users.length - 1]
      const borrower = users[1]

      // check balances before
      const balanceDaiBefore = await getTokenBalance(dai, liquidator.address)
      const balanceNativeBefore = await getBalance(web3, liquidator.address)

      // fix the borrower in db
      await updateUserAccountData({ userAddress: borrower.address, network: options.network })

      // the borrower must get into the queue for liquidation
      let activeLiquidateList = await LiquidateModel.findAll({ raw: true })
      expect(activeLiquidateList.length).to.be.equal(1)
      expect(activeLiquidateList[0].status).to.be.equal(LiquidateModelStatus.PENDING)

      const userInLiquidationQueue = await UserAccountModel.findByPk(activeLiquidateList[0].userId, { raw: true })
      expect(userInLiquidationQueue.address).to.be.equal(borrower.address)

      const estimate = await tryLiquidate(borrower.address, false, options)

      estimate.liquidateData.debtToCover = new BigNumber(estimate.liquidateData.debtToCover).plus(2).toFixed() // note: correction debt
      const flashLoanDebt = new BigNumber(estimate.liquidateData.debtToCover) // -> USDC
        .multipliedBy(1.0009)
        .toFixed(0)

      const swapToDebtAssetFL = await convertToken(usdc, weth, flashLoanDebt) // =>  WETH
      await mockUniswapRouter.setAmountToSwap(estimate.liquidateData.collateralAsset, swapToDebtAssetFL) // swap to repay flashloaan

      const expectCollateralWithoutBonus = await convertToken(usdc, weth, estimate.liquidateData.debtToCover)
      const expectCollateralWithBonus = new BigNumber(expectCollateralWithoutBonus).times(1.05).toFixed()
      const expectCollateralAfterRepayFL = new BigNumber(expectCollateralWithBonus).minus(swapToDebtAssetFL).toFixed()
      const expectProfitInReserveToekn = await convertToken(weth, dai, expectCollateralAfterRepayFL)
      await mockUniswapRouter.setAmountToReturn(weth.address, expectProfitInReserveToekn)

      await liquidateCheckQueue() // should liquidate position from 0.9 HF to 0.94 HF

      activeLiquidateList = await LiquidateModel.findAll({ raw: true })
      console.log('🤑 PROFIT: ', new BigNumber(activeLiquidateList[0].factProfitETH).shiftedBy(-18).toFixed(), 'ETH')

      // check balances after
      const balanceDaiAfter = await getTokenBalance(dai, liquidator.address)
      const balanceNativeAfter = await getBalance(web3, liquidator.address)

      const reserveBalance = await getGeneralReserveToken(options)
      expect(balanceDaiAfter).to.be.equal(reserveBalance.balance) // should correct update balance of reserve token in DB

      const diffDaiBalance = new BigNumber(balanceDaiAfter).minus(balanceDaiBefore).toFixed() // revenue (DAI)
      const deffDaiBalanceETH = await convertToken(dai, weth, diffDaiBalance) // revenue (ETH) 1 weth = 1 eth
      const diffNativeBalance = new BigNumber(balanceNativeBefore).minus(balanceNativeAfter).toFixed() // expenses (ETH)
      const profitETH = new BigNumber(deffDaiBalanceETH).minus(diffNativeBalance).toFixed()

      expect(profitETH).to.be.bignumber.gte(new BigNumber(config.utils.expectProfit).shiftedBy(18).toFixed())
      expect(profitETH).to.be.bignumber.equal(activeLiquidateList[0].factProfitETH)

      // check the tokens participating in the liquidation - should be zero balances
      const balanceWethAfter = await getTokenBalance(weth, liquidator.address)
      const balanceUsdcAfter = await getTokenBalance(usdc, liquidator.address)
      expect(balanceWethAfter).to.be.equal('0')
      expect(balanceUsdcAfter).to.be.equal('0')
    })
  })

  describe('Methods', () => {
    let options : IContractOptions

    before(async () => {
      const activeNetwork = await NetworkModel.findByPk( networks.ETH, {raw: true, attributes: ['id', 'provider'] })
      options = {
        network: activeNetwork.id,
        provider: activeNetwork.provider
      }
    })

    describe('Reserve', () => {
      it('should return reserves token list', async () => {
        const tokens = await getAllReservesTokens(options)
        expect(tokens).to.be.an('object')
      })

      it('should return reserve configuration data', async () => {
        const tokens = (await getAllReservesTokens(options)).tokens
        const data = await getReserveConfigurationData(tokens[0].token, options)
        expect(data).to.be.an('object')
      })

      it('should return reserve token addresses', async () => {
        const tokens = (await getAllReservesTokens(options)).tokens
        const data = await getReserveTokensAddresses(tokens[0].token, options)
        expect(data).to.be.an('object')
      })
    })

    describe('erc20', () => {
      it('should return DAI balance', async () => {
        const token = await TokenModel.findOne({ where: { symbol: 'DAI' } })
        const balance = await balanceOf(token.aTokenAddress, token.tokenAddress, options)
        expect(balance).to.be.a('string')
        expect(balance).to.be.eql('0')
      })
    })

    describe('lending pool', () => {
      it('should return past events', async () => {
        const listener = (await getListeners('lending-pool'))[0]
        const pastEvents = await lpGetPastEvents(listener.contractAddress, listener.lastBlock, { network: listener.network.id, provider: listener.network.provider })
        expect(pastEvents.events).to.be.an('array')
        expect(pastEvents.currentBlock).to.be.a('number')
      })

      it('should return reserves', async () => {
        const reserves = await getReservesList()
        expect(reserves.eth).to.be.an('array')
      })
    })
  })
})
