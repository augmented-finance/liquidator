import path from 'path'
import fs from 'fs'
import {
  AllowNull,
  Column,
  CreatedAt,
  DataType,
  Model,
  PrimaryKey,
  Scopes,
  Table,
  UpdatedAt,
  ForeignKey,
  BelongsTo
} from 'sequelize-typescript'
import { AbiItem } from 'web3-utils'

import { NetworkModel, networks } from './Network'

export enum ContractName {
  LENDING_POOL = 'lending-pool'
}

export interface IGetListeners {
  id: string
  name: string
  description: string
  contractAddress: string
  networkId: networks
  lastBlock: number
  abi: AbiItem | AbiItem[]
  network: NetworkModel
}

/**
 * listener data model
 */
export interface ListenerDto {
  contractAddress: string
  name: string
  description: string
  networkId: networks
  lastBlock: number
  createdAt: Date
  updatedAt: Date
}

/**
 * create listener data model
 */
export type CreateListener = Omit<ListenerDto, 'id' | 'description' | 'createdAt' | 'updatedAt' >

/**
 * update listener data model
 */
export type UpdateListener = Partial<CreateListener>

@Scopes(() => ({
  defaultScope: {
    attributes: {
      exclude: ['createdAt', 'updatedAt']
    }
  }
}))
@Table({
  tableName: 'Listeners'
})
export class ListenerModel extends Model<ListenerDto, CreateListener> implements ListenerDto {
  @PrimaryKey
  @AllowNull(false)
  @Column(DataType.STRING)
  contractAddress: string

  @AllowNull(false)
  @Column(DataType.STRING)
  name: string

  @AllowNull(true)
  @Column(DataType.STRING)
  description: string

  @ForeignKey(() => NetworkModel)
  @AllowNull(false)
  @Column(DataType.STRING)
  networkId: networks

  @AllowNull(true)
  @Column(DataType.BIGINT)
  lastBlock: number

  @CreatedAt
  createdAt: Date

  @UpdatedAt
  updatedAt: Date

  @BelongsTo(() => NetworkModel, {
    onDelete: 'cascade'
  })
  network: NetworkModel
}

export const getListeners = async (name?: string, network?: string) : Promise<Array<IGetListeners>> => {
  const where : Partial<{name: string, networkId: string }> = {}

  if (network) {
    where.networkId = network
  }

  if (name) {
    where.name = name
  }

  console.log('getListeners for', network, name)
  const listeners = await ListenerModel.findAll({
    where,
    include: [{
      model: NetworkModel,
      where: { isActive: true }
    }],
    raw: true,
    nest: true
  })
  const promises = []

  for (const listener of listeners) {
    const abiName = `abi-${listener.name}.json`
    const abiPath = path.join(__dirname, '..', 'contract', 'abi', abiName)

    promises.push(new Promise((resolve) => {
      fs.readFile(abiPath, 'utf8', (err, jsonString) => {
        if (err) {
          console.error(err)
          resolve(null)
          return
        }
        try {
          const abi = JSON.parse(jsonString)
          resolve({ ...listener, abi })
        } catch (err) {
          console.error(err)
          resolve(null)
        }
      })
    }))
  }

  return (await Promise.all(promises)).filter((el) => !!el)
}

export const cleanListeners = async (): Promise<void> => {
  await ListenerModel.destroy({ where: {} })
}
