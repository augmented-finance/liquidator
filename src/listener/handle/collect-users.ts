import { updateUserAccountData } from '../../database/UserAccount'
import { ContractName, ListenerModel } from '../../database/Listener'
import { IEvent } from 'contract/utils/event-listener'
import { networks } from 'database/Network'
import chalk from 'chalk'

const lpUpdateBlock = async (block: number, eventsCount: number, network: networks) : Promise<void> => {
  await ListenerModel.update({
    lastBlock: block
  }, { where: { name: ContractName.LENDING_POOL, networkId: network } })

  console.log(`${chalk.cyan(`[${network} : ${block}] `)} EVENTS COUNT: ${eventsCount}`)
}

export const getUsersFromEvents = (events: IEvent[]) : string[] => {
  try {
    const users = events.map(event => (event.values?.user || event.returnValues?.user || event.args?.user || null))
    return users.filter((user, i) => !!user && users.indexOf(user) === i)
  } catch (err) {
    console.error(err)
    console.error('Error from getUsersFromEvents')
  }
}

export const confirmedBlock = (network: networks) => {
  return async (blockNumber: number, events: Array<IEvent>, done: () => void) : Promise<void> => {
    try {
      if (!events.length) {
        await lpUpdateBlock(blockNumber, 0, network)
        done()
        return
      }

      const users = getUsersFromEvents(events)
      const promises = []

      for (const user of users) {
        promises.push(updateUserAccountData({
          userAddress: user,
          network,
          blockNumber: blockNumber
        }))
      }

      await Promise.all(promises)
      await lpUpdateBlock(blockNumber, events.length, network)

      done()
    } catch (e) {
      console.log(e)
    }
  }
}

export const errorBlock = (network: networks) => {
  return (error: unknown) : void => {
    console.error(network, error)
  }
}
