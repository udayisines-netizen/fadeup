import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, useReducedMotion } from 'motion/react'
import { Check, Clock, CircleSlash, X } from 'lucide-react'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { cn } from '@/lib/cn'
import type { BookingStage } from '@/lib/queries/customer-app'

/**
 * One vocabulary for booking state, shared by every surface that shows it.
 *
 * The words matter more than usual here. `cancelled` is the DATABASE's answer
 * for three different human situations — the shop said no, nobody answered in
 * time, or somebody cancelled — and showing that word would tell a customer
 * almost nothing about what happened or what to do next. So the stage is
 * derived once (bookingStage) and named in the customer's own language here.
 */

const STAGE_VARIANT: Record<BookingStage, BadgeVariant> = {
  waiting: 'warning',
  confirmed: 'success',
  declined: 'neutral',
  expired: 'neutral',
  cancelled: 'neutral',
  completed: 'success',
  missed: 'danger',
}

const STAGE_ICON: Record<BookingStage, typeof Check> = {
  waiting: Clock,
  confirmed: Check,
  declined: X,
  expired: CircleSlash,
  cancelled: CircleSlash,
  completed: Check,
  missed: X,
}

export function BookingStatusBadge({ stage, className }: { stage: BookingStage; className?: string }) {
  const { t } = useTranslation('customer-app')
  const reduced = useReducedMotion()
  const Icon = STAGE_ICON[stage]

  return (
    <motion.span
      // Keyed on the stage so a transition genuinely re-mounts and animates:
      // the badge is how a customer learns the answer arrived while they were
      // looking at it, so the change must be perceptible without being loud.
      key={stage}
      initial={reduced ? false : { opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduced ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
      className={cn('inline-flex', className)}
    >
      <Badge variant={STAGE_VARIANT[stage]} className="inline-flex items-center gap-1.5">
        {/* Never state by colour alone. */}
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        {t(`booking.stage.${stage}`)}
      </Badge>
    </motion.span>
  )
}

/**
 * Time left before a request expires, counted down from the SERVER's deadline.
 *
 * The value is `expires_at` off the row. Nothing here recomputes the policy —
 * that lives in one place, organizations.booking_request_ttl_minutes, and a
 * second copy in the browser is exactly how two answers start disagreeing.
 *
 * Urgency is conveyed by wording and colour, never by flashing: this sits on a
 * screen a shop leaves open all day, and an anxious pulse in the corner of the
 * room is a design failure rather than a feature.
 */
export function ExpiryCountdown({
  expiresAt,
  className,
  prefix,
}: {
  expiresAt: string | null
  className?: string
  prefix?: string
}) {
  const { t } = useTranslation('customer-app')
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!expiresAt) return
    // A minute is the right resolution: the shortest allowed window is 15
    // minutes, so a per-second tick would burn renders to animate a digit
    // almost nobody is watching.
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [expiresAt])

  if (!expiresAt) return null

  const remainingMs = new Date(expiresAt).getTime() - now
  if (remainingMs <= 0) {
    return <span className={cn('text-sm text-ink-500', className)}>{t('booking.expiringNow')}</span>
  }

  const minutes = Math.floor(remainingMs / 60_000)
  const hours = Math.floor(minutes / 60)
  const urgent = remainingMs < 60 * 60 * 1000

  const label =
    hours >= 24
      ? t('booking.expiresInDays', { count: Math.floor(hours / 24) })
      : hours >= 1
        ? t('booking.expiresInHours', { count: hours })
        : t('booking.expiresInMinutes', { count: Math.max(minutes, 1) })

  return (
    <span className={cn('text-sm', urgent ? 'font-medium text-warning-700' : 'text-ink-500', className)}>
      {prefix ? `${prefix} ` : ''}
      {label}
    </span>
  )
}

/**
 * The three-step story of a booking request.
 *
 * Deliberately only ever shows states the system actually knows: sent (always
 * true once the row exists), answered (true once it leaves pending), and the
 * outcome. There is no fabricated "shop is reviewing" step, because nothing
 * tells us anyone has looked.
 */
export function BookingProgress({ stage, className }: { stage: BookingStage; className?: string }) {
  const { t } = useTranslation('customer-app')
  const reduced = useReducedMotion()

  const answered = stage !== 'waiting'
  const accepted = stage === 'confirmed' || stage === 'completed'

  const steps = [
    { key: 'sent', done: true, label: t('booking.progress.sent') },
    { key: 'waiting', done: answered, label: t('booking.progress.waiting') },
    {
      key: 'outcome',
      done: answered,
      // While waiting, the third step names the OUTCOME BEING HOPED FOR, not
      // the current state — repeating "Waiting for confirmation" under a badge
      // that already says it tells the reader nothing and makes the rail look
      // stuck. Once answered, it names what actually happened.
      label: !answered || accepted ? t('booking.progress.confirmed') : t(`booking.stage.${stage}`),
    },
  ]

  return (
    <ol className={cn('flex items-center gap-2', className)} aria-label={t('booking.progress.label')}>
      {steps.map((step, index) => (
        <li key={step.key} className="flex flex-1 items-center gap-2">
          <div className="flex items-center gap-2">
            <motion.span
              initial={false}
              animate={{ scale: step.done && !reduced ? [1, 1.18, 1] : 1 }}
              transition={{ duration: reduced ? 0 : 0.32, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                step.done
                  ? accepted || step.key !== 'outcome'
                    ? 'border-success-700 bg-success-700 text-on-accent'
                    : 'border-border-strong bg-paper-100 text-ink-700'
                  : 'border-border bg-paper-0 text-ink-300',
              )}
            >
              {step.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
            </motion.span>
            <span className={cn('text-sm', step.done ? 'text-ink-950' : 'text-ink-500')}>{step.label}</span>
          </div>
          {index < steps.length - 1 ? (
            <span
              aria-hidden="true"
              className={cn('hidden h-px flex-1 sm:block', step.done ? 'bg-success-700/40' : 'bg-border')}
            />
          ) : null}
        </li>
      ))}
    </ol>
  )
}
