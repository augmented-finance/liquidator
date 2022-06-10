import { Pool } from 'pg'
import * as config from '../../config'

interface IPayloadJob {
  [key: string]: unknown
}

interface IOptionsJob {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export const addJob = async (taskName: string, payload?: IPayloadJob, options?: IOptionsJob): Promise<void> => {
  if (config.isTest && config.testDbDialect === 'sqlite') return
  try {
    const pool = new Pool({ connectionString: config.Database.dblink })
    options = { ...{ max_attempts: 3 }, ...options }
    let query = 'SELECT graphile_worker.add_job($1::text'
    const values = [taskName]
    if (payload) {
      query += ', payload := $2'
      values.push(JSON.stringify(payload))
    }

    if (options) {
      let c = values.length;
      ['queue_name', 'max_attempts', 'run_at', 'interval'].forEach((itm) => {
        if (options[itm]) {
          c++
          if (itm === 'interval') {
            query += `, run_at := NOW() + ($${c} * INTERVAL '1 minute')`
          } else {
            query += `, ${itm} :=$${c}`
          }

          values.push(options[itm])
        }
      })
    }

    query += ')'
    await pool.query(query, values)
    await pool.end()
  } catch (e) {
    console.log(e)
  }
}

export const deleteJob = async (taskName: string) : Promise<boolean> => {
  if (config.isTest && config.testDbDialect === 'sqlite') return
  try {
    const pool = new Pool({ connectionString: config.Database.dblink })
    await pool.query('DELETE FROM graphile_worker.jobs WHERE task_identifier=$1::text', [taskName])
    await pool.end()
    return true
  } catch (e) {
    console.log(e)
    return false
  }
}

export const deleteJobUpdateLiquidationData = async (userAddress: string) : Promise<boolean> => {
  if (config.isTest && config.testDbDialect === 'sqlite') return
  try {
    const pool = new Pool({ connectionString: config.Database.dblink })
    await pool.query(`delete from graphile_worker.jobs where task_identifier='update-liquidation-data' and payload ->> 'userAddress'='${userAddress}'`)
    await pool.end()
    return true
  } catch (e) {
    console.log(e)
    console.log('Error from deleteJobUpdateLiquidationData')
    return false
  }
}
