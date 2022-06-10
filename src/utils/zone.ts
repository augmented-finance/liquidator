import BigNumber from 'bignumber.js'
import * as config from '../config'

export enum ZONE {
  GREEN = 'green', // no borrows
  YELLOW = 'yellow', // has borrows (monitoring priority 3)
  ORANGE = 'orange', // hf less then x (monitoring priority 2)
  RED = 'red', // hf less then y (monitoring priority 1)
  URGENT = 'urgent' // hf less then 1
}

export const MONITORINGS = {
  [ZONE.GREEN]: {
    healthFactor: null,
    updatePeriod: '0/1 0 * * *' // At 00:00. (daily)
  },
  [ZONE.YELLOW]: {
    healthFactor: null,
    updatePeriod: '0/1 0 * * *' // At 00:00. (daily)
  },
  [ZONE.ORANGE]: {
    healthFactor: config.zones.orange,
    updatePeriod: '0/1 * * * *' // At minute 0 and 30.
  },
  [ZONE.RED]: {
    healthFactor: config.zones.red,
    updatePeriod: '*/1 * * * *' // Every 1 minute
  }
}

export const getPriorityZoneByHF = (hf: number) : ZONE => {
  if (hf === -1) {
    return ZONE.GREEN
  }

  const _hf = new BigNumber(hf)

  if (_hf.lt(1)) {
    return ZONE.URGENT
  }

  if (_hf.lte(MONITORINGS[ZONE.RED].healthFactor)) {
    return ZONE.RED
  }

  if (_hf.lte(MONITORINGS[ZONE.ORANGE].healthFactor)) {
    return ZONE.ORANGE
  }

  return ZONE.YELLOW
}
