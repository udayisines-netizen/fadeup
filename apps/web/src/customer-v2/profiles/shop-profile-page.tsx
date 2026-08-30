import { useMemo } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { MapPin } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney } from '@/lib/intl/use-intl'
import {
  usePublicLocations,
  usePublicOrganization,
  usePublicServices,
} from '@/lib/queries/public-booking'
import { usePublicOrganizationBarbers } from '@/lib/queries/public-barber'
import { usePublicQueueStatus } from '@/lib/queries/public-queue'
import {
  useFollowOrganization,
  useMyFollowedOrganizations,
  useUnfollowOrganization,
} from '@/lib/queries/organization-follows'
import { useDelayedFlag } from '@/customer-v2/hooks/use-delayed'
import { IdentityTile } from '@/customer-v2/home/identity-tile'
import { Notice } from '@/customer-v2/ui/notice'
import { v2BarberProfilePath, v2BookingPath } from '@/customer-v2/routes'

/**
 * A barbershop's profile — an ESTABLISHMENT, deliberately not a person.
 *
 * ============================================================================
 * HOW IT DIFFERS FROM THE BARBER PROFILE, STRUCTURALLY
 * ============================================================================
 *
 * The barber page leads with a face and a social identity. This page leads
 * with a PLACE: a cover band with a squared identity tile, a street address as
 * the second line, and a TEAM — the establishment's defining section, which a
 * person cannot have. Same design system, different composition; that
 * difference is the requirement, not a styling choice.
 *
 * ============================================================================
 * MULTI-LOCATION, FLATTENED THE SAME WAY THE MARKETPLACE FLATTENS IT
 * ============================================================================
 *
 * One organization can run several locations, and the marketplace lists each
 * as its own ordinary Barbershop result. This page keeps that promise:
 * `?location=` (the same parameter every Book link already carries) selects
 * which site the customer is looking at, the header shows THAT site's name and
 * address, and services/queue/team are scoped to it. Sibling locations appear
 * only as a plain site switcher — never as "part of Fade Factory Group",
 * because the group is Pro topology, not customer vocabulary.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY ABSENT
 * ============================================================================
 *
 * OPEN STATE — `is_open_now` lives on the marketplace search projection, not
 * on any of this page's contracts, and deriving it client-side from hours the
 * client cannot read would be a guess. RATING/REVIEWS — no reviews table.
 * COVER PHOTOGRAPHY — `organizations` has no image column (recorded as D-2);
 * the cover band is a designed absence that a real image fills when the
 * backend gains one.
 */
