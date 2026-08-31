import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, MapPin, Share } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useTrackView } from '@/lib/analytics'
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
import { V2_ROUTES, v2BarberProfilePath, v2BookingPath } from '@/customer-v2/routes'

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
 * COVER/GALLERY — `organizations` has no image column (recorded as D-2);
 * per Design Pass A, NO empty media chrome is reserved — the header is
 * typographic, and a Fresha-style gallery composition mounts above it the
 * day a venue-media contract exists. HOURS — `location_hours` is not
 * anon-readable, so no public opening-hours section is invented.
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
  /* Sticky-Book state must be unconditional — declared here, used after the
     early returns. */
  const [stickyBook, setStickyBook] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const organizationId = organization.data?.id ?? null
  const isFollowing = useMemo(
    () =>
      Boolean(organizationId && followedOrgs.data?.some((f) => f.organizationId === organizationId)),
    [followedOrgs.data, organizationId],
  )

  /* Same R3 event the legacy profile records — the funnel the pro analytics
     page reads must not go dark when v2 replaces that surface. */
  useTrackView(
    'public_profile_viewed',
    {
      properties: { profile_type: 'organization' },
      context: { organizationId },
    },
    Boolean(organizationId),
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
      <div className="mx-auto max-w-[40rem] pt-11">
        {/* Matches the typographic header: tile, name, address, action pair. */}
        <div className="flex items-start gap-4">
          <div className="v2-skeleton h-16 w-16 shrink-0 rounded-v2-2" />
          <div className="min-w-0 flex-1 pt-1">
            <div className="v2-skeleton h-6 w-2/5 rounded-v2-1" />
            <div className="v2-skeleton mt-2 h-4 w-3/5 rounded-v2-1" />
          </div>
        </div>
        <div className="mt-4 flex gap-2.5">
          <div className="v2-skeleton h-11 flex-1 rounded-v2-2" />
          <div className="v2-skeleton h-11 w-28 rounded-v2-2" />
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

  /*
    Sticky Book (mobile): once the header's own Book scrolls away, a compact
    bar keeps the conversion action one thumb-reach away — Fresha's persistent
    Book, above the tab bar. IntersectionObserver on the identity section, so
    the bar exists only while the primary Book is genuinely off screen.
  */
  const identityRef = (node: HTMLElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    const observer = new IntersectionObserver(
      ([entry]) => setStickyBook(!entry.isIntersecting),
      { rootMargin: '-56px 0px 0px 0px' },
    )
    observer.observe(node)
    observerRef.current = observer
  }

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
    <div className="mx-auto flex max-w-[40rem] flex-col">
      {/* ── Back / Share (Fresha venue IA, Design Pass A §4) ─────────────── */}
      <div className="-ms-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(V2_ROUTES.marketplace))}
          className="v2-press inline-flex h-11 items-center gap-1 rounded-v2-2 px-2 text-v2-meta font-medium text-v2-ink-soft hover:text-v2-ink"
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={2} aria-hidden="true" />
          {t('customer-app:v2.shopProfile.back')}
        </button>
        <ShareControl name={displayName} />
      </div>

      {/*
        ── Establishment identity ─────────────────────────────────────────
        Typographic, on the canvas. The empty cover band is gone — the brief
        bans reserving media chrome no real media can fill; a venue gallery
        composition slots in above this block the day a media contract exists.
      */}
      <section className="border-b border-v2-hairline pb-4 pt-1">
        <div className="flex items-start gap-4">
          <IdentityTile
            src={null}
            alt=""
            kind="shop"
            name={displayName}
            className="h-16 w-16 shrink-0 text-[1.15rem] md:h-20 md:w-20 md:text-[1.3rem]"
          />
          <div className="min-w-0 flex-1 pt-1">
            <h1 className="text-v2-lead font-semibold tracking-[-0.01em] text-v2-ink lg:text-v2-heading">
              <bdi>{displayName}</bdi>
            </h1>
          </div>
        </div>
        <div>

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

          <div ref={identityRef} className="mt-4 flex items-center gap-2.5">
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
              {' · '}
              {t('customer-app:v2.queue.joinExplainer')}
            </p>
          ) : null}

          {follow.isError || unfollow.isError ? (
            <p role="alert" className="mt-2 text-v2-meta font-medium text-v2-alert">
              {t('customer-app:v2.errors.actionFailed')}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── Services ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-shop-services" className="pb-1 pt-4">
        <div className="pb-1.5">
          <h2 id="v2-shop-services" className="text-v2-title font-semibold text-v2-ink">
            {t('customer-app:v2.barberProfile.services')}
          </h2>
        </div>

        {services.data && services.data.length > 0 ? (
          <ul>
            {/* Each row IS the booking entry for that service — the flow never
                asks for a decision the profile already answered. */}
            {services.data.map((service) => (
              <li key={service.id} className="border-t border-v2-hairline">
                <Link
                  to={v2BookingPath(slug ?? '', {
                    locationId: activeLocation?.id,
                    serviceId: service.id,
                  })}
                  className="v2-press flex items-center gap-3 py-3 hover:bg-v2-ground"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-v2-body font-medium text-v2-ink">{service.name}</p>
                    <p className="mt-0.5 text-v2-meta text-v2-ink-soft">
                      {t('customer-app:v2.barberProfile.minutes', {
                        count: service.durationMinutes,
                      })}
                    </p>
                  </div>
                  <p className="shrink-0 text-v2-body font-semibold tabular-nums text-v2-ink">
                    {money(service.priceCents, shop.currency)}
                  </p>
                  {/* Fresha service-row grammar: the row states its own action. */}
                  <span className="shrink-0 rounded-v2-1 border border-v2-hairline px-2.5 py-1 text-v2-meta font-semibold text-v2-green">
                    {t('customer-app:v2.result.book')}
                  </span>
                </Link>
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

      {/* ── Team ─────────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-shop-team" className="border-t border-v2-hairline pb-1 pt-4">
        <div className="pb-1.5">
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
                  className="flex items-center gap-3 py-3 hover:bg-v2-ground"
                >
                  <IdentityTile
                    src={member.avatarUrl}
                    alt=""
                    kind="barber"
                    name={member.displayName}
                    className="h-12 w-12 shrink-0 text-[0.95rem]"
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

      {stickyBook ? (
        <div className="v2-book-bar lg:hidden">
          <div className="mx-auto flex max-w-[40rem] items-center gap-3 px-4 py-2.5">
            <p className="min-w-0 flex-1 truncate text-v2-meta font-semibold text-v2-ink">
              <bdi>{displayName}</bdi>
            </p>
            <Link
              to={bookPath}
              className="v2-press inline-flex h-11 shrink-0 items-center justify-center rounded-v2-2 bg-v2-green px-6 text-v2-body font-semibold text-v2-paper"
            >
              {t('customer-app:v2.result.book')}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Share — the native share sheet when the platform has one, the clipboard
 * when it does not, and a quiet confirmation either way. Shares only the
 * page's own URL: real data, nothing else.
 */
function ShareControl({ name }: { name: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const share = async () => {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ title: name, url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* The customer dismissed the sheet — not an error worth announcing. */
    }
  }

  return (
    <button
      type="button"
      onClick={() => void share()}
      className="v2-press -me-2 inline-flex h-11 items-center gap-1.5 rounded-v2-2 px-2 text-v2-meta font-medium text-v2-ink-soft hover:text-v2-ink"
    >
      <Share className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
      <span aria-live="polite">
        {copied ? t('customer-app:v2.shopProfile.linkCopied') : t('customer-app:v2.shopProfile.share')}
      </span>
    </button>
  )
}
