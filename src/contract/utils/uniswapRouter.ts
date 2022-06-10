import uniswapRouterAbi from '../../contract/abi/abi-uniswap-router.json'
import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import { AbiItem } from 'web3-utils'

import { NetworkModel, networks } from '../../database/Network'
import { estimateGas, getGasPrice, getSignedTransaction, getWeb3, sendAndWaitRawTx, IContractOptions, IContractMethodWrite, ISendRes } from './web3'
import BigNumber from 'bignumber.js'

import { uniswapAddresses } from '../../config'
import { TokenModel, updateTokenBalance } from '../../database/Token'

import * as config from '../../config'
import { approve } from './erc20'

export const getUniswapRouterContract = (web3: Web3, network: networks): Contract => new web3.eth.Contract(uniswapRouterAbi as AbiItem[], uniswapAddresses[network])

interface IGetAmountOut {
  amountIn: string,
  fromToken: string,
  toToken: string
}

interface IGetAmountIn {
  amountOut: string,
  fromToken: string,
  toToken: string
}
interface ISwapTokensForExactTokens {
  amountOut: string,
  amountInMax,
  fromToken: string,
  toToken: string,
  to: string,
  dedline: string, // timestamp
  gasPrice?: string
}

interface ISwapExactTokensForTokens {
  amountIn: string,
  amountOutMin: string,
  fromToken: string,
  toToken: string,
  to: string,
  dedline: string, // timestamp
  gasPrice?: string
}

export enum SwapDirection {
  FORWARD = 'forward',
  BACK = 'back'
}

export const getAmountOut = async (data: IGetAmountOut, options: IContractOptions): Promise<string> => {
  const web3 = await getWeb3(options.network, options.provider)

  return (await getUniswapRouterContract(web3, options.network)
    .methods
    .getAmountsOut(data.amountIn, [data.fromToken, data.toToken])
    .call()
    .catch((e) => {
      throw new Error(`Error getting getAmountsOut, ${e.message}`)
    }))[1]
}

export const getAmountIn = async (data: IGetAmountIn, options: IContractOptions): Promise<string> => {
  const web3 = await getWeb3(options.network, options.provider)

  return (await getUniswapRouterContract(web3, options.network)
    .methods
    .getAmountsIn(data.amountOut, [data.fromToken, data.toToken])
    .call()
    .catch((e) => {
      throw new Error(`Error getting getAmountsOut, ${e.message}`)
    }))[0]
}

export const swapTokensForExactTokens = async (data: ISwapTokensForExactTokens, options: IContractOptions) : Promise<IContractMethodWrite> => {
  const web3 = await getWeb3(options.network, options.provider)
  if (!options.gasPrice) {
    options.gasPrice = await getGasPrice(web3)
  }

  const uniswapRouterContract = await getUniswapRouterContract(web3, options.network)
  return {

    estimate: () : number => {
      return 150_000
    },
    send: async (): Promise<ISendRes> => {
      const swapData = await estimateGas(uniswapRouterContract, 'swapTokensForExactTokens', [
        data.amountOut,
        data.amountInMax,
        [data.fromToken, data.toToken],
        data.to,
        data.dedline
      ])

      const swapTx = await getSignedTransaction(web3, {
        to: uniswapAddresses[options.network],
        gasLimit: swapData.gas,
        gasPrice: data.gasPrice,
        data: swapData.data
      })

      const tx = await sendAndWaitRawTx(web3, swapTx.rawTransaction, options)
      console.log(`💱 [SWAP TX] : ${tx.transactionHash}`)

      return {
        fee: new BigNumber(tx.gasUsed).times(options.gasPrice).toFixed(),
        txs: [tx]
      }
    }
  }
}

