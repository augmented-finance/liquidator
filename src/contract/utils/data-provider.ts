import { IReserveConfigurationData } from 'database/Token'
import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import { AbiItem } from 'web3-utils'

import { dataProvider } from '../../config'
import dataProviderAbi from '../../contract/abi/abi-data-provider.json'
import { getWeb3, IContractOptions } from './web3'

interface IReserveTokensAddresses {
  depositTokenAddress: string
  stableDebtTokenAddress: string
  variableDebtTokenAddress: string
}

enum TokenTypes {
  PoolAsset,
  Deposit,
  VariableDebt,
  StableDebt,
  Stake,
  Reward,
  RewardStake,
  HiddenStake
}

type TokenType =
  | TokenTypes.Deposit
  | TokenTypes.HiddenStake
  | TokenTypes.PoolAsset
  | TokenTypes.Reward
  | TokenTypes.RewardStake
  | TokenTypes.StableDebt
  | TokenTypes.Stake
  | TokenTypes.VariableDebt

interface ITokenDescription {
  token: string
  priceToken: string
  rewardPool: string
  tokenSymbol: string
  underlying: string
  decimals: number
  tokenType: TokenType
  active: boolean
  frozen: boolean
}

interface IGetAllTokenDescriptions {
  tokens: ITokenDescription[]
  tokenCount: number
}

export const dataProviderContract = (web3: Web3, network: string): Contract =>
  new web3.eth.Contract(dataProviderAbi as AbiItem[], dataProvider[network])

export const getAllReservesTokens = async (
  options: IContractOptions
): Promise<IGetAllTokenDescriptions> => {
  const web3 = await getWeb3(options.network, options.provider)
  try {
    return dataProviderContract(web3, options.network)
      .methods.getAllTokenDescriptions(true)
      .call()
      .catch((e) => {
        throw new Error(`Error getting getAllReservesTokens, ${e.message}`)
      })
  } catch (e) {
    console.log(e)
  }
}

export const getReserveConfigurationData = async (
  asset: string,
  options: IContractOptions
): Promise<IReserveConfigurationData> => {
  const web3 = await getWeb3(options.network, options.provider)
  return dataProviderContract(web3, options.network)
    .methods.getReserveConfigurationData(asset)
    .call()
    .catch((e) => {
      throw new Error(`Error getting getReserveConfigurationData, ${e.message}`)
    })
}

export const getReserveTokensAddresses = async (
  asset: string,
  options: IContractOptions
): Promise<IReserveTokensAddresses> => {
  const web3 = await getWeb3(options.network, options.provider)
  return dataProviderContract(web3, options.network)
    .methods.getReserveTokensAddresses(asset)
    .call()
    .catch((e) => {
      throw new Error(`Error getting getReserveTokensAddresses, ${e.message}`)
    })
}
