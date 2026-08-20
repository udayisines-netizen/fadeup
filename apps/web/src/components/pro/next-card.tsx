import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Clock } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { useDateTime } from '@/lib/intl/use-intl'
import { formatRelative } from '@/lib/intl/datetime'
import { cn } from '@/lib/cn'
import type { CalendarAppointment } from '@/lib/queries/calendar'

/**
 * Who is after this one.
 *
 * The TIME is the largest thing on the card, not the name — which inverts the
 * usual instinct and matches the reference. The reason is what the card is
 * for: the professional already knows they have someone next, and what they
 * are actually asking is "how long have I got".
 *
 * The countdown ticks once a MINUTE, not once a second. A second-resolution
 * countdown to an appointment twenty minutes away is false precision that
 * costs sixty re-renders an hour to display.
 *
 * There is no "Prepare" button, though the reference has one. Nothing in
 * FadeUp's backend corresponds to preparing an appointment, and a button that
 * looks like an action but only navigates is a small lie repeated all day.
 */
export function NextCard({
  appointment,
  timeZone,
  onOpen,
  className,
}: {
  appointment: CalendarAppointment
  timeZone: string
  onOpen: () => void
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const dt = useDateTime()
  const [relative, setRelative] = useState<string | null>(null)

  useEffect(() => {
    function update() {
      setRelative(formatRelative(appointment.startsAt, i18n.language))
    }
    update()

    // Aligned to the next minute boundary, then every minute — so the label
    // changes when the clock does rather than up to 59 seconds late.
    let interval: ReturnType<typeof setInterval> | undefined
    const timeout = setTimeout(() => {
      update()
      interval = setInterval(update, 60_000)
    }, 60_000 - (Date.now() % 60_000))

    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [appointment.startsAt, i18n.language])

  return (
    <section className={cn('flex flex-col gap-4 rounded-xl border border-border bg-paper-0 p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <StatusBadge tone="info">{t('app:today.upNext')}</StatusBadge>
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums leading-none text-ink-950">
          {dt.time(appointment.startsAt, timeZone)}
        </span>
        {relative ? <span className="text-sm font-medium text-accent-600">{relative}</span> : null}
      </div>

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Avatar name={appointment.customerName} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-950">{appointment.customerName}</p>
          <p className="truncate text-sm text-ink-500">
            {appointment.serviceName ?? t('app:today.noService')}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={onOpen} className="shrink-0">
          {t('app:today.view')}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-ink-500">
        <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {dt.duration(
          Math.round(
            (new Date(appointment.endsAt).getTime() - new Date(appointment.startsAt).getTime()) / 60000,
          ),
        )}
      </p>
    </section>
  )
}
