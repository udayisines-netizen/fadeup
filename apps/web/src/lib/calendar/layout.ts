import { MINUTES_PER_DAY, minutesSinceMidnight, zonedDateKey } from '@/lib/calendar/time'

/**
 * Turning instants into rectangles.
 *
 * Kept as pure functions, separate from any component, for one reason: this is
 * the part of a calendar that is actually easy to get wrong — overlapping
 * bookings, an appointment running past midnight, a block that started
 * yesterday — and pure functions can be tested against those cases directly
 * instead of through a rendered grid.
 *
 * Everything is derived during render from the events themselves. There is no
 * effect that measures the DOM and writes layout back into state.
 */

export interface PlaceableEvent {
  id: string
  startsAt: string
  endsAt: string
}

export interface PositionedEvent<T extends PlaceableEvent> {
  event: T
  /** Minutes from local midnight, clamped into the day. */
  startMinute: number
  endMinute: number
  /** Which of `columnCount` side-by-side columns this event occupies. */
  column: number
  columnCount: number
  /** True when the event begins before this day — its top edge is not its real start. */
  continuesFromPreviousDay: boolean
  /** True when the event ends after this day. */
  continuesIntoNextDay: boolean
}

/**
 * Clamps an event to one local day.
 *
 * An appointment at 23:30 running 45 minutes genuinely ends tomorrow. Drawing
 * it as ending at midnight is a deliberate simplification of the RECTANGLE,
 * which is why the flags exist — the UI marks the edge rather than pretending
 * the booking is shorter than it is.
 */
function clampToDay(
  event: PlaceableEvent,
  dayKey: string,
  timeZone: string,
): { startMinute: number; endMinute: number; continuesFromPreviousDay: boolean; continuesIntoNextDay: boolean } | null {
  const startKey = zonedDateKey(event.startsAt, timeZone)
  const endKey = zonedDateKey(event.endsAt, timeZone)

  const startsBefore = startKey < dayKey
  const endsAfter = endKey > dayKey

  if (startKey > dayKey || endKey < dayKey) return null

  const startMinute = startsBefore ? 0 : minutesSinceMidnight(event.startsAt, timeZone)
  // Only a genuine spill into tomorrow reaches the bottom of the grid. An
  // event whose end lands exactly on 00:00 OF THIS DAY has no extent here —
  // it belongs to the day it started — and falls out on the check below.
  const endMinute = endsAfter ? MINUTES_PER_DAY : minutesSinceMidnight(event.endsAt, timeZone)

  if (endMinute <= startMinute) return null

  return {
    startMinute,
    endMinute,
    continuesFromPreviousDay: startsBefore,
    continuesIntoNextDay: endsAfter,
  }
}

/**
 * Lays out one day's events into side-by-side columns.
 *
 * Two appointments at the same time on DIFFERENT professionals are not a
 * conflict — the day view gives each professional their own column, so this
 * runs per column and any overlap it sees is either a genuine double-booking
 * (which the exclusion constraint prevents) or an appointment sitting under a
 * time block, which must be visible rather than hidden behind it.
 *
 * Classic sweep: group into clusters of transitively-overlapping events, then
 * greedily assign each event the first column free at its start. Every event
 * in a cluster reports the SAME columnCount so their widths line up.
 */
export function layoutDay<T extends PlaceableEvent>(
  events: T[],
  dayKey: string,
  timeZone: string,
): PositionedEvent<T>[] {
  const placed = events
    .map((event) => {
      const bounds = clampToDay(event, dayKey, timeZone)
      return bounds ? { event, ...bounds } : null
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    // Longest first within the same start, so the big block is column 0 and
    // the short appointment sits beside it rather than the other way round.
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute)

  const result: PositionedEvent<T>[] = []
  let cluster: typeof placed = []
  let clusterEnd = -1

  function flush() {
    if (cluster.length === 0) return
    // Column ends, indexed by column. An event takes the first column whose
    // previous occupant has already finished.
    const columnEnds: number[] = []
    const assigned = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMinute)
      if (column === -1) {
        column = columnEnds.length
        columnEnds.push(item.endMinute)
      } else {
        columnEnds[column] = item.endMinute
      }
      return { ...item, column }
    })

    for (const item of assigned) {
      result.push({ ...item, columnCount: columnEnds.length })
    }
    cluster = []
    clusterEnd = -1
  }

  for (const item of placed) {
    if (cluster.length > 0 && item.startMinute >= clusterEnd) flush()
    cluster.push(item)
    clusterEnd = Math.max(clusterEnd, item.endMinute)
  }
  flush()

  return result
}

/**
 * The visible vertical window for a day.
 *
 * A calendar that always renders 00:00–24:00 wastes most of its height on
 * hours no barbershop is open, and forces the user to scroll to find their
 * own morning. This derives the window from what is actually there —
 * appointments, blocks and the shop's own hours — then pads it to whole hours.
 *
 * `fallback` keeps an EMPTY day from collapsing to nothing, which would make
 * the empty state look broken rather than empty.
 */
export function visibleWindow(
  segments: Array<{ startMinute: number; endMinute: number }>,
  fallback: { startHour: number; endHour: number } = { startHour: 8, endHour: 20 },
): { startMinute: number; endMinute: number } {
  if (segments.length === 0) {
    return { startMinute: fallback.startHour * 60, endMinute: fallback.endHour * 60 }
  }

  let min = Infinity
  let max = -Infinity
  // One pass rather than two reduces, and no sort: this runs on every render
  // of every calendar view.
  for (const segment of segments) {
    if (segment.startMinute < min) min = segment.startMinute
    if (segment.endMinute > max) max = segment.endMinute
  }

  const startMinute = Math.max(0, Math.floor(min / 60) * 60 - 60)
  const endMinute = Math.min(MINUTES_PER_DAY, Math.ceil(max / 60) * 60 + 60)

  // Never show less than four hours, or a single 15-minute appointment would
  // fill the screen and lose all sense of when in the day it sits.
  if (endMinute - startMinute < 240) {
    return {
      startMinute: Math.max(0, Math.min(startMinute, MINUTES_PER_DAY - 240)),
      endMinute: Math.min(MINUTES_PER_DAY, Math.max(endMinute, startMinute + 240)),
    }
  }

  return { startMinute, endMinute }
}

/** Vertical position as a percentage of the visible window. */
export function toOffsetPercent(
  minute: number,
  window: { startMinute: number; endMinute: number },
): number {
  const span = window.endMinute - window.startMinute
  if (span <= 0) return 0
  return ((minute - window.startMinute) / span) * 100
}

/**
 * Groups events by the local day they appear on, for week and month views.
 *
 * A Map, not repeated `.filter()` per day: a month view with 300 appointments
 * would otherwise scan the whole array 30-odd times on every render.
 */
export function groupByDay<T extends PlaceableEvent>(
  events: T[],
  timeZone: string,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>()
  for (const event of events) {
    const key = zonedDateKey(event.startsAt, timeZone)
    const existing = byDay.get(key)
    if (existing) {
      existing.push(event)
    } else {
      byDay.set(key, [event])
    }
  }
  return byDay
}
