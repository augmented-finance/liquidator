import { tryLiquidate, UserAccountModel } from '../database/UserAccount'
import { LiquidateModel, LiquidateModelStatus } from '../database/Liquidate'
import BigNumber from 'bignumber.js'
import { getGeneralReserveToken } from '../database/Token'
import { getBalance, getWeb3 } from '../contract/utils/web3'

import { account } from '../config'

export default async (userId: string): Promise<void> => {
  let liquidateModel
  try {
    liquidateModel = await LiquidateModel.findOne({
      where: {
        userId: userId,
        status: LiquidateModelStatus.PROCESSING
      },
      include: {
        model: UserAccountModel,
        as: 'user',
        include: ['network'],
        attributes: ['address']

      }
    })

    if (!liquidateModel) return

    const options = {
      network: liquidateModel.user.network.id,
      provider: liquidateModel.user.network.provider
    }

    const web3 = await getWeb3(options.network, options.provider)
    const balanceReserveBeforeETH = (await getGeneralReserveToken(options)).balanceETH
    const balanceNativeBefore = (await getBalance(web3, account.address)) as string

    await tryLiquidate(liquidateModel.user.address, true, options)

    const balanceReserveAfterETH = (await getGeneralReserveToken(options)).balanceETH
    const balanceNativeAfter = (await getBalance(web3, account.address)) as string

    const diffReserveBalance = new BigNumber(balanceReserveAfterETH)
      .minus(balanceReserveBeforeETH)
      .toFixed()
    const diffNativeBalance = new BigNumber(balanceNativeBefore).minus(balanceNativeAfter).toFixed()
    const profitETH = new BigNumber(diffReserveBalance).minus(diffNativeBalance).toFixed()

    await liquidateModel.update({
      status: LiquidateModelStatus.LIQUIDATED,
      factProfitETH: profitETH
    })

    return liquidateModel
  } catch (error) {
    if (liquidateModel) {
      await liquidateModel.update({
        status: LiquidateModelStatus.PENDING
      })
    }
    console.error('[ERROR]: <liquidate>', error)
  }
}
