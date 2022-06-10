import { NetworkModel, networks, updateBalance } from '../../database/Network'
import Web3 from 'web3'
import utils from 'web3-utils'
import { formatters } from 'web3-core-helpers'
import { BlockTransactionString } from 'web3-eth'
import * as config from '../../config'
import { SignedTransaction, TransactionReceipt } from 'web3-core'

export interface IContractOptions {
  network: networks
  provider?: string
  gasPrice?: string
  payload?: unknown
}

export interface ISendSignedTransactionRes {
  status: boolean
  transactionHash: string
  transactionIndex: number
  blockHash: string
  blockNumber: number
  contractAddress?: string
  cumulativeGasUsed: number
  gasUsed: number
  logs: Array<unknown>
}

export interface ISendRes {
  txs: ISendSignedTransactionRes[]
  fee: string
}

export interface ISend {
  (): Promise<ISendRes>
}
export interface IEstimate {
  (): number
}
export interface IContractMethodWrite {
  estimate: IEstimate
  send: ISend
}

// This is a modified version  of formatters.outputTransactionFormatter from 'web3-core-helpers'.
// To avoid the error: number can only safely store up to 53 bits, due to huge gas transactions (frequent in bsc).
// this bug was fixed the same way in web3 version 3.x, but it's not stable and production ready yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bigGasLimitTransactionFormatter = (tx): any => {
  if (tx.blockNumber !== null) {
    tx.blockNumber = utils.hexToNumber(tx.blockNumber)
  }
  if (tx.transactionIndex !== null) {
    tx.transactionIndex = utils.hexToNumber(tx.transactionIndex)
  }
  tx.nonce = utils.hexToNumber(tx.nonce)
  // this is the only modification from the orginal library
  tx.gas = formatters.outputBigNumberFormatter(tx.gas) // previously: tx.gas =  utils.hexToNumber(tx.gas)
  tx.gasPrice = formatters.outputBigNumberFormatter(tx.gasPrice)
  tx.value = formatters.outputBigNumberFormatter(tx.value)
  if (tx.to && utils.isAddress(tx.to)) { // tx.to could be `0x0` or `null` while contract creation
    tx.to = utils.toChecksumAddress(tx.to)
  } else {
    tx.to = null // set to `null` if invalid address
  }
  if (tx.from) {
    tx.from = utils.toChecksumAddress(tx.from)
  }
  return tx
}

// This is a modified version  of formatters.outputBlockFormatter from 'web3-core-helpers',
// that uses our custom 'bigGasLimitTransactionFormatter' instead of formatters.outputTransactionFormatter.
const blocksFormatter = (block): unknown => {
  // transform to number
  block.gasLimit = utils.hexToNumber(block.gasLimit)
  block.gasUsed = utils.hexToNumber(block.gasUsed)
  block.size = utils.hexToNumber(block.size)
  block.timestamp = utils.hexToNumber(block.timestamp)
  if (block.number !== null) {
    block.number = utils.hexToNumber(block.number)
  }
  if (block.difficulty) {
    block.difficulty = formatters.outputBigNumberFormatter(block.difficulty)
  }
  if (block.totalDifficulty) {
    block.totalDifficulty = formatters.outputBigNumberFormatter(block.totalDifficulty)
  }
  if (Array.isArray(block.transactions)) {
    // tx can be either a hash or a tx object
    block.transactions.forEach(function (tx) {
      if (!(typeof tx === 'string')) {
        // this is the only modification
        // previously formatters.outputTransactionFormatter
        return bigGasLimitTransactionFormatter(tx)
      }
    })
  }
  if (block.miner) {
    block.miner = utils.toChecksumAddress(block.miner)
  }
  if (block.baseFeePerGas) {
    block.baseFeePerGas = utils.hexToNumber(block.baseFeePerGas)
  }
  return block
}

// the first param of web3.eth.getBlock can be the block hash or number
const blockCall = (args: Array<string | number>): string => {
  return (typeof args[0] === 'string' && args[0].indexOf('0x') === 0) ? 'eth_getBlockByHash' : 'eth_getBlockByNumber'
}

export const extendWeb3 = (web3: Web3): Web3 => {
  web3.eth.extend({
    methods: [
      { // overwrite the method web3.eth.getTransaction to handle big gas limit (frequent in bsc)
        name: 'getTransaction',
        call: 'eth_getTransactionByHash',
        params: 1,
        inputFormatter: [null],
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        outputFormatter: bigGasLimitTransactionFormatter
      }, { // overwrite the method web3.eth.getBlock because it uses the method's above formatter
        name: 'getBlock',
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        call: blockCall,
        params: 2,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        inputFormatter: [formatters.inputBlockNumberFormatter, (val: unknown): boolean => !!val],
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        outputFormatter: blocksFormatter
      }
    ]
  })
  return web3
}

export const getWeb3 = async (network : networks, provider?: string) : Promise<Web3> => {
  let web3: Web3
  if (!provider) {
    const networkData = await NetworkModel.findOne({
      where: {
        id: network
      }
    })

    if (!networkData) {
      throw new Error('Invalid network')
    }

    web3 = new Web3(networkData.provider)
  } else {
    web3 = new Web3(provider)
  }

  web3 = extendWeb3(web3)
  return web3
}

export const getBalance = async (
  web3: Web3,
  address: string
): Promise<string> => {
  try {
    return await web3.eth.getBalance(address)
  } catch (err) {
    console.log(err)
  }
}

