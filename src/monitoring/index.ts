import { Monitoring } from '../utils/monitoring'
import { MONITORINGS, ZONE } from '../utils/zone'
export default async () : Promise<void> => {
  const monitoringYellow = new Monitoring(ZONE.YELLOW, MONITORINGS[ZONE.YELLOW].updatePeriod)
  await monitoringYellow.start()

  const monitoringOrange = new Monitoring(ZONE.ORANGE, MONITORINGS[ZONE.ORANGE].updatePeriod)
  await monitoringOrange.start()

  const monitoringRed = new Monitoring(ZONE.RED, MONITORINGS[ZONE.RED].updatePeriod)
  await monitoringRed.start()
}
