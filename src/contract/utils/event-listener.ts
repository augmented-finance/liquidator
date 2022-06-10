/* eslint-disable @typescript-eslint/no-var-requires */

import Web3 from 'web3'
import { extendWeb3 } from './web3'
import chalk from 'chalk'
import { isHardhatNetwork } from '../../config'
import { networks } from '../../database/Network'

const EthereumEvents = require('ethereum-events')

interface IListenerOptions {
  pollInterval: number, // period between polls in milliseconds (default: 13000)
  confirmations: number, // n° of confirmation blocks (default: 12)
  chunkSize: number, // n° of blocks to fetch at a time (default: 10000)
  concurrency: number, // maximum n° of concurrent web3 requests (default: 10)
  backoff: number // retry backoff in milliseconds (default: 1000)
}

interface IEventListener {
  name: string,
  network: networks,
  contractAddress: string,
  abi: unknown,
  web3Provider: string,
  options?: IListenerOptions,
}

export interface IEvent {
  name: string,
  contract: string,
  timestamp: number,
  blockHash: string,
  blockNumber: number,
  transactionHash: string,
  transactionIndex: number,
  from: string, // sender of the transaction
  to: string, // receiver of the transaction
  logIndex: number,
  values?: {
    [key: string]: string
  },
  returnValues?: {
    [key: string]: string
  },
  args?: {
    [key: string]: string
  }
}

export default class EventListener {
  private name: string;
  private network: networks
  private contractAddress: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private abi: any;
  private options: IListenerOptions;
  private web3Provider: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private ethereumEvents: any;

  constructor (data: IEventListener) {
    this.name = data.name
    this.network = data.network
    this.contractAddress = data.contractAddress
    this.abi = data.abi
    this.web3Provider = data.web3Provider
    this.options = data.options || {
      pollInterval: isHardhatNetwork ? 1000 : 13000,
      confirmations: 4,
      chunkSize: 2000,
      concurrency: 10,
      backoff: 10000
    }
  }

  start (
    confirmed: (network: networks) => (blockNumber: number, events: Array<IEvent>, done: () => void) => Promise<void>,
    unconfirmed?: (network: networks) => (blockNumber: number, events: Array<IEvent>, done: () => void) => Promise<void>,
    error?: (network: networks) => (error: unknown) => void,
    startBlock: number = undefined
  ) : void {
    const contracts = [
      {
        name: this.name,
        address: this.contractAddress,
        abi: this.abi
      }
    ]

    let web3 = new Web3(this.web3Provider)

    // modify lightly web3 to handle big gas transactions (frequent in bsc)
    // this modifcation was done in version 3.x, but it's not stable and production ready yet.
    web3 = extendWeb3(web3)

    this.ethereumEvents = new EthereumEvents(web3, contracts, this.options)

    this.ethereumEvents.on('block.confirmed', confirmed(this.network))
    !!unconfirmed && this.ethereumEvents.on('block.unconfirmed', unconfirmed(this.network))
    !!error && this.ethereumEvents.on('block.error', error(this.network))

    this.ethereumEvents.start(startBlock)

    if (!this.ethereumEvents.isRunning()) {
      throw new Error(chalk.red(`Listener ${chalk.black.bgYellow(this.name)} not connected!`))
    }
    console.info(chalk.green(`Listener ${chalk.black.bgYellow(this.name)} connected! From block: ${startBlock || 'lastBlock'}`))
  }

  stop () : void {
    this.ethereumEvents.stop()
  }
}
