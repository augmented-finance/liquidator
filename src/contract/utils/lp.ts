import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import { AbiItem } from 'web3-utils'
import BigNumber from 'bignumber.js'
import { ethers } from 'ethers'
import pLimit from 'p-limit' // Run multiple promise-returning & async functions with limited concurrency.

import { ListenerModel } from '../../database/Listener'
import lendingPoolAddressAbi from '../../contract/abi/abi-lending-pool.json'
import wethGatewayAddressAbi from '../../contract/abi/abi-weth-gateway.json'

import {
  estimateGas,
  getGasPrice,
  getSignedTransaction,
  getWeb3,
  sendAndWaitRawTx,
  IContractOptions,
  IContractMethodWrite,
  ISendRes
} from './web3'
import { IEvent } from '../utils/event-listener'
import { approve } from './erc20'
import * as config from '../../config'
import { getLendingPoolAddress } from './lp-address-provider'
import chalk from 'chalk'

const buildFlashLiquidationAdapterParams = (
  collateralAsset,
  debtAsset,
  user,
  debtToCover,
  useEthPath
): string => {
  return ethers.utils.defaultAbiCoder.encode(
    ['address', 'address', 'address', 'uint256', 'bool'],
    [collateralAsset, debtAsset, user, debtToCover, useEthPath]
  )
}

interface IUserAccountData {
  totalCollateralETH: string
  totalDebtETH: string
  availableBorrowsETH: string
  currentLiquidationThreshold: string
  ltv: string
  healthFactor: string
}

const reservesList = {} as Record<string, string[]>
interface ILiquidate {
  collateralAsset?: string
  debtAsset?: string
  user?: string
  debtToCover?: string
  receiveAToken?: boolean
}

export const lendingPoolContract = (web3: Web3, contractAddress: string): Contract =>
  new web3.eth.Contract(lendingPoolAddressAbi as AbiItem[], contractAddress)

export const wehtGatewayContract = (web3: Web3, contractAddress: string): Contract =>
  new web3.eth.Contract(wethGatewayAddressAbi as AbiItem[], contractAddress)

export const getUserAccountData = async (
  userAddress: string,
  contractAddress: string,
  options: IContractOptions
): Promise<IUserAccountData> => {
  const { network, provider } = options
  const web3 = await getWeb3(network, provider)
  return lendingPoolContract(web3, contractAddress)
    .methods.getUserAccountData(userAddress)
    .call()
    .catch((e) => {
      throw new Error(`Error getting UserAccountData, ${e.message}`)
    })
}

export const lpGetPastEvents = async (
  contractAddress: string,
  fromBlock,
  options: IContractOptions
): Promise<{ events: IEvent[], currentBlock: number }> => {
  try {
    const { network, provider } = options
    const MAX_BLOCK_COUNT = 1000
    // number of promises run at once
    const CONCURRENCY = 2 // increase the value to speed up listeners initialisation

    const web3 = await getWeb3(network, provider)
    const currentBlock = await web3.eth.getBlockNumber()
    let events = [] as IEvent[]

    let to = Number(fromBlock) + MAX_BLOCK_COUNT
    const map = [
      {
        from: fromBlock,
        to: to < currentBlock ? to : 'latest'
      }
    ]

    while (to < currentBlock) {
      const from = to + 1
      const _to = to + MAX_BLOCK_COUNT
      map.push({
        from,
        to: _to < currentBlock ? _to : 'latest'
      })

      to = _to
    }

    const promises = []
    const limit = pLimit(CONCURRENCY)

    map.forEach((item) => {
      promises.push(
        limit(() => {
          console.log(`${chalk.cyan(`[${options.network}] `)} FETCH FROM ${item.from} TO ${item.to}`)

          // const wethGatewayAddress = '0x4ce180f2960a2dabacb9d9e645a08036a3755a7c';
          // return wehtGatewayContract(web3, wethGatewayAddress).getPastEvents('allEvents', {
          //   fromBlock: item.from,
          //   toBlock: item.to
          // })
          return lendingPoolContract(web3, contractAddress).getPastEvents('allEvents', {
            fromBlock: item.from,
            toBlock: item.to
          })
        })
      )
    })

    events = (await Promise.all(promises)).flat()

    return { events, currentBlock }
  } catch (err) {
    // hint: decrease CONCURRENCY
    // recommended CONCURRENCY for avax and bsc: 20
    console.log(err)
  }
}

