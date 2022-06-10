/*eslint-disable*/
import { createServer } from '../src/server'
import * as config from '../src/config'
import { CreateNetwork, initNetworks, NetworkModel, networks } from '../src/database/Network'
import { fillTokens, swapFromReserveToken, swapToReserveToken, TokenModel } from '../src/database/Token'
import { getAmountIn, getAmountOut, swapTokensForExactTokens } from '../src/contract/utils/uniswapRouter'
import BigNumber from 'bignumber.js'
import { approve } from '../src/contract/utils/erc20'
import { getGasPrice, getWeb3 } from '../src/contract/utils/web3'

jest.setTimeout(300000)

require('dotenv').config()

describe('Uniswap router', () => {
  let server
  let network : NetworkModel
  let tokens : TokenModel[]

  const networkSeed : CreateNetwork = {
    id: networks.KOVAN,
    provider: config.providers.kovan,
    reserveProvider: '',
    balance: '0',
    isActive: true
  }

  const liquidatorAccount = { ...config.account }

  const updateDataFromDB = async () => {
    network = await NetworkModel.findOne({ raw: true, attributes: ['id', 'provider', 'balance'] })
    tokens = await TokenModel.findAll({ raw: true })
  }

  beforeAll(async () => {
    server = await createServer()
    await server.start()

    await initNetworks([networkSeed])
    await fillTokens()

    await updateDataFromDB()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('getAmountsOut | getAmountsIn: should to get the correct token calculation', async () => {
    const amountIn = new BigNumber(1).shiftedBy(18).toFixed(0)
    const weth = tokens.find((t) => t.symbol === 'WETH')
    const dai = tokens.find((t) => t.symbol === 'DAI')

    const resAmountOut = await getAmountOut({
      amountIn,
      fromToken: weth.tokenAddress,
      toToken: dai.tokenAddress
    }, { network: network.id, provider: network.provider })

    const resAmountIn = await getAmountIn({
      amountOut: resAmountOut,
      fromToken: weth.tokenAddress,
      toToken: dai.tokenAddress
    }, { network: network.id, provider: network.provider })

    expect(resAmountIn).toEqual(amountIn)
  })

  test.skip('swapTokensForExactTokens: should to send the transaction correctly and update the balance of native coins after payment of fees', async () => {
    const web3 = await getWeb3(network.id, network.provider)
    const gasPrice = await getGasPrice(web3)

    // swap weth to 100 DAI
    const amountOut = new BigNumber(100).shiftedBy(18).toFixed(0)
    const weth = tokens.find((t) => t.symbol === 'WETH')
    const dai = tokens.find((t) => t.symbol === 'DAI')

    const nativeBalanceBefore = network.balance

    const estimatedAmountIn = await getAmountIn({
      amountOut: amountOut,
      fromToken: weth.tokenAddress,
      toToken: dai.tokenAddress
    }, { network: network.id, provider: network.provider })

    const approveTx = await (await approve({
      tokenAddress: weth.tokenAddress,
      recipientAddress: config.uniswapAddresses.kovan,
      amount: estimatedAmountIn
    }, { network: network.id, provider: network.provider, gasPrice })).send()

    const swapTokensTx = await (await swapTokensForExactTokens({
      amountOut,
      amountInMax: estimatedAmountIn,
      fromToken: weth.tokenAddress,
      toToken: dai.tokenAddress,
      to: liquidatorAccount.address,
      dedline: (new Date().getTime() + (60 * 20 * 1000)).toString(),
      gasPrice
    }, { network: network.id, provider: network.provider })).send()

    const fee = new BigNumber(approveTx.fee).plus(swapTokensTx.fee)

    await updateDataFromDB()

    const nativeBalanceAfter = network.balance
    expect(nativeBalanceAfter).toEqual(new BigNumber(nativeBalanceBefore).minus(fee).toFixed(0))
  })

  test.skip('swapFromReserveToken:', async () => {
    await fillTokens()
    let weth = tokens.find((t) => t.symbol === 'WETH')
    let reserveToken = tokens.find((t) => t.tokenAddress === config.generalReserve[network.id])
    const expectAmount = new BigNumber(0.00001).shiftedBy(weth.decimals).toFixed(0)

    const wethBalanceBefore = weth.balance
    // const reserveBalanceBefore = reserveToken.balance;
    await (await swapFromReserveToken(weth.tokenAddress, expectAmount, { network: network.id })).send()

    await updateDataFromDB()
    weth = tokens.find((t) => t.symbol === 'WETH')
    reserveToken = tokens.find((t) => t.tokenAddress === config.generalReserve[network.id])

    const wethBalanceAfter = weth.balance

    expect(wethBalanceAfter).toEqual(
      new BigNumber(wethBalanceBefore).plus(expectAmount).toFixed(0)
    )
  })

  test.skip('swapToReserveToken:', async () => {
    await fillTokens()

    let weth = tokens.find((t) => t.symbol === 'WETH')
    let reserveToken = tokens.find((t) => t.tokenAddress === config.generalReserve[network.id])
    const amountIn = weth.balance

    const wethBalanceBefore = weth.balance

    if (wethBalanceBefore === '0') throw new Error('Insufficient funds')

    await (await swapToReserveToken(weth.tokenAddress, amountIn, { network: network.id })).send()

    await updateDataFromDB()
    weth = tokens.find((t) => t.symbol === 'WETH')
    reserveToken = tokens.find((t) => t.tokenAddress === config.generalReserve[network.id])

    const wethBalanceAfter = weth.balance

    expect(wethBalanceAfter).toEqual('0')
  })

  test('should swap from reseve then swap same amount to reserve', async () => {
    let weth: TokenModel // the token that needs to be repayed (debtAsset)
    let reserveToken: TokenModel // the token from general reserve

    const updateBalance = async () => {
      await updateDataFromDB()

      weth = tokens.find((t) => t.symbol === 'WETH')
      reserveToken = tokens.find((t) => t.tokenAddress === config.generalReserve[network.id])
    }
    await updateBalance()

    const debtToCover = new BigNumber(0.00001).shiftedBy(weth.decimals).toFixed(0) // needs to repay 0.00001 WETH

    expect(weth.balance).toEqual('0')

    // swap reserve token to debtAsset
    await (await swapFromReserveToken(weth.tokenAddress, debtToCover, { network: network.id })).send()

    await updateBalance()

    expect(weth.balance).toEqual(debtToCover) // 0.00001 WETH

    // return the equivalent amount of the debtAsset back to the general reserve
    await (await swapToReserveToken(weth.tokenAddress, weth.balance, { network: network.id })).send()

    await updateBalance()

    // must be the same as before the operations above
    expect(weth.balance).toEqual('0')
  })
})
