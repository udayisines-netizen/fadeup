import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Ban } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { StatusBadge, StatusDot, type StatusTone } from '@/components/ui/status-badge'
import { useDateTime } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import type { CalendarAppointment, TimeBlock } from '@/lib/queries/calendar'

/**
 * The day, as a single vertical read.
 *
 * A list of appointments is not a day. What a professional actually needs to
 * see is the SHAPE of it — what is finished, what is running, what is next,
 * and crucially where the holes are. The reference shows a gap row for exactly
 * this reason and it is the most valuable row on the panel: a 35-minute gap at
 * 11:00 is a walk-in you can still take.
 *
 * GAPS ARE COMPUTED ONLY BETWEEN TWO REAL ENTRIES. FadeUp knows opening hours
 * and split shifts, but this component is given a day's entries, not a
 * schedule — so it can honestly say "there is nothing booked between these two
 * appointments" and it deliberately does not claim anything about the time
 * before the first or after the last. Labelling a lunch closure "35 minutes
 * available" would send someone to book into a break.
 *
 * A gap must also be worth acting on: shorter than the shortest service, it is
 * turnaround, not opportunity.
 */

const MIN_USEFUL_GAP_MINUTES = 15

type FlowEntry =
  | { kind: 'appointment'; key: string; startsAt: string; appointment: CalendarAppointment }
  | { kind: 'block'; key: string; startsAt: string; block: TimeBlock }
  | { kind: 'gap'; key: string; startsAt: string; minutes: number }

function statusToneFor(appointment: CalendarAppointment): { tone: StatusTone; labelKey: string } {
  switch (appointment.status) {
    case 'completed':
      return { tone: 'success', labelKey: 'app:today.statusDone' }
    case 'cancelled':
      return { tone: 'neutral', labelKey: 'app:today.statusCancelled' }
    case 'no_show':
      return { tone: 'danger', labelKey: 'app:today.statusNoShow' }
    case 'pending':
      return { tone: 'warning', labelKey: 'app:today.statusPending' }
    default:
      return { tone: 'info', labelKey: 'app:today.statusConfirmed' }
  }
}

export function TodayFlow({
  appointments,
  timeBlocks,
  timeZone,
  activeAppointmentId,
  onSelectAppointment,
  onSelectBlock,
  className,
}: {
  appointments: CalendarAppointment[]
  timeBlocks: TimeBlock[]
  timeZone: string
  activeAppointmentId?: string | null
  onSelectAppointment: (appointment: CalendarAppointment) => void
  onSelectBlock: (block: TimeBlock) => void
  className?: string
}) {
  const { t } = useTranslation()
  const dt = useDateTime()

  const entries = useMemo<FlowEntry[]>(() => {
    const merged: FlowEntry[] = [
      ...appointments.map((appointment) => ({
        kind: 'appointment' as const,
        key: `a:${appointment.id}`,
        startsAt: appointment.startsAt,
        appointment,
      })),
      ...timeBlocks.map((block) => ({
        kind: 'block' as const,
        key: `b:${block.id}`,
        startsAt: block.startsAt,
        block,
      })),
    ].sort((a, b) => a.startsAt.localeCompare(b.startsAt))

    // Insert gaps between consecutive entries. `endOf` reads the real end of
    // whichever kind precedes the gap, so a block counts as occupied time.
    const withGaps: FlowEntry[] = []
    for (let index = 0; index < merged.length; index += 1) {
      const entry = merged[index]
      withGaps.push(entry)

      const next = merged[index + 1]
      if (!next) continue

      const endOf =
        entry.kind === 'appointment' ? entry.appointment.endsAt : entry.kind === 'block' ? entry.block.endsAt : null
      if (!endOf) continue

      // A cancelled or no-show appointment already freed its slot, so the time
      // it occupied is not a "gap between bookings" — it is simply free, and
      // the row itself already says so.
      if (entry.kind === 'appointment' && (entry.appointment.status === 'cancelled' || entry.appointment.status === 'no_show')) {
        continue
      }

      const minutes = Math.round((new Date(next.startsAt).getTime() - new Date(endOf).getTime()) / 60000)
      if (minutes >= MIN_USEFUL_GAP_MINUTES) {
        withGaps.push({ kind: 'gap', key: `g:${entry.key}`, startsAt: endOf, minutes })
      }
    }
    return withGaps
  }, [appointments, timeBlocks])

  if (entries.length === 0) {
    return (
      <p className={cn('px-1 py-8 text-center text-sm text-ink-500', className)}>{t('app:today.flowEmpty')}</p>
    )
  }

  return (
    <ol className={cn('flex flex-col', className)}>
      {entries.map((entry) => {
        const time = dt.time(entry.startsAt, timeZone)

        if (entry.kind === 'gap') {
          return (
            <li key={entry.key} className="flex gap-3">
              <TimeGutter time={time} />
              <div className="flex flex-1 items-center gap-3 py-2">
                <span className="h-2 w-2 shrink-0 rounded-full border border-dashed border-accent-600" aria-hidden="true" />
                <span className="rounded-md border border-dashed border-accent-200 bg-accent-100/50 px-2.5 py-1 text-xs font-medium text-accent-800">
                  {t('app:today.gapAvailable', { duration: dt.duration(entry.minutes) })}
                </span>
              </div>
            </li>
          )
        }

        if (entry.kind === 'block') {
          return (
            <li key={entry.key} className="flex gap-3">
              <TimeGutter time={time} />
              <button
                type="button"
                onClick={() => onSelectBlock(entry.block)}
                className="flex flex-1 items-center gap-3 rounded-md py-2.5 pe-2 text-start hover:bg-paper-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700"
              >
                <StatusDot tone="neutral" />
                <Ban className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm text-ink-700">
                  {entry.block.reason ?? t('app:today.blocked')}
                </span>
              </button>
            </li>
          )
        }

        const appointment = entry.appointment
        const { tone, labelKey } = statusToneFor(appointment)
        const isActive = appointment.id === activeAppointmentId
        const finished = appointment.status === 'cancelled' || appointment.status === 'no_show'

        return (
          <li key={entry.key} className="flex gap-3">
            <TimeGutter time={time} />
            <button
              type="button"
              onClick={() => onSelectAppointment(appointment)}
              className={cn(
                'flex flex-1 items-center gap-3 rounded-lg py-2.5 pe-2 text-start',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700',
                isActive
                  ? 'bg-accent-100/60 px-2 ring-1 ring-accent-200'
                  : 'hover:bg-paper-100',
              )}
            >
              <StatusDot tone={tone} live={isActive} />
              <Avatar name={appointment.customerName} size="sm" />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-sm font-medium text-ink-950',
                    finished && 'text-ink-500 line-through',
                  )}
                >
                  {appointment.customerName}
                </span>
                <span className="block truncate text-xs text-ink-500">
                  {appointment.serviceName ?? t('app:today.noService')}
                  {appointment.barberDisplayName ? ` · ${appointment.barberDisplayName}` : ''}
                </span>
              </span>
              <StatusBadge tone={tone} size="sm" live={isActive} className="shrink-0">
                {t(labelKey)}
              </StatusBadge>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

/** The time rail. Fixed width so every row's content starts on the same axis. */
function TimeGutter({ time }: { time: string }) {
  return (
    <span className="w-12 shrink-0 pt-3 text-end text-xs tabular-nums text-ink-500">{time}</span>
  )
}
