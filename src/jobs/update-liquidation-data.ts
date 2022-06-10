import { IContractOptions } from '../contract/utils/web3'
import { updateUserAccountData } from '../database/UserAccount'

export default async (data: { userAddress: string, options: IContractOptions }) : Promise<void> => {
  await updateUserAccountData({ userAddress: data.userAddress, network: data.options.network })
}
