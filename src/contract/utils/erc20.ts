import BigNumber from 'bignumber.js'
import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import { AbiItem } from 'web3-utils'

import erc20Abi from '../../contract/abi/abi-erc20.json'
import { estimateGas, getGasPrice, getSignedTransaction, getWeb3, sendAndWaitRawTx, IContractOptions, IContractMethodWrite, ISendRes } from './web3'

export const getErc20Contract = (web3: Web3, contractAddress: string): Contract => new web3.eth.Contract(erc20Abi as AbiItem[], contractAddress)

export const balanceOf = async (userAddress: string, contractAddress: string, options: IContractOptions) : Promise<string | unknown > => {
  const { network, provider, payload } = options
  const web3 = await getWeb3(network, provider)
  const data = await getErc20Contract(web3, contractAddress)
    .methods
    .balanceOf(userAddress)
    .call()
    .catch((e) => {
      throw new Error(`Error getting balanceOf, ${e.message}`)
    })

  if (payload) {
    return { data, payload }
  }

  return data
}

interface IApproveData {
  tokenAddress: string
  recipientAddress: string
  amount: string
}

export const approve = async (data: IApproveData, options: IContractOptions) : Promise<IContractMethodWrite> => {
  const web3 = await getWeb3(options.network, options.provider)
  if (!options.gasPrice) {
    options.gasPrice = await getGasPrice(web3)
  }

  const erc20Contract = getErc20Contract(web3, data.tokenAddress)
  const approveData = await estimateGas(erc20Contract, 'approve', [data.recipientAddress, data.amount])

  return {
    estimate: () : number => {
      return approveData.gas
    },
    send: async (): Promise<ISendRes> => {
      const approveTx = await getSignedTransaction(web3, {
        to: data.tokenAddress,
        gasLimit: approveData.gas,
        gasPrice: options.gasPrice,
        data: approveData.data
      })

      const tx = await sendAndWaitRawTx(web3, approveTx.rawTransaction, { network: options.network, provider: options.provider })
      console.log(`💸 [APPROVE TX]: ${tx.transactionHash}`)

      return {
        fee: new BigNumber(tx.gasUsed).times(options.gasPrice).toFixed(),
        txs: [tx]
      }
    }
  }
}
