import { Sequelize } from 'sequelize-typescript'
import { Plugin, Server } from '@hapi/hapi'
import * as pkg from '../../package.json'
import { ListenerModel } from './Listener'
import { NetworkModel } from './Network'
import { UserAccountModel } from './UserAccount'
import { TokenModel } from './Token'
import { LiquidateModel } from './Liquidate'

import * as config from '../config'

const models = [
  ListenerModel,
  NetworkModel,
  UserAccountModel,
  TokenModel,
  LiquidateModel
]

export type DatabaseOptions = Partial<{
  /**
   * create an in-memory test database
   */
  test: boolean

  /**
   * database server host
   */
  host: string

  /**
   * database server port
   */
  port: number

  /**
   * database server username
   */
  username: string

  /**
   * database server password
   */
  password: string

  /**
   * database name
   */
  database: string

  /**
   * database dialect
   */
  dialect: 'postgres' | 'sqlite' /* currently supported */
}>

export const Database: Plugin<DatabaseOptions> = {
  name: 'database',
  version: pkg.version,
  register: async (server: Server, options: DatabaseOptions) => {
    let sequelize: Sequelize
    if (options.test && config.testDbDialect === 'sqlite') {
      sequelize = new Sequelize('sqlite::memory:', {
        models,
        logging: false,
        sync: {
          force: true,
          alter: true
        }
      })
      await sequelize.sync()
    } else if (options.test && config.testDbDialect === 'postgres') {
      sequelize = new Sequelize({
        dialect: 'postgres',
        host: config.Database.host,
        database: config.Database.databaseTest,
        username: config.Database.username,
        password: config.Database.password,
        port: config.Database.port,
        models,
        logging: false,
        sync: {
          force: true,
          alter: true
        }
      })
      await sequelize.sync()
    } else {
      sequelize = new Sequelize({
        ...options,
        models,
        logging: false
      })
    }

    try {
      await sequelize.authenticate()
      console.info('Connection has been established successfully.')
    } catch (e) {
      console.error('Unable to connect to the database:', e)
    }

    server.expose({
      /**
       * Get the underlying sequelize object
       * @returns sequelize object
       */
      sequelize: function (): Sequelize {
        return sequelize
      }
    })
  }
}
