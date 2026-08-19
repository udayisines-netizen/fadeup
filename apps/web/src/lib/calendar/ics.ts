/**
 * "Add to calendar", as a self-contained .ics file.
 *
 * A confirmed appointment the customer cannot get into their own calendar is
 * a confirmation they will forget. This is the smallest honest way to offer
 * it: no provider integration, no OAuth, no server round trip — a data blob
 * the OS hands to whatever calendar the person actually uses.
 *
 * Deliberately not a Google Calendar deep link: that works for one provider
 * and quietly fails for everyone on iOS or Outlook. An .ics works everywhere,
 * including offline.
 */

export interface CalendarEventInput {
  title: string
  description?: string
  location?: string
  startsAt: string
  endsAt: string
  /** Stable per appointment, so re-downloading UPDATES the entry instead of duplicating it. */
  uid: string
}

/** RFC 5545 wants UTC as YYYYMMDDTHHMMSSZ, with no separators. */
function toIcsInstant(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * Escapes per RFC 5545: commas, semicolons and backslashes are separators in
 * the format itself, so a salon called "Cut, Colour & Co" would otherwise
 * produce a file no calendar can parse.
 */
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

export function buildIcs(event: CalendarEventInput): string {
  // CRLF line endings are required by the spec, and several calendar clients
  // genuinely reject a file that uses bare newlines.
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FadeUp//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}@fade-up.com`,
    `DTSTAMP:${toIcsInstant(new Date().toISOString())}`,
    `DTSTART:${toIcsInstant(event.startsAt)}`,
    `DTEND:${toIcsInstant(event.endsAt)}`,
    `SUMMARY:${escapeText(event.title)}`,
    event.description ? `DESCRIPTION:${escapeText(event.description)}` : null,
    event.location ? `LOCATION:${escapeText(event.location)}` : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n')
}

/** Triggers the download. No-ops outside a browser rather than throwing. */
export function downloadIcs(event: CalendarEventInput, fileName = 'appointment.ics'): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return

  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Freed on the next tick: revoking synchronously races the click in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
