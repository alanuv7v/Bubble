let here = Temporal.Now.timeZoneId()

export function dt_to_epoch (timestamp: number) {
  return Temporal.Instant.fromEpochMilliseconds(timestamp).toZonedDateTimeISO(here)
}

export function epoch_to_dt (timestamp: number) {
  let now = Temporal.Now.zonedDateTimeISO(here)
  let dt = Temporal.Now.zonedDateTimeISO(now)
  return dt
}

export function now_epoch () {
  return Temporal.Now.instant().epochMilliseconds
}
