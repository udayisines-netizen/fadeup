import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { minutesSinceMidnight } from '@/lib/calendar/time'
import type { PositionedEvent, PlaceableEvent } from '@/lib/calendar/layout'

/**
 * The time grid behind the day and week views.
 *
 * One component for both, because a week IS a day grid with seven columns —
 * the only thing that changes is what a column means (a professional, or a
 * date). Two near-identical grid implementations would drift the moment
 * anything about positioning changed.
 *
 * Deliberately NOT rendered on phones. A 375px screen divided into columns
 * gives each one about 40px, which is narrower than a fingertip and far too
 * narrow for a name — so the mobile surface is a real agenda list instead of
 * this grid shrunk down. See AgendaList.
 */

export interface TimeGridColumn<T extends PlaceableEvent> {
  key: string
  label: string
  sublabel?: string
  /** Marks today in the week view, or the signed-in professional's own column. */
  emphasised?: boolean
  events: PositionedEvent<T>[]
}

export interface TimeGridWindow {
  startMinute: number
  endMinute: number
}

export function TimeGrid<T extends PlaceableEvent>({
  columns,
  window,
  pixelsPerMinute = 1.4,
  timeZone,
  showNowIndicator,
  renderEvent,
  onEmptyClick,
  emptyClickLabel,
}: {
  columns: TimeGridColumn<T>[]
  window: TimeGridWindow
  pixelsPerMinute?: number
  timeZone: string
  /** Only meaningful when the grid is actually showing today. */
  showNowIndicator: boolean
  renderEvent: (positioned: PositionedEvent<T>) => ReactNode
  /** Called with the clicked minute-of-day and column key, for "block this time". */
  onEmptyClick?: (columnKey: string, minute: number) => void
  emptyClickLabel?: string
}) {
  const totalMinutes = Math.max(1, window.endMinute - window.startMinute)
  const height = totalMinutes * pixelsPerMinute

  // Whole hours inside the window. Derived during render — there is no state
  // and no effect involved in drawing the ruler.
  const hourMarks: number[] = []
  for (let minute = Math.ceil(window.startMinute / 60) * 60; minute <= window.endMinute; minute += 60) {
    hourMarks.push(minute)
  }

  return (
    <div className="flex w-full overflow-x-auto">
      {/* Hour gutter. Sticky so the times stay readable while scrolling a
          week sideways. */}
      <div className="sticky start-0 z-20 w-14 shrink-0 bg-paper-0" aria-hidden="true">
        <div className="h-10 border-b border-border" />
        <div className="relative" style={{ height }}>
          {hourMarks.map((minute) => (
            <div
              key={minute}
              className="absolute -translate-y-1/2 pe-2 text-end text-xs tabular-nums text-ink-500"
              style={{ top: (minute - window.startMinute) * pixelsPerMinute, insetInlineEnd: 0 }}
            >
              {formatHour(minute)}
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1">
        {columns.map((column) => (
          <div
            key={column.key}
            className={cn(
              'relative min-w-32 flex-1 border-s border-border',
              column.emphasised && 'bg-accent-100/30',
            )}
          >
            <div className="sticky top-0 z-10 flex h-10 flex-col justify-center border-b border-border bg-paper-0 px-2">
              <span className="truncate text-sm font-medium text-ink-950">{column.label}</span>
              {column.sublabel ? (
                <span className="truncate text-xs text-ink-500">{column.sublabel}</span>
              ) : null}
            </div>

            <div className="relative" style={{ height }}>
              {/* Hour lines. aria-hidden: the grid's meaning is carried by the
                  events, which are real buttons with real labels. */}
              {hourMarks.map((minute) => (
                <div
                  key={minute}
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-border/60"
                  style={{ top: (minute - window.startMinute) * pixelsPerMinute }}
                />
              ))}

              {onEmptyClick ? (
                <button
                  type="button"
                  // Sits UNDER the events (they come later in the DOM with a
                  // higher stacking context), so it only catches clicks on
                  // genuinely free space.
                  className="absolute inset-0 h-full w-full cursor-copy"
                  aria-label={emptyClickLabel ?? `Block time in ${column.label}`}
                  onClick={(event) => {
                    const bounds = event.currentTarget.getBoundingClientRect()
                    const offset = event.clientY - bounds.top
                    // Snapped to 15 minutes: a pixel-accurate start time is
                    // never what anyone meant by clicking a calendar.
                    const minute = Math.round((offset / pixelsPerMinute + window.startMinute) / 15) * 15
                    onEmptyClick(column.key, Math.max(0, Math.min(1440 - 15, minute)))
                  }}
                />
              ) : null}

              {column.events.map((positioned) => (
                <div
                  key={positioned.event.id}
                  className="absolute px-0.5"
                  style={{
                    top: (positioned.startMinute - window.startMinute) * pixelsPerMinute,
                    height: Math.max(
                      // A 15-minute booking still has to be tappable, so the
                      // rectangle has a floor even when the maths says less.
                      22,
                      (positioned.endMinute - positioned.startMinute) * pixelsPerMinute,
                    ),
                    insetInlineStart: `${(positioned.column / positioned.columnCount) * 100}%`,
                    width: `${(1 / positioned.columnCount) * 100}%`,
                  }}
                >
                  {renderEvent(positioned)}
                </div>
              ))}

              {showNowIndicator && column.emphasised ? (
                <NowIndicator
                  window={window}
                  pixelsPerMinute={pixelsPerMinute}
                  timeZone={timeZone}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatHour(minute: number): string {
  const hour = Math.floor(minute / 60) % 24
  // Fixed reference date; only the hour is being formatted, and this respects
  // the viewer's 12/24-hour convention.
  return new Date(Date.UTC(2020, 0, 1, hour)).toLocaleTimeString(undefined, {
    hour: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The "you are here" line.
 *
 * Its position is a TRANSIENT value: it changes every minute and nothing else
 * on screen depends on it. Holding it in state would re-render the entire
 * calendar — every appointment, every column — sixty times an hour, on a
 * screen that stays open all day on a tablet in a shop.
 *
 * So it lives in a ref and the DOM node is moved directly. This is the one
 * place in the calendar where imperative DOM writing is the correct answer
 * rather than a shortcut.
 */
function NowIndicator({
  window,
  pixelsPerMinute,
  timeZone,
}: {
  window: TimeGridWindow
  pixelsPerMinute: number
  timeZone: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function position() {
      const node = ref.current
      if (!node) return
      const minute = minutesSinceMidnight(new Date(), timeZone)
      const withinWindow = minute >= window.startMinute && minute <= window.endMinute
      node.style.display = withinWindow ? 'block' : 'none'
      node.style.top = `${(minute - window.startMinute) * pixelsPerMinute}px`
    }

    position()
    // Aligned to the next whole minute, then every minute — so the line moves
    // when the clock does, not 40 seconds later.
    const msToNextMinute = 60_000 - (Date.now() % 60_000)
    let interval: ReturnType<typeof setInterval> | undefined
    const timeout = setTimeout(() => {
      position()
      interval = setInterval(position, 60_000)
    }, msToNextMinute)

    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [window.startMinute, window.endMinute, pixelsPerMinute, timeZone])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-accent-600"
    >
      <span className="absolute -start-1 -top-1 block h-2 w-2 rounded-full bg-accent-600" />
    </div>
  )
}
