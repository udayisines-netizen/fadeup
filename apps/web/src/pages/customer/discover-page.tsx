import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Repeat2, Sparkles, Users2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import { useMyAppointments, useMyQueueStatus, type MyAppointment } from '@/lib/queries/customer-app'
import { computeFreshness } from '@/lib/personalization'
import { useGeoSuggestion } from '@/lib/intl/geo'
import { useDateTime } from '@/lib/intl/use-intl'
import { DiscoverySearch } from '@/components/customer/discovery-search'
import { PageHeader } from '@/components/ui/page-header'
import { StatusDot } from '@/components/ui/status-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { buttonVariants } from '@/components/ui/button'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { cn } from '@/lib/cn'

/**
 * `/app/customer` — the signed-in customer home.
 *
 * ============================================================================
 * WHAT CHANGED, AND WHY
 * ============================================================================
 *
 * V1 was four stacked cards of identical weight, the last of which contained
 * nothing but a button to /search. Discovery — the reason the app exists for
 * anyone not currently in a queue — was a link.
 *
 * V2 inverts it. Search IS the page. Above it sits ONE context row, and only
 * when there is real context to show: you are in a queue, or you have an
 * appointment coming, or you last had a cut long enough ago to be worth
 * mentioning. The priority order is unchanged because it was already right —
 * a live queue beats a future appointment beats a nudge.
 *
 * One row, not three: these states are mutually exclusive in practice, and
 * giving each its own full-width card taught the eye that everything here is
 * equally important, which is the same as saying nothing is.
 *
 * The GeoIP country becomes the search's starting location — never a silent
 * one. `DiscoverySearch` renders it as a chip the customer can remove.
 */
export function CustomerDiscoverPage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const geo = useGeoSuggestion()

  const profileQuery = useMyCustomerProfile(user?.id)
  const queueQuery = useMyQueueStatus(Boolean(user))
  const appointmentsQuery = useMyAppointments(Boolean(user))

  useDocumentMeta({ title: t('discover.metaTitle'), description: t('discover.metaDescription') })

  const { nextAppointment, lastCompleted } = useMemo(() => {
    const appointments = appointmentsQuery.data ?? []
    const upcoming = appointments
      .filter((a) => (a.status === 'pending' || a.status === 'confirmed') && new Date(a.startsAt).getTime() > Date.now())
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    const completed = appointments
      .filter((a) => a.status === 'completed')
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt))
    return { nextAppointment: upcoming[0] ?? null, lastCompleted: completed[0] ?? null }
  }, [appointmentsQuery.data])

  // The context row loads independently of search. A slow appointments query
  // must never hold the search field hostage — that is the one thing on this
  // page that has to be usable instantly.
  const contextPending = profileQuery.isPending || queueQuery.isPending || appointmentsQuery.isPending
  const activeQueueEntry = queueQuery.data?.[0] ?? null
  const needsOnboarding = !profileQuery.isPending && !profileQuery.data?.onboardingCompletedAt
  const freshness = computeFreshness(lastCompleted?.startsAt ?? null, profileQuery.data?.haircutFrequency ?? null)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('discover.title')} subtitle={t('discover.subtitle')} />

      {contextPending ? (
        <Skeleton className="h-[4.5rem] w-full rounded-xl" />
      ) : activeQueueEntry ? (
        <ContextRow
          tone="live"
          icon={Users2}
          title={t('home.queueTitle')}
          detail={
            activeQueueEntry.status === 'in_service'
              ? t('home.queueInService')
              : activeQueueEntry.status === 'called'
                ? t('home.queueCalled')
                : t('home.queuePosition', { count: Math.max(0, (activeQueueEntry.queuePosition ?? 1) - 1) })
          }
          meta={activeQueueEntry.organizationName}
          to={`/s/${activeQueueEntry.organizationSlug}/display`}
          cta={t('home.viewQueue')}
        />
      ) : nextAppointment ? (
        <NextAppointmentRow appointment={nextAppointment} />
      ) : lastCompleted ? (
        <RebookRow
          appointment={lastCompleted}
          daysSinceLastCut={freshness.daysSinceLastCut}
          isOverdue={freshness.isOverdue}
        />
      ) : needsOnboarding ? (
        <ContextRow
          icon={Sparkles}
          title={t('home.onboardingPromptTitle')}
          detail={t('home.onboardingPromptDescription')}
          to="/app/customer/onboarding"
          cta={t('home.onboardingPromptCta')}
        />
      ) : null}

      <DiscoverySearch suggestedCountry={geo.countryCode} analyticsSurface="customer_discover" />
    </div>
  )
}

/**
 * One line of context, sized so it cannot compete with the search panel below
 * it. `tone="live"` is for a queue you are actually standing in — the only
 * state here that changes without you.
 */
function ContextRow({
  icon: Icon,
  title,
  detail,
  meta,
  to,
  cta,
  tone = 'default',
}: {
  icon: typeof Users2
  title: string
  detail: string
  meta?: string
  to: string
  cta: string
  tone?: 'default' | 'live'
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border p-3 ps-4',
        tone === 'live' ? 'border-accent-200 bg-accent-100/60' : 'border-border bg-paper-0',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          tone === 'live' ? 'bg-accent-200 text-accent-800' : 'bg-paper-100 text-ink-700',
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-950">
          {tone === 'live' ? <StatusDot tone="accent" live /> : null}
          {title}
        </p>
        <p className="truncate text-sm text-ink-700">{detail}</p>
        {meta ? <p className="truncate text-xs text-ink-500">{meta}</p> : null}
      </div>

      <Link to={to} className={buttonVariants({ variant: 'secondary', size: 'sm' }, 'shrink-0')}>
        {cta}
      </Link>
    </div>
  )
}

function NextAppointmentRow({ appointment }: { appointment: MyAppointment }) {
  const { t } = useTranslation('customer-app')
  const dateTime = useDateTime()

  // The shop's timezone, not the phone's: an appointment at 14:00 in Paris is
  // at 14:00 in Paris whether or not the customer is currently in Paris.
  const when = dateTime.dateTime(appointment.startsAt, appointment.locationTimezone)
  const detail = appointment.barberDisplayName
    ? `${when} — ${t('home.upcomingWith', { barber: appointment.barberDisplayName })}`
    : when

  return (
    <ContextRow
      icon={CalendarClock}
      title={t('home.upcomingTitle')}
      detail={detail}
      meta={appointment.organizationName}
      to="/app/customer/appointments"
      cta={t('home.viewAppointments')}
    />
  )
}

function RebookRow({
  appointment,
  daysSinceLastCut,
  isOverdue,
}: {
  appointment: MyAppointment
  daysSinceLastCut: number | null
  isOverdue: boolean
}) {
  const { t } = useTranslation('customer-app')

  const rebookHref =
    appointment.barberId && appointment.serviceId
      ? `/s/${appointment.organizationSlug}?barber=${appointment.barberId}&service=${appointment.serviceId}`
      : `/s/${appointment.organizationSlug}`

  return (
    <ContextRow
      icon={Repeat2}
      title={isOverdue ? t('home.rebookOverdueTitle') : t('home.rebookTitle')}
      detail={
        daysSinceLastCut !== null
          ? t('home.lastCutDays', { count: daysSinceLastCut })
          : (appointment.barberDisplayName ?? appointment.organizationName)
      }
      meta={appointment.organizationName}
      to={rebookHref}
      cta={
        appointment.barberDisplayName
          ? t('home.rebookCta', { barber: appointment.barberDisplayName })
          : t('home.discoverCta')
      }
    />
  )
}
