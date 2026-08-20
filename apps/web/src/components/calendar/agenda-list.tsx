import { Ban, CalendarCheck, ChevronRight } from 'lucide-react'
import { useDateTime } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import { EmptyState } from '@/components/ui/empty-state'
import { AppointmentStatusBadge } from '@/components/calendar/appointment-status'
import type { CalendarEntry } from '@/components/calendar/calendar-entry'
import type { CalendarAppointment, TimeBlock } from '@/lib/queries/calendar'
import { zonedDateKey } from '@/lib/calendar/time'

/**
 * The calendar, on a phone.
 *
 * NOT the time grid made narrow. A day divided into professional columns on a
 * 375px screen gives each column roughly 40px — narrower than a fingertip, too
 * narrow for a name, and unreadable at arm's length. The proportional-height
 * rectangle is also the wrong unit here: a barber holding a phone between cuts
 * wants to read the NEXT few appointments, not survey the shape of the day.
 *
 * So this is a list. Full-width rows, every target well past 44px, the time as
 * the leading anchor, and the customer's name as the largest thing in the row.
 * The same data, in the form that suits the device.
 */
export function AgendaList({
  entries,
  timeZone,
  onSelectAppointment,
  onSelectBlock,
  showDayHeadings,
  emptyTitle = 'Nothing booked',
  emptyDescription = 'When bookings come in, they appear here.',
}: {
  entries: CalendarEntry[]
  timeZone: string
  onSelectAppointment: (appointment: CalendarAppointment) => void
  onSelectBlock: (block: TimeBlock) => void
  /** Week and month ranges need day headings; a single day does not. */
  showDayHeadings?: boolean
  emptyTitle?: string
  emptyDescription?: string
}) {
  const dateTime = useDateTime()

  if (entries.length === 0) {
    return <EmptyState icon={CalendarCheck} title={emptyTitle} description={emptyDescription} />
  }

  const sorted = [...entries].sort((a, b) => a.startsAt.localeCompare(b.startsAt))

  let lastDayKey: string | null = null

  return (
    <ul className="flex flex-col gap-2">
      {sorted.map((entry) => {
        const dayKey = zonedDateKey(entry.startsAt, timeZone)
        const needsHeading = Boolean(showDayHeadings) && dayKey !== lastDayKey
        lastDayKey = dayKey

        return (
          <li key={entry.id}>
            {needsHeading ? (
              <h3 className="sticky top-0 z-10 -mx-1 bg-paper-50/95 px-1 py-2 text-sm font-semibold text-ink-950 backdrop-blur">
                {dateTime.longDate(entry.startsAt, timeZone)}
              </h3>
            ) : null}
            <AgendaRow
              entry={entry}
              timeZone={timeZone}
              onSelectAppointment={onSelectAppointment}
              onSelectBlock={onSelectBlock}
            />
          </li>
        )
      })}
    </ul>
  )
}

function AgendaRow({
  entry,
  timeZone,
  onSelectAppointment,
  onSelectBlock,
}: {
  entry: CalendarEntry
  timeZone: string
  onSelectAppointment: (appointment: CalendarAppointment) => void
  onSelectBlock: (block: TimeBlock) => void
}) {
  const dateTime = useDateTime()
  const formatTime = (iso: string) => dateTime.time(iso, timeZone)

  if (entry.kind === 'block') {
    return (
      <button
        type="button"
        onClick={() => onSelectBlock(entry.block)}
        className={cn(
          'flex min-h-14 w-full items-center gap-3 rounded-md border border-dashed border-ink-300 bg-paper-100 px-3 py-2 text-start',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
        )}
      >
        <span className="w-14 shrink-0 text-sm tabular-nums text-ink-700">{formatTime(entry.startsAt)}</span>
        <Ban className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm text-ink-700">
          {entry.block.reason ?? 'Blocked time'}
        </span>
        <span className="text-xs text-ink-500">
          until {formatTime(entry.endsAt)}
        </span>
      </button>
    )
  }

  const appointment = entry.appointment
  const finished = appointment.status === 'cancelled' || appointment.status === 'no_show'

  return (
    <button
      type="button"
      onClick={() => onSelectAppointment(appointment)}
      className={cn(
        'flex min-h-16 w-full items-center gap-3 rounded-md border bg-paper-0 px-3 py-2 text-start transition-colors',
        'hover:bg-paper-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
        finished ? 'border-border opacity-70' : 'border-border',
      )}
    >
      <span className="flex w-14 shrink-0 flex-col">
        <span className={cn('text-sm font-semibold tabular-nums text-ink-950', finished && 'line-through')}>
          {formatTime(appointment.startsAt)}
        </span>
        <span className="text-xs tabular-nums text-ink-500">{formatTime(appointment.endsAt)}</span>
      </span>

      <span className="min-w-0 flex-1">
        <span className={cn('block truncate font-medium text-ink-950', finished && 'line-through')}>
          {appointment.customerName}
        </span>
        <span className="block truncate text-sm text-ink-500">
          {appointment.serviceName ?? 'No service'}
          {appointment.barberDisplayName ? ` · ${appointment.barberDisplayName}` : ''}
        </span>
      </span>

      <span className="flex shrink-0 items-center gap-2">
        <AppointmentStatusBadge status={appointment.status} short />
        <ChevronRight className="h-4 w-4 text-ink-300" aria-hidden="true" />
      </span>
    </button>
  )
}
