import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Compass, Repeat2, Sparkles, Users2 } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import {
  useMyAppointments,
  useMyFavorites,
  useMyQueueStatus,
  type MyAppointment,
  type MyFavorite,
} from '@/lib/queries/customer-app'
import { useSearchPublicProfessionals, usePublicCurrencies } from '@/lib/queries/marketplace'
import { computeFreshness } from '@/lib/personalization'
import { useGeoSuggestion } from '@/lib/intl/geo'
import { effectiveCountry } from '@/lib/intl/country-preference'
import { countryName } from '@/lib/intl/countries'
import { useDateTime } from '@/lib/intl/use-intl'
import { BusinessListingCard } from '@/components/customer/business-listing-card'
import { PageHeader, SectionHeader } from '@/components/ui/page-header'
import { StatusDot } from '@/components/ui/status-badge'
import { Avatar } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { buttonVariants } from '@/components/ui/button'
import { useAnalytics, useTrackView } from '@/lib/analytics'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { cn } from '@/lib/cn'

/**
 * `/app/customer` — the signed-in customer home.
 *
 * ============================================================================
 * DISCOVER IS SOCIAL; SEARCH IS A MARKETPLACE
 * ============================================================================
 *
 * V2 merged these two into one screen, and it was right to: Discover had been
 * a card containing a button to Search, which made a customer's most common
 * intent cost a navigation before it could begin.
 *
 * The merge fixed that and created a quieter problem. One screen was doing two
 * jobs with two different rhythms — "show me what is around me and who I go
 * to" and "find the specific thing I am looking for" — and a search panel at
 * the top of a home screen answers the second question loudly enough that the
 * first one never gets asked. R5 splits them again, with Search as a real
 * destination on the tab bar rather than a card containing a link, which is
 * what makes the split safe this time.
 *
 * So this screen leads with relationships and place:
 *
 *   1. ONE context row — a live queue, a coming appointment, or a nudge
 *   2. Shops and professionals this customer chose to keep
 *   3. What is actually near them
 *
 * ============================================================================
 * WHAT IS NOT HERE, AND WHY
 * ============================================================================
 *
 * NO RANKED FEED. "Near you" is `search_public_professionals` with the
 * customer's country or coordinates and no query. It is proximity, not a
 * recommendation: FadeUp has no ratings table, no engagement signal and no
 * ranking model, and a section headed "Recommended" backed by "whatever the
 * RPC returned first" would be the single most dishonest thing on the consumer
 * side of the product. §12 assigns Recommended ranking to a backend lot; R5
 * builds the surface it will land in and labels this one truthfully until then.
 *
 * NO "PEOPLE YOU FOLLOW" RAIL. The follow graph is platform-scoped and
 * `list_my_followed_professionals` returns an identity and a handle — but no
 * organization slug, and there is no handle route yet (R6/R7 owns it). Every
 * row in such a rail would therefore be an avatar that goes nowhere. Followed
 * professionals reachable through a FAVOURITE do appear below, because a
 * favourite carries the shop it belongs to and is therefore linkable.
 */
