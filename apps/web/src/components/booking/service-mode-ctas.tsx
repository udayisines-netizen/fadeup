import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { CalendarPlus, Users, Clock } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'
import { deriveCustomerCtas, type PublicServiceState } from '@/lib/queries/service-mode'

/**
 * What a customer can actually do here, right now.
 *
 * A customer must never have to understand service modes. They see the actions
 * that exist; when an action does not exist they get a reason, not an absence.
 *
 * WHAT IS DELIBERATELY STILL VISIBLE
 *
 * This component renders ONLY the operational CTAs — Book and Join Queue. It
 * knows nothing about Follow, favourites, the service list or the professional's
 * profile, and it must not: §25 is explicit that social actions stay available
 * in every mode. A barber who is not taking bookings today is still someone you
 * follow, and hiding that would punish them for closing the shop early.
 *
 * WHY IT RENDERS NOTHING WHEN `state` IS NULL
 *
 * The RPC returns zero rows — indistinguishably — for an unknown shop, another
 * tenant's location, an inactive establishment, and a barber who is not public.
 * Every one of those should produce a page with no operational actions rather
 * than a page that guesses, so `null` renders nothing at all rather than an
 * error the visitor cannot act on.
 */

export interface ServiceModeCtasProps {
  state: PublicServiceState | null | undefined
  isPending: boolean
  /** Where Book goes. The booking wizard needs a location, so callers build it. */
  bookHref: string
  /** Where Join Queue goes — the shop's walk-in check-in. */
  queueHref: string
  /** Overrides the Book label, e.g. "Book with {name}" on a professional page. */
  bookLabel?: string
  className?: string
}

export function ServiceModeCtas({
  state,
  isPending,
  bookHref,
  queueHref,
  bookLabel,
  className,
}: ServiceModeCtasProps) {
  const { t } = useTranslation('booking')

  if (isPending) {
    return <Skeleton className={cn('h-14 w-full rounded-lg sm:w-64', className)} />
  }

  const ctas = deriveCustomerCtas(state)

  // Nothing operational on offer, and nothing to come back for in ten minutes.
  // Said plainly, once — a page that simply omitted the button would leave the
  // visitor wondering whether it had failed to load.
  if (!ctas.book && !ctas.joinQueue && !ctas.queueClosed) {
    if (!state) return null
    return (
      <div className={cn('rounded-lg border border-border bg-paper-100 px-4 py-3', className)}>
        <p className="text-sm font-medium text-ink-950">{t('serviceMode.notAcceptingTitle')}</p>
        <p className="mt-0.5 text-pretty text-xs text-ink-500">
          {t('serviceMode.notAcceptingBody')}
        </p>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center', className)}>
      {ctas.book ? (
        <Link to={bookHref} className={buttonVariants({ size: 'lg' }, 'w-full sm:w-fit')}>
          <CalendarPlus className="h-4 w-4" aria-hidden="true" />
          {bookLabel ?? t('serviceMode.book')}
        </Link>
      ) : null}

      {ctas.joinQueue ? (
        <Link
          to={queueHref}
          className={buttonVariants(
            // Secondary when both are offered, so a hybrid shop still leads
            // with the action that reserves a time; primary when it is the only
            // thing on offer, because then it is THE action.
            { variant: ctas.book ? 'secondary' : 'primary', size: 'lg' },
            'w-full sm:w-fit',
          )}
        >
          <Users className="h-4 w-4" aria-hidden="true" />
          {t('serviceMode.joinQueue')}
        </Link>
      ) : null}

      {/* NON-ACTIONABLE, and shaped so it cannot be mistaken for a button.
          Only reached when the mode genuinely offers walk-ins and the line is
          shut right now — "come back later" would be a lie in any other mode. */}
      {ctas.queueClosed ? (
        <div
          role="status"
          className={cn(
            'flex items-start gap-2.5 rounded-lg border border-border bg-paper-100 px-3.5 py-3',
            ctas.book ? 'sm:max-w-sm' : 'w-full',
          )}
        >
          <Clock className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" aria-hidden="true" />
          <span className="flex flex-col">
            <span className="text-sm font-medium text-ink-950">
              {t('serviceMode.queueClosedTitle')}
            </span>
            <span className="text-pretty text-xs text-ink-500">
              {t('serviceMode.queueClosedBody')}
            </span>
          </span>
        </div>
      ) : null}

      {/* The shop takes walk-ins but no reservations. Without this the page
          would simply have no Book button and read as broken rather than as a
          walk-in shop. */}
      {!ctas.book && ctas.joinQueue ? (
        <p className="text-pretty text-xs text-ink-500 sm:w-full">
          {t('serviceMode.bookingClosedBody')}
        </p>
      ) : null}
    </div>
  )
}
