import BigNumber from 'bignumber.js'
import { IContractOptions } from 'contract/utils/web3'
import {
  Column,
  Model,
  Table,
  DataType,
  CreatedAt,
  UpdatedAt,
  ForeignKey,
  BelongsTo,
  PrimaryKey,
  AutoIncrement,
  AllowNull
} from 'sequelize-typescript'
import { tryLiquidate, updateUserAccountData, UserAccountModel } from './UserAccount'

import * as config from '../config'
import { addJob } from '../jobs/utils'
import { Op } from 'sequelize'
import { TokenModel } from './Token'
import { getAssetPrice } from '../contract/utils/price-oracle'

export enum LiquidateModelStatus {
  LIQUIDATED = 'liquidated',
  PROCESSING = 'processing',
  PENDING = 'pending',

  DEFERRED = 'deferred',

  CANCELLED = 'cancelled',
  ERROR = 'error'
}

export interface LiquidateDto {
  id: number,
  userId: string,
  status: LiquidateModelStatus,
  estimatedProfitETH: string,
  factProfitETH: string,
  toUpdateDate?: Date,
  error?: string
}

export type CreateLiquidate = Omit<LiquidateDto, 'id' | 'factProfitETH' | 'createdAt' | 'updatedAt' >

@Table({
  tableName: 'Liquidations'
})
export class LiquidateModel extends Model<LiquidateDto, CreateLiquidate> implements LiquidateDto {
  @AutoIncrement
  @PrimaryKey
  @Column(DataType.INTEGER)
  id: number

  @ForeignKey(() => UserAccountModel)
  @Column(DataType.UUID)
  userId: string

  @AllowNull(false)
  @Column(DataType.STRING)
  status: LiquidateModelStatus

  @AllowNull(false)
  @Column(DataType.STRING)
  estimatedProfitETH: string

  @AllowNull(true)
  @Column(DataType.STRING)
  factProfitETH: string

  @AllowNull(true)
  @Column
  toUpdateDate: Date

  @AllowNull(true)
  @Column(DataType.TEXT)
  error: string

  @CreatedAt
  createdAt: Date

  @UpdatedAt
  updatedAt: Date

  @BelongsTo(() => UserAccountModel, {
    onDelete: 'cascade'
  })
  user: UserAccountModel
}

// call only from database/UserAccount.ts updateUserAccountData() !
export const addOrUpdateLiquidate = async (userAddress: string, options: IContractOptions): Promise<void> => {
  try {
    const estimate = await tryLiquidate(userAddress, false, options)
    // console.log('🤑 addOrUpdateLiquidate: ', estimate)

    const expectProfitETH = new BigNumber(config.utils.expectProfit).shiftedBy(18).toFixed()
    let estimatedProfitETH = new BigNumber(estimate.maxRevenueETH).minus(estimate.feeEstimated).toFixed()

    if (estimate.isFlashloan) {
      const flashLoanFee = new BigNumber(estimate.liquidateData.debtToCover)
        .multipliedBy(0.0009)
        .toFixed(0)

      const debtAsset = await TokenModel.findByPk(estimate.liquidateData.debtAsset, {
        attributes: ['balance', 'decimals', 'tokenAddress'],
        raw: true
      })
      const debtAssetPrice = (await getAssetPrice(debtAsset.tokenAddress, options)).value

      // console.log('🤑 addOrUpdateLiquidate debtAssetPrice: ', debtAssetPrice.toString())

      const flashLoanFeeETH = new BigNumber(flashLoanFee)
        .shiftedBy(-debtAsset.decimals)
        .times(new BigNumber(debtAssetPrice).shiftedBy(-18))
        .shiftedBy(18)
        .toFixed(0)

      estimatedProfitETH = new BigNumber(estimatedProfitETH).minus(flashLoanFeeETH).toFixed()
    }

    const isProfitable = new BigNumber(estimatedProfitETH).gte(expectProfitETH)
    // console.log('🤑 addOrUpdateLiquidate isProfitable: ', isProfitable.toString())

    const userModel = await UserAccountModel.findOne({ where: { address: userAddress, networkId: options.network }, raw: true })

    const result = {
      userId: userModel.id,
      status: isProfitable ? LiquidateModelStatus.PENDING : LiquidateModelStatus.DEFERRED,
      estimatedProfitETH,
      toUpdateDate: null
    }

    if (result.status === LiquidateModelStatus.DEFERRED) {
      result.toUpdateDate = new Date(new Date().getTime() + (86400 * 1000))
      if (config.isTest) {
        result.toUpdateDate = new Date(new Date().getTime() + (5000))
      }

      // check the user tomorrow
      // console.log('--- update-liquidation-data', userAddress, result)
      await addJob('update-liquidation-data', { userAddress, options }, { run_at: result.toUpdateDate })
    }

    const liquidateModel = await LiquidateModel.findOne({
      where: {
        userId: userModel.id,
        status: {
          [Op.in]: [LiquidateModelStatus.PENDING, LiquidateModelStatus.DEFERRED]
        }
      }
    })

    if (liquidateModel) {
      await liquidateModel.update(result)
    } else {
      await LiquidateModel.create(result)
    }
  } catch (err) {
    console.error('addOrUpdateLiquidate', err)
  }
}

export const updateLiquidateQueue = async (): Promise<void> => {
  try {
    const liquidateRecords = await LiquidateModel.findAll({
      raw: true,
      nest: true,
      where: {
        status: {
          [Op.in]: [LiquidateModelStatus.PENDING, LiquidateModelStatus.DEFERRED]
        }
      },
      include: ['user']
    })

    const promises = []
    for (const r of liquidateRecords) {
      promises.push(updateUserAccountData({
        userAddress: r.user.address,
        network: r.user.networkId
      }))
    }

    await Promise.all(promises)
  } catch (err) {
    console.error('[ERROR]: <update-liquidate-queue>', err)
  }
}
