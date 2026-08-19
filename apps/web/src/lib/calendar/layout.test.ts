import { describe, expect, it } from 'vitest'
import {
  groupByDay,
  layoutDay,
  toOffsetPercent,
  visibleWindow,
  type PlaceableEvent,
} from '@/lib/calendar/layout'
import {
  addDays,
  addMonths,
  dayOfWeek,
  minutesSinceMidnight,
  rangeForDays,
  startOfWeek,
  zonedDateKey,
  zonedTimeToInstant,
} from '@/lib/calendar/time'

const PARIS = 'Europe/Paris'

/** Builds an event from wall-clock times in Paris, the way a shop would describe it. */
function evt(id: string, dayKey: string, startHM: string, endHM: string): PlaceableEvent {
  const toMinutes = (hm: string) => {
    const [h, m] = hm.split(':').map(Number)
    return h * 60 + m
  }
  return {
    id,
    startsAt: zonedTimeToInstant(dayKey, toMinutes(startHM), PARIS).toISOString(),
    endsAt: zonedTimeToInstant(dayKey, toMinutes(endHM), PARIS).toISOString(),
  }
}

describe('zonedTimeToInstant', () => {
  it('places a wall-clock time at the right instant in winter and summer', () => {
    // Paris is UTC+1 in January and UTC+2 in July. A calendar that assumed one
    // fixed offset would be an hour wrong for half the year.
    expect(zonedTimeToInstant('2026-01-15', 10 * 60, PARIS).toISOString()).toBe('2026-01-15T09:00:00.000Z')
    expect(zonedTimeToInstant('2026-07-15', 10 * 60, PARIS).toISOString()).toBe('2026-07-15T08:00:00.000Z')
  })

  it('survives the spring-forward day, where 02:30 local does not exist', () => {
    // 2026-03-29: Paris jumps 02:00 -> 03:00. The two-pass solve must land on
    // a real instant rather than producing something an hour adrift.
    const instant = zonedTimeToInstant('2026-03-29', 10 * 60, PARIS)
    expect(minutesSinceMidnight(instant, PARIS)).toBe(600)
  })

  it('survives the autumn fall-back day, where 02:30 local happens twice', () => {
    const instant = zonedTimeToInstant('2026-10-25', 10 * 60, PARIS)
    expect(minutesSinceMidnight(instant, PARIS)).toBe(600)
  })

  it('round-trips a whole day boundary', () => {
    const midnight = zonedTimeToInstant('2026-06-01', 0, PARIS)
    expect(zonedDateKey(midnight, PARIS)).toBe('2026-06-01')
    expect(minutesSinceMidnight(midnight, PARIS)).toBe(0)
  })
})

describe('rangeForDays', () => {
  it('spans exactly the local days asked for, not 24-hour blocks from now', () => {
    const range = rangeForDays('2026-06-01', 7, PARIS)
    expect(range.from).toBe('2026-05-31T22:00:00.000Z')
    expect(range.to).toBe('2026-06-07T22:00:00.000Z')
  })

  it('is still exactly one day across a DST transition', () => {
    // 2026-03-29 in Paris is 23 hours long. The range must still cover it
    // completely and stop at the next local midnight.
    const range = rangeForDays('2026-03-29', 1, PARIS)
    expect(zonedDateKey(range.from, PARIS)).toBe('2026-03-29')
    expect(new Date(range.to).getTime() - new Date(range.from).getTime()).toBe(23 * 3_600_000)
  })
})

describe('week and month navigation', () => {
  it('starts the week on the configured day', () => {
    // 2026-06-03 is a Wednesday.
    expect(startOfWeek('2026-06-03', 1)).toBe('2026-06-01') // Monday-first
    expect(startOfWeek('2026-06-03', 0)).toBe('2026-05-31') // Sunday-first
  })

  it('does not roll the 31st into the following month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('crosses month and year boundaries by day', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('agrees with Postgres on day numbering', () => {
    // extract(dow) is 0 = Sunday, and the hours tables are keyed on it.
    expect(dayOfWeek('2026-06-07')).toBe(0)
    expect(dayOfWeek('2026-06-08')).toBe(1)
  })
})

