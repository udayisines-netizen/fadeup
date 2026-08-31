/**
 * FadeUp V3 — barbershop (venue) profile.
 *
 * A premium venue commerce page: identity, real queue line, services as the
 * commercial center, a human team rail, and Book everywhere with maximal
 * context. Truthful absences hold exactly as audited: no open state (not on
 * these contracts), no rating (no reviews domain), no gallery chrome (no
 * media contract), no public hours (authenticated-only table). The site
 * switcher flattens multi-location orgs without ever naming the group.
 *
 * Desktop: content left, sticky Book/Follow rail right. Mobile: sticky
 * bottom Book bar with the real from-price once the header scrolls away.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

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
import { v3BarberProfilePath, v3BookingPath, v3ShopProfilePath } from '@/customer-v3/routes'

export function CustomerV3ShopProfilePage() {
  const { t } = useTranslation('v3')
  const { slug } = useParams<{ slug: string }>()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const money = useMoney()

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

  const organizationId = organization.data?.id ?? null
  const isFollowing = useMemo(
    () => Boolean(organizationId && followedOrgs.data?.some((f) => f.organizationId === organizationId)),
    [followedOrgs.data, organizationId],
  )

  /* Sticky Book appears once the header's actions scroll off (mobile). */
  const actionsRef = useRef<HTMLDivElement | null>(null)
  const [stickyBook, setStickyBook] = useState(false)
  useEffect(() => {
    const node = actionsRef.current
    if (!node) return
    const observer = new IntersectionObserver(([entry]) => setStickyBook(!entry.isIntersecting), {
      rootMargin: '-56px 0px 0px 0px',
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [organization.data])

  useTrackView(
    'public_profile_viewed',
    { properties: { profile_type: 'organization' }, context: { organizationId } },
    Boolean(organizationId),
  )

  useDocumentMeta({
    title: organization.data
      ? t('profile.shop.metaTitle', { name: organization.data.name })
      : t('profile.shop.metaFallback'),
    description: t('profile.shop.metaDescription'),
    noIndex: true,
  })

  if (organization.isError || locations.isError) {
    return (
      <p className="v3a-error" role="alert">
        {t('app.errors.load')}
      </p>
    )
  }

  if (organization.data === null) {
    return (
      <div className="v3a-empty">
        <p className="v3a-empty-title">{t('profile.shop.notFoundTitle')}</p>
        <p className="v3-meta">{t('profile.shop.notFoundBody')}</p>
      </div>
    )
  }

  if (!organization.data || !activeLocation) {
    return (
      <div className="v3p-page" aria-hidden="true">
        <div className="v3p-header">
          <div className="v3-skeleton" style={{ inlineSize: 72, blockSize: 72 }} />
          <div className="v3p-id">
            <span className="v3-skeleton" style={{ inlineSize: '45%', blockSize: '1.5rem' }} />
            <span className="v3-skeleton" style={{ inlineSize: '60%', blockSize: '0.9rem' }} />
          </div>
        </div>
      </div>
    )
  }

  const shop = organization.data
  const siteName = activeLocation.name !== shop.name ? activeLocation.name : shop.name
  const address = [activeLocation.addressLine1, activeLocation.city].filter(Boolean).join(' · ')
  const waiting = (queue.data ?? []).filter((entry) => entry.status === 'waiting').length
  const fromPrice =
    (services.data ?? []).length > 0
      ? money(Math.min(...(services.data ?? []).map((s) => s.priceCents)), shop.currency, {
          trimWholeAmounts: true,
        })
      : null
  const siblingSites = (locations.data ?? []).filter((l) => l.id !== activeLocation.id)
  const teamHere = (team.data ?? []).filter(
    (member) => member.locationId === null || member.locationId === activeLocation.id,
  )

  const bookPath = v3BookingPath(shop.slug, { locationId: activeLocation.id })

  const followControl = user ? (
    <button
      type="button"
      className="v3-btn v3-btn--quiet v3-press"
      aria-pressed={isFollowing}
      disabled={follow.isPending || unfollow.isPending}
      onClick={() =>
        isFollowing ? unfollow.mutate(shop.id) : follow.mutate(shop.id)
      }
    >
      {isFollowing ? t('landing.follow.following') : t('landing.follow.follow')}
    </button>
  ) : null

  return (
    <div className="v3p-page">
      <header className="v3p-header">
        <span className="v3p-tile" aria-hidden="true">
          <StorefrontGlyph />
        </span>
        <div className="v3p-id">
          <h1 className="v3p-name">
            <bdi>{siteName}</bdi>
          </h1>
          {address ? (
            <p className="v3-meta">
              <bdi>{address}</bdi>
            </p>
          ) : null}
          {waiting > 0 ? (
            <p className="v3p-queue-line">
              <span className="v3-live-dot" aria-hidden="true" />
              {t('profile.shop.queueLine', { count: waiting })}
            </p>
          ) : null}
        </div>
      </header>

      {siblingSites.length > 0 ? (
        <div className="v3a-chips" aria-label={t('profile.shop.sitesLabel')}>
          <span className="v3-chip" data-selected="true">
            <bdi>{siteName}</bdi>
          </span>
          {siblingSites.map((site) => (
            <Link key={site.id} to={v3ShopProfilePath(shop.slug, site.id)} className="v3-chip v3-press">
              <bdi>{site.name}</bdi>
            </Link>
          ))}
        </div>
      ) : null}

      <div className="v3p-grid">
        <div>
          <div className="v3p-actions" ref={actionsRef}>
            <Link to={bookPath} className="v3-btn v3-btn--book v3-press">
              {fromPrice
                ? t('profile.shop.bookFrom', { price: fromPrice })
                : t('landing.result.book')}
            </Link>
            {followControl}
          </div>

          <section className="v3p-section" aria-labelledby="v3p-services-title">
            <h2 id="v3p-services-title" className="v3p-section-title">
              {t('profile.shop.services')}
            </h2>
            {services.isPending ? (
              <div className="v3-skeleton" style={{ blockSize: '3rem' }} aria-hidden="true" />
            ) : (services.data ?? []).length === 0 ? (
              <p className="v3-meta">{t('profile.shop.noServices')}</p>
            ) : (
              <div>
                {(services.data ?? []).map((service) => (
                  <div key={service.id} className="v3p-service">
                    <div className="v3p-service-info">
                      <span className="v3p-service-name">{service.name}</span>
                      <span className="v3-meta">
                        {t('profile.minutes', { count: service.durationMinutes })}
                      </span>
                    </div>
                    <span className="v3p-service-price v3-num">
                      {money(service.priceCents, shop.currency)}
                    </span>
                    <Link
                      to={v3BookingPath(shop.slug, {
                        locationId: activeLocation.id,
                        serviceId: service.id,
                      })}
                      className="v3-btn v3-btn--quiet v3-press"
                      aria-label={t('profile.shop.bookService', { name: service.name })}
                    >
                      {t('landing.result.book')}
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </section>

          {teamHere.length > 0 ? (
            <section className="v3p-section" aria-labelledby="v3p-team-title">
              <h2 id="v3p-team-title" className="v3p-section-title">
                {t('profile.shop.team')}
              </h2>
              <div className="v3p-team">
                {teamHere.map((member) => (
                  <Link
                    key={member.barberId}
                    to={v3BarberProfilePath(shop.slug, member.barberId)}
                    className="v3p-team-card v3-press"
                  >
                    <span className="v3p-team-avatar" aria-hidden="true">
                      {member.avatarUrl ? <img src={member.avatarUrl} alt="" /> : <PersonGlyph />}
                    </span>
                    <span className="v3p-team-name">
                      <bdi>{member.displayName}</bdi>
                    </span>
                    {member.title ? <span className="v3p-team-title">{member.title}</span> : null}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="v3p-rail v3-float">
          <Link to={bookPath} className="v3-btn v3-btn--book v3-press">
            {fromPrice ? t('profile.shop.bookFrom', { price: fromPrice }) : t('landing.result.book')}
          </Link>
          {followControl}
          {address ? (
            <p className="v3-meta">
              <bdi>{address}</bdi>
            </p>
          ) : null}
        </aside>
      </div>

      {stickyBook ? (
        <div className="v3p-sticky v3-enter">
          <span className="v3p-sticky-price">
            <bdi>{siteName}</bdi>
            {fromPrice ? ` · ${t('landing.result.from', { price: fromPrice })}` : ''}
          </span>
          <Link to={bookPath} className="v3-btn v3-btn--book v3-press">
            {t('landing.result.book')}
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function StorefrontGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4.5 9.5 5.6 5h12.8l1.1 4.5M4.5 9.5v9A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-9M4.5 9.5h15M9.5 20v-5h5v5" strokeLinejoin="round" />
    </svg>
  )
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.6-3.2 4-4.5 7-4.5s5.4 1.3 7 4.5" strokeLinecap="round" />
    </svg>
  )
}
