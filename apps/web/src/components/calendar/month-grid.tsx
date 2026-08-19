import { useMemo } from 'react'
import { cn } from '@/lib/cn'
import { addDays, dayOfWeek, startOfMonth, startOfWeek, todayInZone } from '@/lib/calendar/time'
import { groupByDay } from '@/lib/calendar/layout'
import type { CalendarEntry } from '@/components/calendar/calendar-entry'

/**
 * The month view answers a different question from the day view.
 *
 * Nobody runs a shift from a month grid — the cells are too small to hold a
 * customer's name legibly, and pretending otherwise produces the unreadable
 * "3 more…" mess that most scheduling software ships. What a month IS good for
 * is spotting shape: which days are full, which are empty, where the holiday
 * week is. So each cell shows a COUNT and a density bar, and tapping it opens
 * that day properly.
 */
export function MonthGrid({
  monthAnchor,
  entries,
  timeZone,
  weekStartsOn,
  onSelectDay,
}: {
  /** Any date within the month to display. */
  monthAnchor: string
  entries: CalendarEntry[]
  timeZone: string
  weekStartsOn: number
  onSelectDay: (dateKey: string) => void
}) {
  const today = todayInZone(timeZone)
  const monthKey = monthAnchor.slice(0, 7)

  const byDay = useMemo(() => groupByDay(entries, timeZone), [entries, timeZone])

  // Six rows always: a month can span six weeks, and a grid that changes
  // height between months makes the whole page jump when navigating.
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(monthAnchor), weekStartsOn)
    return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
  }, [monthAnchor, weekStartsOn])

  const busiest = useMemo(() => {
    let max = 0
    for (const dayKey of days) {
      const count = byDay.get(dayKey)?.length ?? 0
      if (count > max) max = count
    }
    return max
  }, [days, byDay])

  const weekdayLabels = useMemo(() => {
    // Built from a real week so the labels follow the viewer's locale and the
    // shop's chosen first day, rather than a hardcoded English array.
    const reference = startOfWeek('2026-06-03', weekStartsOn)
    return Array.from({ length: 7 }, (_, index) => {
      const [year, month, day] = addDays(reference, index).split('-').map(Number)
      return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
        weekday: 'short',
        timeZone: 'UTC',
      })
    })
  }, [weekStartsOn])

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border">
        {weekdayLabels.map((label) => (
          <div key={label} className="px-1 py-2 text-center text-xs font-medium text-ink-500">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((dayKey) => {
          const dayEntries = byDay.get(dayKey) ?? []
          const appointmentCount = dayEntries.filter((entry) => entry.kind === 'appointment').length
          const blockCount = dayEntries.length - appointmentCount
          const isCurrentMonth = dayKey.slice(0, 7) === monthKey
          const isToday = dayKey === today
          const isWeekend = dayOfWeek(dayKey) === 0 || dayOfWeek(dayKey) === 6

          return (
            <button
              key={dayKey}
              type="button"
              onClick={() => onSelectDay(dayKey)}
              aria-label={`${new Date(`${dayKey}T12:00:00Z`).toLocaleDateString(undefined, {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
                timeZone: 'UTC',
              })}, ${appointmentCount} appointments`}
              aria-current={isToday ? 'date' : undefined}
              className={cn(
                // 44px floor: every cell in a month grid is a touch target.
                'flex min-h-16 flex-col items-stretch gap-1 border-b border-e border-border p-1.5 text-start transition-colors',
                'hover:bg-paper-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700',
                !isCurrentMonth && 'opacity-40',
                isWeekend && isCurrentMonth && 'bg-paper-50/60',
              )}
            >
              <span className="flex items-center justify-between">
                <span
                  className={cn(
                    'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums',
                    isToday ? 'bg-ink-950 font-semibold text-on-accent' : 'text-ink-700',
                  )}
                >
                  {Number(dayKey.slice(8))}
                </span>
                {appointmentCount > 0 ? (
                  <span className="text-xs font-semibold tabular-nums text-ink-950">{appointmentCount}</span>
                ) : null}
              </span>

              {/* Density, not decoration: the bar is the fastest way to read a
                  month, and the number above it carries the same fact for
                  anyone who cannot see the bar. */}
              {appointmentCount > 0 ? (
                <span aria-hidden="true" className="mt-auto block h-1 rounded-full bg-paper-200">
                  <span
                    className="block h-1 rounded-full bg-accent-600"
                    style={{ width: `${busiest > 0 ? (appointmentCount / busiest) * 100 : 0}%` }}
                  />
                </span>
              ) : null}

              {blockCount > 0 ? (
                <span className="text-[10px] text-ink-500">
                  {blockCount} blocked
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
