import Web3 from 'web3'
import { Contract } from 'web3-eth-contract'
import { AbiItem } from 'web3-utils'
import { lpAddressProvider } from '../../config'
import lendingPoolAddressAbi from '../../contract/abi/abi-lending-pool-address.json'
import { getWeb3, IContractOptions } from './web3'

const priceOracleAddress = {}

export const lendingPoolAddressContract = (web3: Web3, network): Contract => new web3.eth.Contract(lendingPoolAddressAbi as AbiItem[], lpAddressProvider[network])

export const getLendingPoolCoreAddress = async (options: IContractOptions): Promise<string> => {
  const web3 = await getWeb3(options.network)
  return lendingPoolAddressContract(web3, options.network)
    .methods
    .getLendingPoolCore()
    .call()
    .catch((e) => {
      throw new Error(`Error getting LendingPoolCoreAddress, ${e.message}`)
    })
}

export const getLendingPoolAddress = async (options: IContractOptions): Promise<string> => {
  const { network, provider } = options
  const web3 = await getWeb3(network, provider)
  return lendingPoolAddressContract(web3, network)
    .methods
    .getLendingPool()
    .call()
    .catch((e) => {
      throw new Error(`Error getting LendingPoolAddress, ${e.message}`)
    })
}

export const getPriceOracleAddress = async (options: IContractOptions) : Promise<string> => {
  const { network } = options
  if (priceOracleAddress[network]) {
    return priceOracleAddress[network]
  }

  const web3 = await getWeb3(network)
  priceOracleAddress[network] = lendingPoolAddressContract(web3, network)
    .methods
    .getPriceOracle()
    .call()
    .catch((e) => {
      throw new Error(`Error getting getPriceOracle, ${e.message}`)
    })

  return priceOracleAddress[network]
}
