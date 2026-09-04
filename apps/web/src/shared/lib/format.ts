/**
 * ALL user-facing number/date/currency/duration formatting for V2 goes
 * through here, via `Intl`. Components never hand-roll a date or price —
 * `Money`, `Duration` and `DateTime` (shared/ui) wrap these.
 */

/**
 * Money is ALWAYS integer minor units (`price_cents` in the schema).
 * Passing `35` for 35,00 € instead of `3500` is the most expensive silent
 * bug this product can have — so a non-integer throws in development.
 */
export function assertIntegerCents(cents: number): void {
  if (import.meta.env.DEV && !Number.isInteger(cents)) {
    throw new Error(
      `Money expects integer cents (price_cents), received ${cents}. ` +
        'A decimal here almost always means a euro amount was passed instead of cents.',
    )
  }
}

export function formatMoney(cents: number, currency: string, locale: string): string {
  assertIntegerCents(cents)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100)
}

/** `45 min` / `45 minutes`; at 60 and beyond `1 h 15`, never `75 min`. */
export function formatDuration(minutes: number, locale: string, format: 'short' | 'long' = 'short'): string {
  if (minutes < 60) {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'minute',
      unitDisplay: format === 'long' ? 'long' : 'narrow',
    }).format(minutes)
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  const hourPart = new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: 'hour',
    unitDisplay: 'narrow',
  }).format(hours)
  if (rest === 0) return hourPart
  const restPart = String(rest).padStart(2, '0')
  return `${hourPart} ${restPart}`
}

export type DateTimeStyle = 'time' | 'date' | 'datetime' | 'relative' | 'weekday'

export function deviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Offset (minutes) of an IANA timezone at a given instant. */
function offsetAt(timezone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  })
  const name = dtf.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT'
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name)
  const [, signRaw, hoursRaw, minutesRaw] = match ?? []
  if (signRaw === undefined || hoursRaw === undefined || minutesRaw === undefined) return 0
  const sign = signRaw === '-' ? -1 : 1
  return sign * (Number(hoursRaw) * 60 + Number(minutesRaw))
}

/** True when two zones disagree at that instant — the UI must then say so. */
export function timezonesDiffer(a: string, b: string, at: Date): boolean {
  if (a === b) return false
  return offsetAt(a, at) !== offsetAt(b, at)
}

/** Short human label for a zone at an instant, e.g. `UTC+2`. */
export function timezoneLabel(timezone: string, at: Date, locale: string): string {
  const dtf = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    timeZoneName: 'short',
  })
  return dtf.formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? timezone
}

export function formatDateTime(value: string | Date, timezone: string, style: DateTimeStyle, locale: string): string {
  const date = typeof value === 'string' ? new Date(value) : value
  switch (style) {
    case 'time':
      return new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
    case 'date':
      return new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        dateStyle: 'medium',
      }).format(date)
    case 'datetime':
      return new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
    case 'weekday':
      return new Intl.DateTimeFormat(locale, {
        timeZone: timezone,
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(date)
    case 'relative': {
      const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000)
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
      const abs = Math.abs(diffSeconds)
      if (abs < 60) return rtf.format(diffSeconds, 'second')
      if (abs < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute')
      if (abs < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour')
      return rtf.format(Math.round(diffSeconds / 86400), 'day')
    }
  }
}