export const getBalanceWithPayload = async (
  web3: Web3,
  address: string,
  payload = {}
): Promise<{[key: string]: unknown}> => {
  try {
    const balance = await web3.eth.getBalance(address)

    return { ...payload, balance }
  } catch (err) {
    console.log(err)
  }
}

export const getGasPrice = async (web3: Web3): Promise<string> => {
  try {
    return await web3.eth.getGasPrice()
  } catch (err) {
    console.log(err)
  }
}

export const getNonce = async (web3: Web3, address: string): Promise<number> => {
  try {
    return await web3.eth.getTransactionCount(address)
  } catch (err) {
    console.log(err)
  }
}

export const getGasLimit = async (web3: Web3, obj): Promise<number> => {
  const params = {
    to: null,
    from: null,
    data: null,
    nonce: null
  }

  try {
    params.to = obj.to

    if (typeof obj.from !== 'undefined') {
      params.from = obj.from
    } else {
      delete params.from
    }

    if (typeof obj.data !== 'undefined') {
      params.data = obj.data
    } else {
      delete params.data
    }

    if (typeof obj.nonce !== 'undefined') {
      params.nonce = obj.nonce
    } else {
      delete params.nonce
    }

    const reserve = typeof obj.reserve !== 'undefined' ? parseInt(obj.reserve) : 0
    const gas = (await web3.eth.estimateGas(params)) + reserve

    return gas
  } catch (err) {
    console.log(err)
  }
}

export const getData = async (web3: Web3, obj): Promise<string> => {
  try {
    const Contract = new web3.eth.Contract(obj.contract.abi, obj.contract.address)
    return await Contract.methods[obj.method].apply(this, obj.params).encodeABI()
  } catch (err) {
    console.log(err)
  }
}

interface IGetSignedTransactionObj {
  to: string
  gasLimit: number
  gasPrice: string
  data?: string
  value?: string
  nonce?: string
}

export const getSignedTransaction = async (
  web3: Web3,
  obj: IGetSignedTransactionObj
): Promise<SignedTransaction> => {
  try {
    const params = {
      to: obj.to,
      gasPrice: web3.utils.toHex(obj.gasPrice),
      gasLimit: web3.utils.toHex(obj.gasLimit),
      chainId: await web3.eth.getChainId(),
      value: null,
      nonce: null,
      data: null
    }
    if (typeof obj.data !== 'undefined') {
      params.data = obj.data
    } else {
      delete params.data
    }

    if (typeof obj.value !== 'undefined') {
      params.value = obj.value
    } else {
      delete params.value
    }

    if (typeof obj.nonce !== 'undefined') {
      params.nonce = obj.nonce
    } else {
      delete params.nonce
    }

    return await web3.eth.accounts.signTransaction(params, config.account.privateKey)
  } catch (err) {
    console.log(err)
  }
}

export const sendSignedTransaction = async (
  web3,
  rawTransaction
): Promise<ISendSignedTransactionRes> => {
  try {
    return await web3.eth.sendSignedTransaction(rawTransaction)
  } catch (err) {
    console.log(err)
  }
}

export const sendSignedTransactionInstantly = async (
  web3,
  rawTransaction
): Promise<ISendSignedTransactionRes> => {
  try {
    return await new Promise((resolve, reject) => {
      web3.eth
        .sendSignedTransaction(rawTransaction)
        .once('transactionHash', (hash) => {
          resolve(hash)
        })
        .on('error', (error) => {
          reject(error)
        })
    })
  } catch (err) {
    console.log(err)
  }
}

export const contractMethod = async (web3, obj): Promise<unknown> => {
  try {
    const Contract = new web3.eth.Contract(obj.contract.abi, obj.contract.address)
    return await Contract.methods[obj.method].apply(this, obj.params).call()
  } catch (err) {
    console.log(err)
  }
}

export const estimateGas = async (
  contract,
  method: string,
  params: Array<unknown>
): Promise<{ data: string; gas: number }> => {
  const data = contract.methods[method](...params).encodeABI()
  const gas = await contract.methods[method](...params).estimateGas({
    from: config.account.address
  })

  return {
    gas,
    data
  }
}

export const getTransactionReceipt = async (
  web3: Web3,
  hash: string
): Promise<TransactionReceipt> => {
  return await web3.eth.getTransactionReceipt(hash)
}

interface ISendAndWaitRawTxOptions {
  network?: networks
  provider?: string
}

export const sendAndWaitRawTx = async (
  web3,
  rawTransaction,
  options: ISendAndWaitRawTxOptions = {}
): Promise<ISendSignedTransactionRes> => {
  const tx: ISendSignedTransactionRes = await new Promise((resolve, reject) => {
    const _checkTx = (tx: ISendSignedTransactionRes, interval: number): void => {
      getTransactionReceipt(web3, tx.transactionHash)
        .then((tx) => {
          clearInterval(interval)

          resolve(tx)
        })
        .catch((err) => {
          reject(err)
        })
    }

    sendSignedTransaction(web3, rawTransaction)
      .then((tx) => {
        const interval = setInterval(() => _checkTx(tx, interval), 5000)
        _checkTx(tx, interval)
      })
      .catch((err) => {
        reject(err)
      })
  })

  if (options.network) {
    await updateBalance(options.network, options.provider)
  }

  return tx
}
