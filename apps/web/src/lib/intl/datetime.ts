/**
 * Dates and times, in the reader's conventions and the right timezone.
 *
 * ============================================================================
 * TWO SEPARATE QUESTIONS
 * ============================================================================
 *
 *   WHICH INSTANT       -> the business's timezone (locations.timezone)
 *   HOW IT IS WRITTEN   -> the reader's locale
 *
 *   These get conflated constantly, and conflating them is how a Paris salon's
 *   09:00 appointment shows as 08:00 to an owner checking their phone from
 *   London. LOT D established that the professional calendar reads the shop's
 *   timezone; this module is how every other surface says the same thing.
 *
 *   So `timeZone` is a REQUIRED argument on the appointment formatters. There
 *   is no overload that quietly uses the device's zone, because that overload
 *   is the bug.
 *
 * ============================================================================
 * NO HAND-BUILT DATE STRINGS
 * ============================================================================
 *
 *   `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}` is French format
 *   hardcoded — correct in Paris, wrong in New York, and wrong in a different
 *   way in Tokyo. Everything here goes through Intl, which already knows that
 *   the US writes 8/19/2026, France 19/08/2026 and Japan 2026/08/19.
 */

const cache = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let found = cache.get(key)
  if (!found) {
    try {
      found = new Intl.DateTimeFormat(locale, options)
    } catch {
      // Invalid locale tag — fall back rather than throwing inside a list.
      found = new Intl.DateTimeFormat('en', options)
    }
    cache.set(key, found)
  }
  return found
}

function asDate(value: Date | string): Date {
  return typeof value === 'string' ? new Date(value) : value
}

/** "09:45" / "9:45 AM" — the reader's clock convention, the shop's zone. */
export function formatTime(value: Date | string, locale: string, timeZone: string): string {
  return formatter(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(asDate(value))
}

/** "19/08/2026" / "8/19/2026" / "2026/08/19". */
export function formatDate(value: Date | string, locale: string, timeZone: string): string {
  return formatter(locale, { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(asDate(value))
}

/** "Wednesday 19 August" — the human form, for a booking confirmation. */
export function formatLongDate(value: Date | string, locale: string, timeZone: string): string {
  return formatter(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(asDate(value))
}

/** "19 Aug 2026, 09:45" — compact but unambiguous, for lists. */
export function formatDateTime(value: Date | string, locale: string, timeZone: string): string {
  return formatter(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
  }).format(asDate(value))
}

/**
 * "09:45 – 10:15".
 *
 * formatRange, where available, is what produces a correct separator per
 * locale rather than an en dash everyone assumes. Not every runtime has it,
 * so the fallback composes two formatted times.
 */
export function formatTimeRange(
  start: Date | string,
  end: Date | string,
  locale: string,
  timeZone: string,
): string {
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone }
  const instance = formatter(locale, options)
  if (typeof instance.formatRange === 'function') {
    try {
      return instance.formatRange(asDate(start), asDate(end))
    } catch {
      // Fall through to composition.
    }
  }
  return `${formatTime(start, locale, timeZone)} – ${formatTime(end, locale, timeZone)}`
}

/** "in 2 days" / "dans 2 jours". Null when the gap is too small to be worth saying. */
export function formatRelative(value: Date | string, locale: string, now: Date = new Date()): string | null {
  const target = asDate(value)
  const diffMs = target.getTime() - now.getTime()
  const diffMinutes = Math.round(diffMs / 60_000)

  if (Math.abs(diffMinutes) < 1) return null

  try {
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const absMinutes = Math.abs(diffMinutes)
    if (absMinutes < 60) return relative.format(diffMinutes, 'minute')
    const diffHours = Math.round(diffMinutes / 60)
    if (Math.abs(diffHours) < 24) return relative.format(diffHours, 'hour')
    return relative.format(Math.round(diffHours / 24), 'day')
  } catch {
    return null
  }
}

/** "30 min" / "1 h 30". Durations are not dates and Intl has no unit for this shape. */
export function formatDuration(minutes: number, locale: string): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60

  try {
    const number = new Intl.NumberFormat(locale)
    if (hours === 0) return `${number.format(minutes)} min`
    if (rest === 0) return `${number.format(hours)} h`
    return `${number.format(hours)} h ${number.format(rest)}`
  } catch {
    return hours === 0 ? `${minutes} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest}`
  }
}

/**
 * The reader's own timezone, when it differs enough from the shop's to be
 * worth mentioning. Returns null when they agree — a second time shown for no
 * reason is the confusing dual-clock the brief warns against.
 */
export function foreignTimezoneNote(
  value: Date | string,
  businessTimeZone: string,
  locale: string,
): { deviceTime: string; deviceZone: string } | null {
  try {
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!deviceZone || deviceZone === businessTimeZone) return null

    const inBusiness = formatTime(value, locale, businessTimeZone)
    const inDevice = formatTime(value, locale, deviceZone)
    // Same wall clock in both zones: saying it twice adds nothing.
    if (inBusiness === inDevice) return null

    return { deviceTime: inDevice, deviceZone }
  } catch {
    return null
  }
}
