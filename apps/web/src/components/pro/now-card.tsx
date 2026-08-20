import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight, Phone, Scissors } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { Button, buttonVariants } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/status-badge'
import { useDateTime } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import type { CalendarAppointment } from '@/lib/queries/calendar'

/**
 * The single most important object in the Professional product.
 *
 * Whoever is in the chair right now, how long they have been there, and the
 * one action that ends it. Everything else on the dashboard is context for
 * this card, which is why it is roughly two-thirds of the primary row on
 * desktop and the entire first screen on mobile.
 *
 * THE TIMER IS A REF, NOT STATE.
 *
 *   This screen stays open for a full working day on a tablet propped by the
 *   mirror. Holding the elapsed value in React state would re-render this
 *   subtree sixty times an hour, every hour — and with it the avatar, the
 *   progress bar and every button. The digits are written straight to a DOM
 *   node instead, so the cost of a ticking clock is one text mutation.
 *
 *   The DATABASE remains authoritative about timing. This displays the
 *   difference between two instants the server gave us; it never becomes the
 *   record of how long anything took.
 *
 * The progress bar is capped at 100% but the elapsed time is NOT. An
 * appointment that overruns should say so — clamping the number would hide
 * exactly the situation the professional most needs to notice.
 */
export function NowCard({
  appointment,
  timeZone,
  onComplete,
  onOpen,
  isCompleting,
  canComplete,
  className,
}: {
  appointment: CalendarAppointment
  timeZone: string
  onComplete: () => void
  onOpen: () => void
  isCompleting: boolean
  canComplete: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const dt = useDateTime()

  const elapsedRef = useRef<HTMLSpanElement | null>(null)
  const barRef = useRef<HTMLSpanElement | null>(null)
  const [overrun, setOverrun] = useState(false)

  const startsAt = new Date(appointment.startsAt).getTime()
  const endsAt = new Date(appointment.endsAt).getTime()
  const scheduledMs = Math.max(1, endsAt - startsAt)

  useEffect(() => {
    function tick() {
      const elapsed = Date.now() - startsAt
      const node = elapsedRef.current
      if (node) {
        const totalSeconds = Math.max(0, Math.floor(elapsed / 1000))
        const minutes = Math.floor(totalSeconds / 60)
        const seconds = totalSeconds % 60
        node.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      }
      if (barRef.current) {
        barRef.current.style.width = `${Math.min(100, (elapsed / scheduledMs) * 100)}%`
      }
      // Only this crosses into React, and only once per appointment.
      setOverrun((current) => {
        const isOver = elapsed > scheduledMs
        return current === isOver ? current : isOver
      })
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [startsAt, scheduledMs])

  return (
    <section
      className={cn(
        'relative flex flex-col gap-4 overflow-hidden rounded-xl border border-accent-200 bg-paper-0 p-5',
        className,
      )}
    >
      {/* A soft accent wash from the leading edge — the only decorative
          gradient in the Professional product, and it is doing hierarchy work:
          it separates NOW from NEXT without a heavier border. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-accent-100/70 to-transparent"
      />

      <div className="relative flex items-start justify-between gap-3">
        <StatusBadge tone="accent" live>
          {t('app:today.inProgress')}
        </StatusBadge>
        <span className="text-xs text-ink-500">
          {t('app:today.startedAt', { time: dt.time(appointment.startsAt, timeZone) })}
        </span>
      </div>

      <div className="relative flex items-center gap-4">
        <Avatar name={appointment.customerName} size="xl" ring />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-semibold text-ink-950">{appointment.customerName}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-ink-700">
            <Scissors className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden="true" />
            {appointment.serviceName ?? t('app:today.noService')}
          </p>
          {appointment.barberDisplayName ? (
            <p className="mt-0.5 truncate text-xs text-ink-500">{appointment.barberDisplayName}</p>
          ) : null}
        </div>

        <div className="shrink-0 text-end">
          {/* tabular-nums so the digits do not jitter as they change. */}
          <span
            ref={elapsedRef}
            className={cn(
              'block text-3xl font-semibold tabular-nums leading-none sm:text-4xl',
              overrun ? 'text-warning-600' : 'text-accent-600',
            )}
          >
            00:00
          </span>
          <span className="mt-1 block text-xs text-ink-500">
            {overrun ? t('app:today.overrunning') : t('app:today.elapsed')}
          </span>
        </div>
      </div>

      <div className="relative">
        <span className="block h-1.5 w-full overflow-hidden rounded-full bg-paper-200" aria-hidden="true">
          <span
            ref={barRef}
            className={cn('block h-full rounded-full', overrun ? 'bg-warning-600' : 'bg-accent-600')}
            style={{ width: '0%' }}
          />
        </span>
        <p className="mt-1.5 text-xs text-ink-500">
          {t('app:today.scheduledFor', { duration: dt.duration(Math.round(scheduledMs / 60000)) })}
        </p>
      </div>

      <div className="relative flex flex-wrap gap-2">
        {canComplete ? (
          <Button onClick={onComplete} isLoading={isCompleting} className="min-w-40 flex-1 sm:flex-none">
            <Check className="h-4 w-4" aria-hidden="true" />
            {t('app:today.finish')}
          </Button>
        ) : null}
        {appointment.customerPhone ? (
          <a
            href={`tel:${appointment.customerPhone}`}
            className={buttonVariants({ variant: 'secondary' })}
            aria-label={t('app:today.callCustomer', { name: appointment.customerName })}
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            {t('app:today.call')}
          </a>
        ) : null}
        <Button variant="ghost" onClick={onOpen}>
          {t('app:today.details')}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  )
}