describe('layoutDay', () => {
  const day = '2026-06-03'

  it('gives a lone appointment the full width', () => {
    const [positioned] = layoutDay([evt('a', day, '10:00', '10:30')], day, PARIS)
    expect(positioned.startMinute).toBe(600)
    expect(positioned.endMinute).toBe(630)
    expect(positioned.columnCount).toBe(1)
    expect(positioned.column).toBe(0)
  })

  it('splits two overlapping appointments into two columns', () => {
    const laid = layoutDay([evt('a', day, '10:00', '11:00'), evt('b', day, '10:30', '11:30')], day, PARIS)
    expect(laid.map((p) => p.columnCount)).toEqual([2, 2])
    expect(new Set(laid.map((p) => p.column))).toEqual(new Set([0, 1]))
  })

  it('reuses a column once the previous occupant has finished', () => {
    // 10-11 and 11-12 do not overlap, so they share column 0 and the whole
    // cluster stays one column wide.
    const laid = layoutDay([evt('a', day, '10:00', '11:00'), evt('b', day, '11:00', '12:00')], day, PARIS)
    expect(laid.every((p) => p.columnCount === 1)).toBe(true)
  })

  it('keeps separate clusters independent', () => {
    // A busy morning must not make the quiet afternoon narrow too.
    const laid = layoutDay(
      [evt('a', day, '09:00', '10:00'), evt('b', day, '09:30', '10:30'), evt('c', day, '15:00', '15:30')],
      day,
      PARIS,
    )
    const afternoon = laid.find((p) => p.event.id === 'c')!
    expect(afternoon.columnCount).toBe(1)
  })

  it('treats a transitive chain as ONE cluster, at its true width', () => {
    // a overlaps b, b overlaps c, a does not overlap c. All three must share a
    // cluster — laying a+b and b+c out independently would draw b at two
    // different widths — but the cluster only needs TWO columns, because a and
    // c can sit one above the other. Reserving three would waste a third of
    // the day's width on nothing.
    const laid = layoutDay(
      [evt('a', day, '09:00', '10:00'), evt('b', day, '09:45', '10:45'), evt('c', day, '10:30', '11:30')],
      day,
      PARIS,
    )
    expect(laid.every((p) => p.columnCount === 2)).toBe(true)
    const byId = new Map(laid.map((p) => [p.event.id, p]))
    expect(byId.get('a')!.column).toBe(0)
    expect(byId.get('b')!.column).toBe(1)
    expect(byId.get('c')!.column).toBe(0)
  })

  it('drops events belonging to another day', () => {
    expect(layoutDay([evt('a', '2026-06-04', '10:00', '10:30')], day, PARIS)).toHaveLength(0)
  })

  it('clamps an event that started yesterday and flags the edge', () => {
    const overnight: PlaceableEvent = {
      id: 'x',
      startsAt: zonedTimeToInstant('2026-06-02', 23 * 60, PARIS).toISOString(),
      endsAt: zonedTimeToInstant(day, 60, PARIS).toISOString(),
    }
    const [positioned] = layoutDay([overnight], day, PARIS)
    expect(positioned.startMinute).toBe(0)
    expect(positioned.endMinute).toBe(60)
    // The rectangle is clipped; the booking is not. The UI marks this rather
    // than pretending the block began at midnight.
    expect(positioned.continuesFromPreviousDay).toBe(true)
    expect(positioned.continuesIntoNextDay).toBe(false)
  })

  it('clamps an event running into tomorrow', () => {
    const late: PlaceableEvent = {
      id: 'x',
      startsAt: zonedTimeToInstant(day, 23 * 60 + 30, PARIS).toISOString(),
      endsAt: zonedTimeToInstant('2026-06-04', 30, PARIS).toISOString(),
    }
    const [positioned] = layoutDay([late], day, PARIS)
    expect(positioned.startMinute).toBe(1410)
    expect(positioned.endMinute).toBe(1440)
    expect(positioned.continuesIntoNextDay).toBe(true)
  })

  it('does not draw an event that merely ends at this day\'s midnight', () => {
    // 23:00-00:00 belongs to the day it started. Drawing a zero-height sliver
    // at the top of the next day is noise.
    const ending: PlaceableEvent = {
      id: 'x',
      startsAt: zonedTimeToInstant('2026-06-02', 23 * 60, PARIS).toISOString(),
      endsAt: zonedTimeToInstant(day, 0, PARIS).toISOString(),
    }
    expect(layoutDay([ending], day, PARIS)).toHaveLength(0)
  })
})

describe('visibleWindow', () => {
  it('falls back to shop-ish hours for an empty day', () => {
    // An empty day must still look like a day, not a collapsed strip.
    expect(visibleWindow([])).toEqual({ startMinute: 480, endMinute: 1200 })
  })

  it('pads an hour either side of what is actually there', () => {
    expect(visibleWindow([{ startMinute: 600, endMinute: 630 }, { startMinute: 900, endMinute: 960 }]))
      .toEqual({ startMinute: 540, endMinute: 1020 })
  })

  it('never shows less than four hours', () => {
    // One 15-minute appointment should not fill the screen edge to edge.
    const window = visibleWindow([{ startMinute: 600, endMinute: 615 }])
    expect(window.endMinute - window.startMinute).toBeGreaterThanOrEqual(240)
  })

  it('never runs past the ends of the day', () => {
    const window = visibleWindow([{ startMinute: 0, endMinute: 1440 }])
    expect(window.startMinute).toBe(0)
    expect(window.endMinute).toBe(1440)
  })
})

describe('toOffsetPercent', () => {
  it('maps the window onto 0-100', () => {
    const window = { startMinute: 480, endMinute: 1200 }
    expect(toOffsetPercent(480, window)).toBe(0)
    expect(toOffsetPercent(1200, window)).toBe(100)
    expect(toOffsetPercent(840, window)).toBeCloseTo(50)
  })

  it('does not divide by zero on a degenerate window', () => {
    expect(toOffsetPercent(600, { startMinute: 600, endMinute: 600 })).toBe(0)
  })
})

describe('groupByDay', () => {
  it('buckets by the shop\'s local day, not the device\'s', () => {
    // 22:30 UTC on 2026-06-02 is 00:30 on 2026-06-03 in Paris. A device in
    // London would put this on the wrong day.
    const events = [{ id: 'a', startsAt: '2026-06-02T22:30:00.000Z', endsAt: '2026-06-02T23:00:00.000Z' }]
    const grouped = groupByDay(events, PARIS)
    expect([...grouped.keys()]).toEqual(['2026-06-03'])
  })

  it('keeps several events on the same day together', () => {
    const grouped = groupByDay(
      [evt('a', '2026-06-03', '10:00', '10:30'), evt('b', '2026-06-03', '14:00', '14:30')],
      PARIS,
    )
    expect(grouped.get('2026-06-03')).toHaveLength(1 + 1)
  })
})
