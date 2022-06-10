import { LiquidateModel, LiquidateModelStatus, updateLiquidateQueue } from '../../database/Liquidate'
import { addJob } from '../utils'

import { isTest, testDbDialect } from '../../config'
import liquidate from '../../jobs/liquidate'
import { literal } from 'sequelize'

const LIQUIDATION_TIMEOUT = 30 * 60 * 1000 // 30 min

export default async () : Promise<void> => {
  let liquidateRecord
  try {
    const liquidateNow = await LiquidateModel.findOne({
      where: { status: LiquidateModelStatus.PROCESSING },
      attributes: ['id', 'userId', 'updatedAt'],
      include: ['user']
    })

    if (liquidateNow) {
      const proccessingTime = new Date().getTime() - new Date(liquidateNow.updatedAt).getTime()

      if (proccessingTime > LIQUIDATION_TIMEOUT) {
        await liquidateNow.update({ status: LiquidateModelStatus.PENDING })
        throw new Error(`User [${liquidateNow.user.address}] liquidation  time is up`)
      }

      return
    }

    // there is a risk of parameter changes in the period after adding a position to the queue and liquidation
    await updateLiquidateQueue()

    liquidateRecord = await LiquidateModel.findOne({
      where: {
        status: LiquidateModelStatus.PENDING
      },
      order: isTest && testDbDialect === 'sqlite'
        ? [['createdAt', 'ASC']]
        : [[literal('"estimatedProfitETH"::bigint'), 'DESC']],
      attributes: ['id', 'userId'],
      include: ['user']
    })

    if (liquidateRecord) {
      const userId = liquidateRecord.user.id
      await liquidateRecord.update({ status: LiquidateModelStatus.PROCESSING })
      if (isTest && testDbDialect === 'sqlite') {
        await liquidate(userId)
      } else {
        await addJob('liquidate', userId)
      }

      return userId
    }
  } catch (error) {
    if (liquidateRecord) {
      await liquidateRecord.update({ status: LiquidateModelStatus.PENDING })
    }
    console.error('[ERROR]: <liquidate-check-queue>', error)
  }
}
