import priceOracleAbi from '../../contract/abi/abi-price-oracle.json'
import { getWeb3, IContractOptions } from './web3'
import { getPriceOracleAddress } from './lp-address-provider'
import Contract from 'web3/eth/contract'

export const priceOracleContract = (web3, contractAddress): Contract => new web3.eth.Contract(priceOracleAbi, contractAddress)

export const getAssetPrice = async (assetAddress: string, options: IContractOptions): Promise<{
  assetAddress: string;
  value: string;
}> => {
  const { network, provider } = options
  const contractAddress = await getPriceOracleAddress(options)

  const web3 = await getWeb3(network, provider)
  const data = await priceOracleContract(web3, contractAddress)
    .methods
    .getAssetPrice(assetAddress)
    .call()
    .catch((e) => {
      throw new Error(`Error getting UserAccountData, ${e.message}`)
    })

  return { assetAddress, value: data }
}