export const swapExactTokensForTokens = async (data: ISwapExactTokensForTokens, options: IContractOptions) : Promise<IContractMethodWrite> => {
  const web3 = await getWeb3(options.network, options.provider)
  if (!options.gasPrice) {
    options.gasPrice = await getGasPrice(web3)
  }

  const uniswapRouterContract = await getUniswapRouterContract(web3, options.network)

  return {
    estimate: () : number => {
      return 150_000
    },
    send: async (): Promise<ISendRes> => {
      const swapData = await estimateGas(uniswapRouterContract, 'swapExactTokensForTokens', [
        data.amountIn,
        data.amountOutMin,
        [data.fromToken, data.toToken],
        data.to,
        data.dedline
      ])

      const swapTx = await getSignedTransaction(web3, {
        to: uniswapAddresses[options.network],
        gasLimit: swapData.gas,
        gasPrice: data.gasPrice,
        data: swapData.data
      })

      const tx = await sendAndWaitRawTx(web3, swapTx.rawTransaction, options)
      console.log(`💱 [SWAP TX] : ${tx.transactionHash}`)

      return {
        fee: new BigNumber(tx.gasUsed).times(options.gasPrice).toFixed(),
        txs: [tx]
      }
    }
  }
}

export const swapTokens = async (tokenAddresss: string, amount: string, networkId: networks, direction: SwapDirection) : Promise<IContractMethodWrite> => {
  const network = await NetworkModel.findByPk(networkId)
  const token = await TokenModel.findByPk(tokenAddresss)
  const reserveToken = await TokenModel.findByPk(config.generalReserve[network.id])

  const web3 = await getWeb3(network.id, network.provider)
  const gasPrice = await getGasPrice(web3)

  let amountIn
  let amountOut
  let estimatedAmountIn
  let estimatedAmountOut
  let swapInstance : IContractMethodWrite

  if (direction === SwapDirection.FORWARD) {
    amountOut = amount

    estimatedAmountIn = await getAmountIn({
      amountOut,
      fromToken: reserveToken.tokenAddress,
      toToken: token.tokenAddress
    }, { network: network.id, provider: network.provider })

    if (new BigNumber(estimatedAmountIn).gt(reserveToken.balance)) {
      throw new Error('Insufficient funds')
    }
  } else if (direction === SwapDirection.BACK) {
    amountIn = amount

    estimatedAmountOut = await getAmountOut({
      amountIn,
      fromToken: token.tokenAddress,
      toToken: reserveToken.tokenAddress
    }, { network: network.id, provider: network.provider })
  }

  const approveInstance = await approve({
    tokenAddress: direction === SwapDirection.FORWARD ? reserveToken.tokenAddress : token.tokenAddress,
    recipientAddress: config.uniswapAddresses[network.id],
    amount: direction === SwapDirection.FORWARD ? estimatedAmountIn : amountIn
  }, { network: network.id, provider: network.provider, gasPrice })

  if (direction === SwapDirection.FORWARD) {
    swapInstance = await swapTokensForExactTokens({
      amountOut,
      amountInMax: estimatedAmountIn,
      fromToken: reserveToken.tokenAddress,
      toToken: token.tokenAddress,
      to: config.account.address,
      dedline: (new Date().getTime() + (60 * 20 * 1000)).toString()
    }, { network: network.id, provider: network.provider, gasPrice })
  } else {
    swapInstance = await swapExactTokensForTokens({
      amountIn,
      amountOutMin: estimatedAmountOut,
      fromToken: token.tokenAddress,
      toToken: reserveToken.tokenAddress,
      to: config.account.address,
      dedline: (new Date().getTime() + (60 * 20 * 1000)).toString()
    }, { network: network.id, provider: network.provider, gasPrice })
  }

  return {
    estimate: () : number => {
      const approveGas = approveInstance.estimate()

      return new BigNumber(approveGas).plus(swapInstance.estimate()).toNumber()
    },
    send: async (): Promise<ISendRes> => {
      const approveTx = await approveInstance.send()
      const swapTx = await swapInstance.send()

      await updateTokenBalance(reserveToken.tokenAddress, network.id, network.provider)
      await updateTokenBalance(token.tokenAddress, network.id, network.provider)

      return {
        fee: new BigNumber(approveTx.fee).plus(swapTx.fee).toFixed(),
        txs: [...approveTx.txs, ...swapTx.txs]
      }
    }
  }
}
