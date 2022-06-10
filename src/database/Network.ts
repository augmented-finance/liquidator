import { getBalance, getBalanceWithPayload, getWeb3 } from '../contract/utils/web3'
import * as config from '../config'
import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  HasMany,
  Model,
  PrimaryKey,
  Scopes,
  Table,
  UpdatedAt
} from 'sequelize-typescript'
import { ListenerModel } from './Listener'

export enum networks {
  ETH = 'eth',
  BSC = 'bsc',
  AVAX = 'avax',
  KOVAN = 'kovan',
  GNOSIS = 'gnosis'
}

/**
 * network data model
 */
export interface NetworkDto {
  id: networks
  provider?: string
  reserveProvider?: string
  balance: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

/**
 * create network data model
 */
export type CreateNetwork = Omit<NetworkDto, 'createdAt' | 'updatedAt'>

/**
 * update network data model
 */
export type UpdateNetwork = Partial<CreateNetwork>

@Scopes(() => ({
  defaultScope: {
    attributes: ['id', 'provider', 'reserveProvider']
  }
}))
@Table({
  tableName: 'Networks'
})
export class NetworkModel extends Model<NetworkDto, CreateNetwork> implements NetworkDto {
  @PrimaryKey
  @Column(DataType.STRING)
  id: networks

  @AllowNull(true)
  @Column(DataType.STRING)
  provider: string

  @AllowNull(true)
  @Column(DataType.STRING)
  reserveProvider: string

  @AllowNull(true)
  @Column(DataType.STRING)
  balance: string

  @AllowNull(false)
  @Column(DataType.BOOLEAN)
  isActive: boolean

  @CreatedAt
  createdAt: Date

  @UpdatedAt
  updatedAt: Date

  @HasMany(() => ListenerModel)
  listeners: ListenerModel[]
}

const seedsTest = [
  {
    id: networks.ETH,
    provider: 'http://127.0.0.1:8545/',
    reserveProvider: '',
    balance: '0'
  }
]

const seeds = [
  {
    id: networks.KOVAN,
    provider: config.providers.kovan,
    reserveProvider: config.reserveProviders.kovan,
    balance: '0'
  },
  {
    id: networks.ETH,
    provider: config.providers.eth,
    reserveProvider: config.reserveProviders.eth,
    balance: '0'
  },
  {
    id: networks.BSC,
    provider: config.providers.bsc,
    reserveProvider: config.reserveProviders.bsc,
    balance: '0'
  },
  {
    id: networks.AVAX,
    provider: config.providers.avax,
    reserveProvider: config.reserveProviders.avax,
    balance: '0'
  },
  {
    id: networks.GNOSIS,
    provider: config.providers.gnosis,
    reserveProvider: config.reserveProviders.gnosis,
    balance: '0'
  }
]

export const initNetworks = async (customSeeds?: CreateNetwork[]): Promise<void> => {
  const { address } = config.account
  let _seeds

  if (customSeeds) {
    _seeds = customSeeds
  } else {
    _seeds = config.isHardhatNetwork ? seedsTest : seeds
  }

  const networksPromises = []
  for (const network of _seeds) {
    if (network.provider) {
      try {
        const web3 = await getWeb3(network.id, network.provider)
        networksPromises.push(getBalanceWithPayload(web3, address, { ...network, isActive: true }))
      } catch (e) {
        await NetworkModel.upsert({
          id: network.id,
          balance: network.balance,
          isActive: false
        })
      }
    } else {
      await NetworkModel.upsert({
        id: network.id,
        balance: network.balance,
        isActive: false
      })
    }
  }
  const networks = await Promise.all(networksPromises)
  const validNetworks = networks.filter(network => network && !(network instanceof Error))

  await NetworkModel.bulkCreate(validNetworks, { updateOnDuplicate: ['provider', 'reserveProvider', 'balance', 'isActive', 'updatedAt'] })
}

export const updateBalance = async (network: networks, provider?): Promise<void> => {
  const web3 = await getWeb3(network, provider)
  const balance = await getBalance(web3, config.account.address) as string

  await NetworkModel.update({
    balance
  }, { where: { id: network } })
}

export const getNetworks = async (): Promise<NetworkModel[]> => {
  const networks = await NetworkModel.findAll({
    where: {
      isActive: true
    },
    raw: true
  })
  return networks
}
