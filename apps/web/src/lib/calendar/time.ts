/**
 * Time in the SHOP's timezone, not the device's.
 *
 * A calendar drawn from the browser's local time is wrong for every owner
 * travelling, every multi-location group, and every support session where a
 * FadeUp operator looks at a shop in another country. The location carries its
 * own IANA timezone (locations.timezone), the server returns instants, and
 * every grid position here is derived by converting one to the other
 * explicitly.
 *
 * Intl is the only correct way to do this in a browser without shipping a
 * date library: it knows the actual DST history for the zone, which arithmetic
 * on a fixed UTC offset does not.
 */

export const MINUTES_PER_DAY = 24 * 60

const partsCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  // Constructing an Intl.DateTimeFormat is genuinely expensive and a week view
  // converts hundreds of instants, so they are cached by zone.
  let formatter = partsCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    partsCache.set(timeZone, formatter)
  }
  return formatter
}

export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** The wall-clock reading an instant has in `timeZone`. */
export function zonedParts(instant: Date | string, timeZone: string): ZonedParts {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  const parts = formatterFor(timeZone).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

/** `YYYY-MM-DD` for an instant, as read in the shop's timezone. */
export function zonedDateKey(instant: Date | string, timeZone: string): string {
  const { year, month, day } = zonedParts(instant, timeZone)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Minutes since local midnight. The grid's vertical coordinate. */
export function minutesSinceMidnight(instant: Date | string, timeZone: string): number {
  const { hour, minute } = zonedParts(instant, timeZone)
  return hour * 60 + minute
}

function offsetMs(date: Date, timeZone: string): number {
  const { year, month, day, hour, minute, second } = zonedParts(date, timeZone)
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second)
  return asIfUtc - date.getTime()
}

/**
 * The instant at which a wall-clock time occurs in `timeZone`.
 *
 * Applied twice on purpose. The offset depends on the instant, and the instant
 * is what we are solving for, so the first pass uses the offset at roughly the
 * right moment and the second corrects it. That second pass is what makes the
 * two DST days a year come out right instead of an hour off.
 */
export function zonedTimeToInstant(dateKey: string, minutesFromMidnight: number, timeZone: string): Date {
  const [year, month, day] = dateKey.split('-').map(Number)
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0) + minutesFromMidnight * 60_000
  const firstPass = naive - offsetMs(new Date(naive), timeZone)
  const secondPass = naive - offsetMs(new Date(firstPass), timeZone)
  return new Date(secondPass)
}

/** Today, as the shop reads it. */
export function todayInZone(timeZone: string): string {
  return zonedDateKey(new Date(), timeZone)
}

/** Shifts a `YYYY-MM-DD` key by whole days, without ever touching a timezone. */
export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

/** 0 = Sunday, matching Postgres `extract(dow …)` and the hours tables. */
export function dayOfWeek(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/**
 * The first day of the week containing `dateKey`.
 *
 * weekStartsOn is a real setting, not a detail: a shop in France reads a week
 * Monday-first and a shop in the US reads it Sunday-first, and getting it
 * wrong makes every week view subtly disorienting.
 */
export function startOfWeek(dateKey: string, weekStartsOn: number): string {
  const current = dayOfWeek(dateKey)
  const delta = (current - weekStartsOn + 7) % 7
  return addDays(dateKey, -delta)
}

export function startOfMonth(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`
}

export function addMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  // Clamp: adding a month to the 31st must not silently roll into the next.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.toISOString().slice(0, 10)
}

/** The half-open instant range covering whole local days. What the range RPC takes. */
export function rangeForDays(startDateKey: string, dayCount: number, timeZone: string) {
  return {
    from: zonedTimeToInstant(startDateKey, 0, timeZone).toISOString(),
    to: zonedTimeToInstant(addDays(startDateKey, dayCount), 0, timeZone).toISOString(),
  }
}