export function CustomerDiscoverPage() {
  const { t, i18n } = useTranslation('customer-app')
  const { user } = useAuth()
  const geo = useGeoSuggestion()
  // An explicit choice outranks GeoIP and survives the tab — the same
  // precedence the language switcher has had since Lot E (§31).
  const country = effectiveCountry(geo.countryCode)
  const analytics = useAnalytics()

  const profileQuery = useMyCustomerProfile(user?.id)
  const queueQuery = useMyQueueStatus(Boolean(user))
  const appointmentsQuery = useMyAppointments(Boolean(user))
  const favoritesQuery = useMyFavorites(Boolean(user))

  useDocumentMeta({ title: t('discover.metaTitle'), description: t('discover.metaDescription') })
  useTrackView('discovery_viewed', { properties: { surface: 'customer_discover' } }, true)

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

  // Proximity, deliberately not ranking — see the note above. Six is what fits
  // two rows at the widest breakpoint without the section outgrowing the two
  // above it, which are the ones the customer came here for.
  const nearbyQuery = useSearchPublicProfessionals({
    country,
    entityType: 'shop',
    limit: 6,
  })
  const nearby = useMemo(() => nearbyQuery.data ?? [], [nearbyQuery.data])
  const currencies = usePublicCurrencies(useMemo(() => nearby.map((r) => r.organizationId), [nearby]))

  // The context row loads independently of everything below it. A slow
  // appointments query must never hold up the sections a customer can act on.
  const contextPending = profileQuery.isPending || queueQuery.isPending || appointmentsQuery.isPending
  const activeQueueEntry = queueQuery.data?.[0] ?? null
  const needsOnboarding = !profileQuery.isPending && !profileQuery.data?.onboardingCompletedAt
  const freshness = computeFreshness(lastCompleted?.startsAt ?? null, profileQuery.data?.haircutFrequency ?? null)

  const favorites = favoritesQuery.data ?? []

  return (
    <div className="flex flex-col gap-7">
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

      {favoritesQuery.isPending ? (
        <Skeleton className="h-32 w-full rounded-xl" />
      ) : favorites.length > 0 ? (
        <section className="flex flex-col gap-3">
          <SectionHeader
            as="h2"
            title={t('discover.yoursTitle')}
            action={
              <Link
                to="/app/customer/favorites"
                className="text-sm font-medium text-accent-700 hover:text-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
              >
                {t('discover.seeAll')}
              </Link>
            }
          />
          {/* A rail rather than a grid: this is a short, personal list that
              should not compete for height with what is near you below it. */}
          <ul className="fu-scroll-x -mx-4 flex gap-3 px-4 sm:mx-0 sm:px-0">
            {favorites.map((favorite) => (
              <SavedCard key={favorite.favoriteId} favorite={favorite} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <SectionHeader
          as="h2"
          title={
            // The country NAME in the reader's language, never the ISO code:
            // "Près de vous en France", not "Près de vous en FR".
            country
              ? t('discover.nearbyTitleWithCountry', { country: countryName(country, i18n.language) })
              : t('discover.nearbyTitle')
          }
          action={
            <Link
              to="/app/customer/search"
              className="text-sm font-medium text-accent-700 hover:text-accent-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              {t('discover.seeAll')}
            </Link>
          }
        />

        {nearbyQuery.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-72 w-full rounded-xl" />
            ))}
          </div>
        ) : nearbyQuery.isError || nearby.length === 0 ? (
          // One state for "the query failed" and "there is genuinely nothing
          // here": both leave the customer needing the same escape hatch, and
          // an error panel on a home screen is heavier than the situation.
          <EmptyState
            icon={Compass}
            title={t('discover.nothingNearbyTitle')}
            description={t('discover.nothingNearbyDescription')}
            action={
              <Link to="/app/customer/search" className={buttonVariants({ variant: 'secondary' })}>
                {t('discover.openSearch')}
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {nearby.map((result, index) => (
              <BusinessListingCard
                key={`${result.organizationId}-${result.locationId}`}
                result={result}
                currency={currencies[result.organizationId]}
                onSelect={() =>
                  analytics.track('search_result_viewed', {
                    properties: { position: index + 1, result_type: 'organization' },
                    context: { organizationId: result.organizationId, barberId: null },
                  })
                }
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** One shop or professional the customer chose to keep. */
function SavedCard({ favorite }: { favorite: MyFavorite }) {
  const isBarber = favorite.barberId !== null
  const title = isBarber ? (favorite.barberDisplayName ?? favorite.organizationName) : favorite.organizationName
  const href = isBarber
    ? `/s/${favorite.organizationSlug}/barbers/${favorite.barberId}`
    : `/s/${favorite.organizationSlug}/profile`

  return (
    <li className="shrink-0">
      <Link
        to={href}
        className={cn(
          'flex w-36 flex-col items-center gap-2 rounded-xl border border-border bg-paper-0 p-3 text-center',
          'transition-colors duration-[--fu-duration-quick] hover:border-border-strong hover:bg-paper-100',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700 motion-reduce:transition-none',
        )}
      >
        <Avatar name={title} src={favorite.barberAvatarUrl} size="lg" />
        <span className="min-w-0 w-full">
          <span className="block truncate text-sm font-medium text-ink-950">{title}</span>
          {isBarber ? (
            <span className="block truncate text-xs text-ink-500">{favorite.organizationName}</span>
          ) : null}
        </span>
      </Link>
    </li>
  )
}

/**
 * One line of context, sized so it cannot compete with the sections below it.
 * `tone="live"` is for a queue you are actually standing in — the only state
 * here that changes without you.
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
