import { Ban, ArrowUp, ArrowDown } from 'lucide-react'
import { useDateTime } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import type { CalendarAppointment, TimeBlock } from '@/lib/queries/calendar'
import type { PositionedEvent } from '@/lib/calendar/layout'
import { useAppointmentStatus } from '@/components/calendar/appointment-status'
import { useTranslation } from 'react-i18next'

/**
 * The two things a calendar draws.
 *
 * A discriminated union rather than two parallel arrays: appointments and
 * blocks share a day, overlap each other, and must be laid out TOGETHER — a
 * block drawn without knowing about the appointment underneath it would cover
 * a real customer.
 */
export type CalendarEntry =
  | { kind: 'appointment'; id: string; startsAt: string; endsAt: string; appointment: CalendarAppointment }
  | { kind: 'block'; id: string; startsAt: string; endsAt: string; block: TimeBlock }

export function toEntries(appointments: CalendarAppointment[], blocks: TimeBlock[]): CalendarEntry[] {
  const entries: CalendarEntry[] = []
  for (const appointment of appointments) {
    entries.push({
      kind: 'appointment',
      // Prefixed because an appointment and a block could otherwise collide on
      // a React key, and both live in one list.
      id: `appointment:${appointment.id}`,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      appointment,
    })
  }
  for (const block of blocks) {
    entries.push({ kind: 'block', id: `block:${block.id}`, startsAt: block.startsAt, endsAt: block.endsAt, block })
  }
  return entries
}

/**
 * Status shown by SHAPE as well as colour.
 *
 * Cancelled and no-show rows stay on the calendar — a day's history is part of
 * the day — but they must never compete with what is still happening. So they
 * lose their fill and gain strike-through, which reads correctly in greyscale,
 * in sunlight and to a colour-blind user, none of which a colour swap does.
 */
const STATUS_BLOCK_CLASSES: Record<CalendarAppointment['status'], string> = {
  pending: 'border-warning-600 bg-warning-100 text-ink-950 border-dashed',
  confirmed: 'border-accent-600 bg-accent-100 text-ink-950',
  completed: 'border-border bg-paper-100 text-ink-700',
  cancelled: 'border-border bg-paper-50 text-ink-500 line-through',
  no_show: 'border-danger-600 bg-paper-50 text-ink-500 line-through',
}

export function CalendarEntryBlock({
  positioned,
  timeZone,
  onSelectAppointment,
  onSelectBlock,
  compact,
}: {
  positioned: PositionedEvent<CalendarEntry>
  timeZone: string
  onSelectAppointment: (appointment: CalendarAppointment) => void
  onSelectBlock: (block: TimeBlock) => void
  /** Week view: less room, so the service line is dropped rather than clipped. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const dateTime = useDateTime()
  const appointmentStatus = useAppointmentStatus()
  const { event, continuesFromPreviousDay, continuesIntoNextDay } = positioned
  const startTime = dateTime.time(event.startsAt, timeZone)

  if (event.kind === 'block') {
    return (
      <button
        type="button"
        onClick={() => onSelectBlock(event.block)}
        className={cn(
          'relative flex h-full w-full flex-col overflow-hidden rounded-md border border-dashed px-1.5 py-1 text-start',
          'border-ink-300 bg-paper-100 text-ink-700',
          // A repeating stripe reads as "not available" without needing a
          // legend, and survives being printed or screenshotted.
          '[background-image:repeating-linear-gradient(45deg,transparent,transparent_5px,var(--color-paper-200)_5px,var(--color-paper-200)_10px)]',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-700',
        )}
      >
        <ContinuationMarks from={continuesFromPreviousDay} into={continuesIntoNextDay} />
        <span className="flex items-center gap-1 text-xs font-medium">
          <Ban className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{event.block.reason ?? 'Blocked'}</span>
        </span>
        {!compact ? <span className="truncate text-xs">{startTime}</span> : null}
      </button>
    )
  }

  const appointment = event.appointment
  return (
    <button
      type="button"
      onClick={() => onSelectAppointment(appointment)}
      className={cn(
        'relative flex h-full w-full flex-col overflow-hidden rounded-md border px-1.5 py-1 text-start',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-700',
        STATUS_BLOCK_CLASSES[appointment.status],
      )}
      // The visual is dense by necessity; the accessible name is not.
      // The whole meaning of this rectangle, for anyone who cannot see it.
      aria-label={`${startTime} ${appointment.customerName}, ${appointment.serviceName ?? t('app:calendar.noService')}, ${appointmentStatus.shortLabel(appointment.status)}`}
    >
      <ContinuationMarks from={continuesFromPreviousDay} into={continuesIntoNextDay} />
      <span className="truncate text-xs font-semibold">{appointment.customerName}</span>
      {!compact ? (
        <span className="truncate text-xs opacity-80">
          {startTime}
          {appointment.serviceName ? ` · ${appointment.serviceName}` : ''}
        </span>
      ) : null}
    </button>
  )
}

/** Says the rectangle is clipped, so nobody reads a cut edge as the real time. */
function ContinuationMarks({ from, into }: { from: boolean; into: boolean }) {
  const { t } = useTranslation()
  if (!from && !into) return null
  return (
    <>
      {from ? (
        <ArrowUp className="absolute end-0.5 top-0.5 h-3 w-3 opacity-70" aria-label={t('app:entry.startedTheDayBefore')} />
      ) : null}
      {into ? (
        <ArrowDown className="absolute end-0.5 bottom-0.5 h-3 w-3 opacity-70" aria-label={t('app:entry.runsIntoTheNextDay')} />
      ) : null}
    </>
  )
}