export const getReservesList = async (): Promise<Record<string, string[]>> => {
  if (JSON.stringify(reservesList) !== '{}') {
    return reservesList
  }

  const listeners = await ListenerModel.findAll({ raw: true })

  for (const listener of listeners) {
    const web3 = await getWeb3(listener.networkId)
    const list = await lendingPoolContract(web3, listener.contractAddress)
      .methods.getReservesList()
      .call()
      .catch((e) => {
        throw new Error(`Error getting getReservesList, ${e.message}`)
      })

    reservesList[listener.networkId] = list
  }

  return reservesList
}

export const getUserConfiguration = async (
  userAddress: string,
  contractAddress: string,
  options: IContractOptions
): Promise<{ data: number}> => {
  const { network, provider } = options
  const web3 = await getWeb3(network, provider)
  return lendingPoolContract(web3, contractAddress)
    .methods.getUserConfiguration(userAddress)
    .call()
    .catch((e) => {
      throw new Error(`Error getting getUserConfiguration, ${e.message}`)
    })
}

export const liquidate = async (
  data: ILiquidate,
  options: IContractOptions
): Promise<IContractMethodWrite> => {
  const web3 = await getWeb3(options.network, options.provider)
  if (!options.gasPrice) {
    options.gasPrice = await getGasPrice(web3)
  }

  const lpAddress = await getLendingPoolAddress(options)
  const lpContract = await lendingPoolContract(web3, lpAddress)

  const approveInstance = await approve(
    {
      tokenAddress: data.debtAsset,
      recipientAddress: lpAddress,
      amount: data.debtToCover
    },
    options
  )

  return {
    estimate: (): number => {
      const approveGas = approveInstance.estimate()
      return new BigNumber(approveGas).plus(700_000).toNumber()
    },
    send: async (): Promise<ISendRes> => {
      const approveTx = await approveInstance.send()

      const liquidateCallData = await estimateGas(lpContract, 'liquidationCall', [
        data.collateralAsset,
        data.debtAsset,
        data.user,
        data.debtToCover,
        data.receiveAToken
      ])

      const liquidateTx = await getSignedTransaction(web3, {
        to: lpAddress,
        gasLimit: liquidateCallData.gas,
        gasPrice: options.gasPrice,
        data: liquidateCallData.data
      })

      const tx = await sendAndWaitRawTx(web3, liquidateTx.rawTransaction, {
        network: options.network,
        provider: options.provider
      })
      console.log(`💸 [LIQUIDATION_CALL TX]: ${tx.transactionHash}`)

      return {
        fee: new BigNumber(tx.gasUsed).times(options.gasPrice).plus(approveTx.fee).toFixed(),
        txs: [...approveTx.txs, tx]
      }
    }
  }
}

export const flashloanLiquidate = async (
  data: ILiquidate,
  options: IContractOptions
): Promise<IContractMethodWrite> => {
  const web3 = await getWeb3(options.network, options.provider)
  if (!options.gasPrice) {
    options.gasPrice = await getGasPrice(web3)
  }

  const lpAddress = await getLendingPoolAddress(options)
  const lpContract = await lendingPoolContract(web3, lpAddress)

  const params = buildFlashLiquidationAdapterParams(
    data.collateralAsset,
    data.debtAsset,
    data.user,
    data.debtToCover,
    false
  )

  const _flashLoanData = {
    adapterAddress: config.flashloanLiqudationAdapter[options.network],
    assets: [data.debtAsset],
    amounts: [data.debtToCover],
    modes: [0],
    onBehalfOf: '0x0000000000000000000000000000000000000000',
    params,
    referralCode: 0
  }

  const flashLoanData = await estimateGas(lpContract, 'flashLoan', Object.values(_flashLoanData))

  return {
    estimate: (): number => {
      return flashLoanData.gas
    },
    send: async (): Promise<ISendRes> => {
      const flashLiquidatyTx = await getSignedTransaction(web3, {
        to: lpAddress,
        gasLimit: flashLoanData.gas,
        gasPrice: options.gasPrice,
        data: flashLoanData.data
      })

      const tx = await sendAndWaitRawTx(web3, flashLiquidatyTx.rawTransaction, {
        network: options.network,
        provider: options.provider
      })
      console.log(`⚡ [FLAHLOAN_LIQUIDATION TX]: ${tx.transactionHash}`)

      return {
        fee: new BigNumber(tx.gasUsed).times(options.gasPrice).toFixed(),
        txs: [tx]
      }
    }
  }
}
