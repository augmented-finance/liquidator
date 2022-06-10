import { ZONE } from '../utils/zone'
import { runSheduler } from '../utils/sheduler'

import { updateUserAccountData, getUsers } from '../database/UserAccount'
import { getListeners, ContractName } from '../database/Listener'
import { Sequelize } from 'sequelize/types'
import chalk from 'chalk'

export class Monitoring {
  private zone: ZONE;
  private period: string;
  private name: string;

  constructor (zone: ZONE, period: string) {
    this.zone = zone
    this.period = period
    this.name = `monitoring-${zone}`
  }

  callback (zone: ZONE, name: string) {
    return async () : Promise<void> => {
      const users = await getUsers(zone)
      const listeners = await getListeners(ContractName.LENDING_POOL)

      const promises = []
      for (const listener of listeners) {
        const _users = users.filter((user) => user.networkId === listener.networkId)
        _users.forEach((u) => {
          promises.push(updateUserAccountData({
            userAddress: u.address,
            network: listener.networkId,
            blockNumber: 'monitoring',
            prevHF: u.healthFactor
          }, listener))
        })
      }

      await Promise.all(promises)

      if (users.length) {
        console.log(
          chalk.magenta(`[${name}]`),
          chalk.green(`Updated ${users.length} users !`)
        )
      }
    }
  }

  async start () : Promise<void> {
    await runSheduler(this.name, this.period, this.callback(this.zone, this.name))
  }
}

export const deleteAllSchdulers = async (sequelize: Sequelize) : Promise<void> => {
  const checkWorker = (await sequelize.query('SELECT schema_name FROM information_schema.schemata WHERE schema_name = \'graphile_worker\';'))[0]
  const checkScheduler = (await sequelize.query('SELECT schema_name FROM information_schema.schemata WHERE schema_name = \'graphile_scheduler\';'))[0]

  if (checkWorker.length) {
    sequelize.query('DELETE FROM graphile_worker.jobs')
  }
  if (checkScheduler.length) {
    sequelize.query('DELETE FROM graphile_scheduler.schedules')
  }
}