export function CustomerV2ShopProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const organization = usePublicOrganization(slug)
  const locations = usePublicLocations(slug)
  const team = usePublicOrganizationBarbers(slug)

  const requestedLocation = searchParams.get('location')
  const activeLocation = useMemo(() => {
    const all = locations.data ?? []
    return all.find((l) => l.id === requestedLocation) ?? all[0] ?? null
  }, [locations.data, requestedLocation])

  const services = usePublicServices(slug, activeLocation?.id)
  const queue = usePublicQueueStatus(slug, activeLocation?.id)

  const followedOrgs = useMyFollowedOrganizations(Boolean(user))
  const follow = useFollowOrganization()
  const unfollow = useUnfollowOrganization()

  const money = useMoney()
  const showSkeletons = useDelayedFlag(organization.isPending)

  const organizationId = organization.data?.id ?? null
  const isFollowing = useMemo(
    () =>
      Boolean(organizationId && followedOrgs.data?.some((f) => f.organizationId === organizationId)),
    [followedOrgs.data, organizationId],
  )

  useDocumentMeta({
    title: organization.data
      ? t('customer-app:v2.shopProfile.documentTitle', { name: organization.data.name })
      : t('customer-app:v2.shopProfile.documentTitleFallback'),
    description: t('customer-app:v2.shopProfile.documentDescription'),
    noIndex: true,
  })

  if (organization.isError) {
    return (
      <Notice
        tone="failure"
        title={t('customer-app:v2.discovery.errorTitle')}
        body={t('customer-app:v2.discovery.errorBody')}
        actionLabel={t('customer-app:v2.discovery.retry')}
        onAction={() => void organization.refetch()}
      />
    )
  }

  if (organization.isPending) {
    return showSkeletons ? (
      <div className="v2-plate mx-auto max-w-[40rem] overflow-hidden">
        <div className="v2-skeleton h-24 w-full" />
        <div className="p-5">
          <div className="v2-skeleton h-5 w-2/5 rounded-v2-1" />
          <div className="v2-skeleton mt-2 h-4 w-3/5 rounded-v2-1" />
        </div>
      </div>
    ) : (
      <div className="min-h-64" />
    )
  }

  if (!organization.data) {
    return (
      <Notice
        tone="empty"
        title={t('customer-app:v2.shopProfile.notFoundTitle')}
        body={t('customer-app:v2.shopProfile.notFoundBody')}
        actionLabel={null}
        onAction={null}
      />
    )
  }

  const shop = organization.data
  const siblingLocations = locations.data ?? []

  /*
    THE CUSTOMER-FACING NAME IS THE SITE'S. A single-site shop stores the same
    string twice and sees it once; a multi-location organization's site shows
    its own name ("Fade Factory Créteil"), and the organization's name appears
    nowhere unless it IS the site's name. Same rule as the marketplace row.
  */
  const displayName =
    activeLocation && activeLocation.name !== shop.name ? activeLocation.name : shop.name

  const address = activeLocation
    ? [activeLocation.addressLine1, activeLocation.city].filter(Boolean).join(' · ')
    : null

  const waitingCount = (queue.data ?? []).filter((entry) => entry.status === 'waiting').length

  const teamAtLocation = (team.data ?? []).filter(
    (member) => !activeLocation || member.locationId === activeLocation.id,
  )

  const bookPath = v2BookingPath(slug ?? '', { locationId: activeLocation?.id })

  const toggleFollow = () => {
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname)}`)
      return
    }
    if (!organizationId) return
    if (isFollowing) unfollow.mutate(organizationId)
    else follow.mutate(organizationId)
  }

  return (
    <div className="mx-auto flex max-w-[40rem] flex-col gap-4">
      {/* ── Establishment identity ───────────────────────────────────────── */}
      <section className="v2-plate overflow-hidden">
        {/*
          The cover band. `organizations` has no image column, so this is a flat
          field of `fill` — a designed absence, not a broken image — that a real
          cover replaces without moving anything below it.
        */}
        <div className="h-20 bg-v2-fill md:h-24" aria-hidden="true" />

        <div className="px-5 pb-5 md:px-6 md:pb-6">
          <div className="-mt-8 flex items-end gap-4">
            <IdentityTile
              src={null}
              alt=""
              kind="shop"
              className="h-20 w-20 shrink-0 border-4 border-v2-paper md:h-24 md:w-24"
            />
          </div>

          <h1 className="mt-3 text-v2-lead font-semibold text-v2-ink">
            <bdi>{displayName}</bdi>
          </h1>

          {address ? (
            <p className="mt-1 flex items-center gap-1.5 text-v2-meta text-v2-ink-soft">
              <MapPin
                className="h-4 w-4 shrink-0 text-v2-ink-mute"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <bdi>{address}</bdi>
            </p>
          ) : null}

          {/* Site switcher — plain barbershops, never a "group". */}
          {siblingLocations.length > 1 ? (
            <div
              role="group"
              aria-label={t('customer-app:v2.shopProfile.locations')}
              className="mt-3 flex flex-wrap gap-2"
            >
              {siblingLocations.map((site) => {
                const selected = site.id === activeLocation?.id
                return (
                  <Link
                    key={site.id}
                    to={`?location=${site.id}`}
                    aria-current={selected ? 'true' : undefined}
                    className={
                      selected
                        ? 'v2-press inline-flex h-8 items-center rounded-v2-2 bg-v2-green-tint px-3 text-v2-meta font-semibold text-v2-green-ink'
                        : 'v2-press inline-flex h-8 items-center rounded-v2-2 border border-v2-hairline bg-v2-paper px-3 text-v2-meta font-medium text-v2-ink-soft'
                    }
                  >
                    <bdi>{site.name}</bdi>
                  </Link>
                )
              })}
            </div>
          ) : null}

          <div className="mt-4 flex items-center gap-2.5">
            <Link
              to={bookPath}
              className="v2-press inline-flex h-11 flex-1 items-center justify-center rounded-v2-2 bg-v2-green px-5 text-v2-body font-semibold text-v2-paper hover:bg-v2-green-deep"
            >
              {t('customer-app:v2.result.book')}
            </Link>
            <button
              type="button"
              onClick={toggleFollow}
              disabled={follow.isPending || unfollow.isPending}
              aria-pressed={isFollowing}
              className={
                isFollowing
                  ? 'v2-press inline-flex h-11 items-center justify-center rounded-v2-2 bg-v2-green-tint px-5 text-v2-body font-semibold text-v2-green-ink'
                  : 'v2-press inline-flex h-11 items-center justify-center rounded-v2-2 border border-v2-edge bg-v2-paper px-5 text-v2-body font-semibold text-v2-ink hover:bg-v2-fill'
              }
            >
              {isFollowing
                ? t('customer-app:v2.barberProfile.following')
                : t('customer-app:v2.barberProfile.follow')}
            </button>
          </div>

          {waitingCount > 0 ? (
            <p className="mt-3 text-v2-meta text-v2-ink-soft">
              {t('customer-app:v2.result.waiting', { count: waitingCount })}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Team ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-shop-team" className="v2-plate overflow-hidden">
        <div className="px-4 py-3 md:px-5">
          <h2 id="v2-shop-team" className="text-v2-title font-semibold text-v2-ink">
            {t('customer-app:v2.shopProfile.team')}
          </h2>
        </div>

        {teamAtLocation.length > 0 ? (
          <ul>
            {teamAtLocation.map((member) => (
              <li key={member.barberId} className="border-t border-v2-hairline">
                {/*
                  Team members link to their SOCIAL profile — the only sanctioned
                  discovery path for staff since R5R.1A-R2 removed them from
                  marketplace supply.
                */}
                <Link
                  to={v2BarberProfilePath(slug ?? '', member.barberId)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-v2-ground md:px-5"
                >
                  <IdentityTile
                    src={member.avatarUrl}
                    alt=""
                    kind="barber"
                    className="h-12 w-12 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-v2-body font-medium text-v2-ink">
                      <bdi>{member.displayName}</bdi>
                    </span>
                    {member.title ? (
                      <span className="block truncate text-v2-meta text-v2-ink-soft">
                        {member.title}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : team.isPending ? (
          <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
            <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
          </div>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('customer-app:v2.shopProfile.noTeam')}
          </p>
        )}
      </section>

      {/* ── Services ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-shop-services" className="v2-plate overflow-hidden">
        <div className="px-4 py-3 md:px-5">
          <h2 id="v2-shop-services" className="text-v2-title font-semibold text-v2-ink">
            {t('customer-app:v2.barberProfile.services')}
          </h2>
        </div>

        {services.data && services.data.length > 0 ? (
          <ul>
            {services.data.map((service) => (
              <li
                key={service.id}
                className="flex items-center gap-3 border-t border-v2-hairline px-4 py-3 md:px-5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-v2-body font-medium text-v2-ink">{service.name}</p>
                  <p className="mt-0.5 text-v2-meta text-v2-ink-soft">
                    {t('customer-app:v2.barberProfile.minutes', { count: service.durationMinutes })}
                  </p>
                </div>
                <p className="shrink-0 text-v2-body font-semibold tabular-nums text-v2-ink">
                  {money(service.priceCents, shop.currency)}
                </p>
              </li>
            ))}
          </ul>
        ) : services.isPending ? (
          <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
            <div className="v2-skeleton h-5 w-1/2 rounded-v2-1" />
          </div>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('customer-app:v2.barberProfile.noServices')}
          </p>
        )}
      </section>
    </div>
  )
}
