import * as Hapi from '@hapi/hapi'
import * as Inert from '@hapi/inert'
import * as Vision from '@hapi/vision'
import * as HapiPulse from 'hapi-pulse'
import * as Qs from 'qs'
import * as config from '../config'
import { Database, DatabaseOptions } from '../database'
import { Logger } from '../logger'
import { initListeners } from '../listener'
import startMonitoring from '../monitoring'
import { initNetworks } from '../database/Network'
import { fillTokens } from '../database/Token'
import { run } from 'graphile-worker'
import { runSheduler } from '../utils/sheduler'
import liquidationCheck from '../jobs/sheduler/liquidate-check-queue'
import { deleteAllSchdulers } from '../utils/monitoring'

import { isTest } from '../config'

import liquidate from '../jobs/liquidate'
import updateLiquidationData from '../jobs/update-liquidation-data'

import { updateLiquidateQueue } from '../database/Liquidate'

export const createServer = async (): Promise<Hapi.Server> => {
  const server = new Hapi.Server({
    port: config.Server.port,
    host: config.Server.host,
    query: {
      // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
      parser: (query) => Qs.parse(query)
    },
    routes: {
      validate: {
        options: {
          // Handle all validation errors
          abortEarly: false
        },
        failAction: 'error'
      },
      response: {
        failAction: 'log'
      }
    }
  })

  /* plugins required */
  await server.register([
    Inert,
    Vision
  ])

  await server.register<DatabaseOptions>({
    plugin: Database,
    options: !isTest
      ? {
          dialect: 'postgres',
          host: config.Database.host,
          database: config.Database.database,
          username: config.Database.username,
          password: config.Database.password,
          port: config.Database.port
        }
      : {
          test: true
        }
  })

  await server.register({
    plugin: HapiPulse,
    options: {
      timeout: 15000,
      signals: ['SIGINT']
    }
  })

  await server.register({
    plugin: Logger
  })
  await updateLiquidateQueue()

  if (!isTest || (isTest && config.testDbDialect === 'postgres')) {
    await run({
      connectionString: config.Database.dblink,
      taskList: {
        liquidate: liquidate,
        'update-liquidation-data': updateLiquidationData
      }
    })

    // eslint-disable-next-line dot-notation
    await deleteAllSchdulers(server.plugins['database'].sequelize())

    console.log('⌛ Init networks...')
    await initNetworks()
    console.log('✔️  Networks initialized')

    console.log('⌛ Fill available tokens and get account balances...')
    await fillTokens()
    console.log('✔️  Tokens initialized')

    console.log('⌛ Init listeners by available networks...')
    await initListeners()
    console.log('✔️  Listeners initialized')

    console.log('⌛ Start of monitoring by known users...')
    await startMonitoring()
    console.log('✔️  Monitorings initialized')

    await runSheduler('liquidate-check-queue', '* * * * *', (liquidationCheck)) // every 1 minute check liquidation queue

    console.log('✔️  Done')
  }

  return server
}
