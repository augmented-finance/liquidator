import * as sheduler from 'graphile-scheduler'
import * as config from '../config'

export const runSheduler = async (name: string, pattern: string, callback: () => void) : Promise<void> => {
  if (config.isTest) return
  try {
    await sheduler.run({
      connectionString: config.Database.dblink,
      schedules: [
        {
          name,
          pattern,
          timeZone: 'Europe/London',
          task: callback
        }
      ]
    })
  } catch (e) {
    console.error('ERROR OCCURED WHILE GRAPHILE SHEDULER STARTING: ', e)
  }
}
