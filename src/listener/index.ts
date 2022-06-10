/* eslint-disable @typescript-eslint/ban-ts-comment */
import { getNetworks } from '../database/Network'
import { getListeners, ListenerModel, ContractName } from '../database/Listener'
import { getLendingPoolAddress } from '../contract/utils/lp-address-provider'
import EventListener from '../contract/utils/event-listener'
import pLimit from 'p-limit' // Run multiple promise-returning & async functions with limited concurrency.

import * as collectUsers from './handle/collect-users'
import { updateUserAccountData } from '../database/UserAccount'
import { lpGetPastEvents } from '../contract/utils/lp'
import chalk from 'chalk'

import { deployBlocks, isTest, testDbDialect } from '../config'
import { getWeb3 } from '../contract/utils/web3'

let startedListeners : EventListener[] = []

const startLendingPoolListeners = async () : Promise<void> => {
  const listeners = await getListeners(ContractName.LENDING_POOL)

  for (const listener of listeners) {
    const listenerOptions = {
      name: `${listener.networkId}.${listener.name}`,
      network: listener.networkId,
      contractAddress: listener.contractAddress,
      abi: listener.abi,
      web3Provider: listener.network.provider
    }

    const eventListener = new EventListener(listenerOptions)

    eventListener.start(
      collectUsers.confirmedBlock,
      null,
      collectUsers.errorBlock,
      listener.lastBlock
    )

    startedListeners.push(eventListener)
  }
}

export const stopListeners = async () : Promise<void> => {
  for (const listener of startedListeners) {
    listener.stop()
  }
  startedListeners = []
}

const initLendingPoolListeners = async () : Promise<void> => {
  try {
    const name = ContractName.LENDING_POOL

    const networks = await getNetworks()

    for (const network of networks) {
      const contractAddress = await getLendingPoolAddress({ network: network.id, provider: network.provider })
      const lastBlock = deployBlocks[network.id]
      const lastBlockCheck = !!lastBlock && typeof lastBlock === 'number'
      await ListenerModel.bulkCreate([{
        contractAddress,
        name,
        networkId: network.id,
        ...(lastBlockCheck && { lastBlock })
      }], { updateOnDuplicate: ['contractAddress'] })
    }

    // number of promises run at once
    const CONCURRENCY = 1 // increase the value to speed up listeners initialisation
    const limit = pLimit(CONCURRENCY)

    // getPastEvents
    const listeners = await getListeners()
    for (const listener of listeners) {
      if (listener.lastBlock) {
        console.log(
          chalk.cyan(`[${listener.networkId}]`),
          chalk.yellow(`Start past events processing. From block - ${listener.lastBlock}   ==================`)
        )

        const pastEvents = await lpGetPastEvents(listener.contractAddress, listener.lastBlock, { network: listener.network.id, provider: listener.network.provider })

        const users = collectUsers.getUsersFromEvents(pastEvents.events)
        // const users = [
        //   '0x93a072F689ea5183EBeF1E405d4aA21f3Bb75080',
        //   '0x4582655f41ed12b3722d0350aa239d80fddffc7b',
        //   '0xe5E448DC11069987f1aBA2c0a73a4D3155584388',
        //   ...users1
        // ]
        const promises = []
        console.log(users)

        for (const user of users) {
          promises.push(
            limit(() => updateUserAccountData({ userAddress: user }, listener))
          )
        }

        await Promise.all(promises)

        // const lastBlock = pastEvents.currentBlock
        const web3 = await getWeb3(listener.network.id, listener.network.provider)
        const lastBlock = await web3.eth.getBlockNumber()

        await ListenerModel.update({
          lastBlock
        }, { where: { name: listener.name, networkId: listener.networkId } })

        console.log(
          chalk.cyan(`[${listener.networkId}]`),
          chalk.yellow(`Finish past events processing. Last block - ${lastBlock}  ==================`)
        )
      }
    }
  } catch (err) {
    console.log(chalk.red('Error from initLendingPoolListeners'))
    console.log(err)
  }
}

export const initListeners = async () : Promise<void> => {
  await initLendingPoolListeners()

  // START LISTENRES
  if (!isTest || (isTest && testDbDialect === 'postgres')) {
    await startLendingPoolListeners()
  }
}
