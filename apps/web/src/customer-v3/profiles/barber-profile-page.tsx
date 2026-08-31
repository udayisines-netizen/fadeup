/**
 * FadeUp V3 — barber profile: a social professional identity, not a mini
 * venue page.
 *
 * Instagram grammar within the audited truth gates: PLACEMENT facts (name,
 * title, bio, working-at) always render; PERSON facts (handle, headline,
 * follower count, Follow) render only when the claimed identity resolves
 * through `get_public_professional`. An unclaimed barber gains no social
 * affordances, no fabricated availability and no queue capability — and a
 * barber is never marketplace supply, so this page is reached through the
 * team, links and booking context.
 *
 * Book dominates and carries location + barber into the flow; a service row
 * carries location + barber + service. The professional is never re-asked.
 */
import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/auth-context'
import { useTrackView } from '@/lib/analytics'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useMoney } from '@/lib/intl/use-intl'
import { usePublicOrganization } from '@/lib/queries/public-booking'
import {
  usePublicBarber,
  usePublicBarberServices,
  usePublicProfessionalIdentity,
} from '@/lib/queries/public-barber'
import {
  useFollowProfessional,
  useMyFollowedProfessionals,
  useUnfollowProfessional,
} from '@/lib/queries/follows'
import { v3BookingPath, v3ShopProfilePath } from '@/customer-v3/routes'

export function CustomerV3BarberProfilePage() {
  const { t, i18n } = useTranslation('v3')
  const { slug, barberId } = useParams<{ slug: string; barberId: string }>()
  const { user } = useAuth()
  const money = useMoney()

  const organization = usePublicOrganization(slug)
  const barber = usePublicBarber(slug, barberId)
  const services = usePublicBarberServices(slug, barberId)
  const identity = usePublicProfessionalIdentity(barber.data?.professionalId)

  const follows = useMyFollowedProfessionals(Boolean(user))
  const follow = useFollowProfessional()
  const unfollow = useUnfollowProfessional()

  const professionalId = barber.data?.professionalId ?? null
  const isFollowing = useMemo(
    () => Boolean(professionalId && follows.data?.some((f) => f.id === professionalId)),
    [follows.data, professionalId],
  )

  useTrackView(
    'public_profile_viewed',
    {
      properties: { profile_type: 'professional' },
      context: { organizationId: organization.data?.id ?? null, barberId: barberId ?? null },
    },
    Boolean(organization.data?.id && barber.data),
  )

  useDocumentMeta({
    title: barber.data
      ? t('profile.barber.metaTitle', { name: barber.data.displayName })
      : t('profile.shop.metaFallback'),
    description: t('profile.barber.metaDescription'),
    noIndex: true,
  })

  if (organization.isError || barber.isError) {
    return (
      <p className="v3a-error" role="alert">
        {t('app.errors.load')}
      </p>
    )
  }

  if (barber.data === null || organization.data === null) {
    return (
      <div className="v3a-empty">
        <p className="v3a-empty-title">{t('profile.barber.notFoundTitle')}</p>
        <p className="v3-meta">{t('profile.barber.notFoundBody')}</p>
      </div>
    )
  }

  if (!barber.data || !organization.data) {
    return (
      <div className="v3p-page" aria-hidden="true">
        <div className="v3p-header">
          <div className="v3-skeleton" style={{ inlineSize: 88, blockSize: 88, borderRadius: 999 }} />
          <div className="v3p-id">
            <span className="v3-skeleton" style={{ inlineSize: '40%', blockSize: '1.5rem' }} />
            <span className="v3-skeleton" style={{ inlineSize: '55%', blockSize: '0.9rem' }} />
          </div>
        </div>
      </div>
    )
  }

  const person = barber.data
  const shop = organization.data
  const claimed = identity.data ?? null
  const bookPath = v3BookingPath(shop.slug, {
    locationId: person.locationId,
    barberId: person.barberId,
  })

  const followerCount =
    claimed && claimed.followerCount > 0
      ? new Intl.NumberFormat(i18n.language).format(claimed.followerCount)
      : null

  return (
    <div className="v3p-page">
      <header className="v3p-header">
        <span className="v3p-avatar" aria-hidden="true">
          {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : <PersonGlyph />}
        </span>
        <div className="v3p-id">
          <h1 className="v3p-name">
            <bdi>{person.displayName}</bdi>
            {claimed ? (
              <span
                className="v3p-claimed"
                role="img"
                aria-label={t('profile.barber.claimedIdentity')}
              >
                <CheckGlyph />
              </span>
            ) : null}
          </h1>
          {claimed?.handle ? <p className="v3p-handle">@{claimed.handle}</p> : null}
          {claimed?.headline ? <p className="v3-meta">{claimed.headline}</p> : person.title ? (
            <p className="v3-meta">{person.title}</p>
          ) : null}
          {followerCount ? (
            <p className="v3-meta">
              <strong className="v3-num" style={{ color: 'var(--v3-ink)' }}>
                {followerCount}
              </strong>{' '}
              {t('profile.barber.followers')}
            </p>
          ) : null}
          <Link to={v3ShopProfilePath(shop.slug, person.locationId)} className="v3p-working-at">
            {t('profile.barber.workingAt', { name: shop.name })}
          </Link>
        </div>
      </header>

      <div className="v3p-actions">
        <Link to={bookPath} className="v3-btn v3-btn--book v3-press">
          {t('landing.result.book')}
        </Link>
        {user && claimed ? (
          <button
            type="button"
            className="v3-btn v3-btn--quiet v3-press"
            aria-pressed={isFollowing}
            disabled={follow.isPending || unfollow.isPending}
            onClick={() =>
              isFollowing ? unfollow.mutate(claimed.id) : follow.mutate(claimed.id)
            }
          >
            {isFollowing ? t('landing.follow.following') : t('landing.follow.follow')}
          </button>
        ) : null}
      </div>

      {(claimed?.bio ?? person.bio) ? (
        <section className="v3p-section">
          <p className="v3-body" style={{ maxInlineSize: '38rem' }}>
            {claimed?.bio ?? person.bio}
          </p>
        </section>
      ) : null}

      <section className="v3p-section" aria-labelledby="v3p-barber-services">
        <h2 id="v3p-barber-services" className="v3p-section-title">
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
                  <span className="v3-meta">{t('profile.minutes', { count: service.durationMinutes })}</span>
                </div>
                <span className="v3p-service-price v3-num">{money(service.priceCents, shop.currency)}</span>
                <Link
                  to={v3BookingPath(shop.slug, {
                    locationId: person.locationId,
                    barberId: person.barberId,
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

      {/* Portfolio: no work-items contract exists — one honest line, no empty
          media chrome. The grid mounts the day the contract lands. */}
      <section className="v3p-section" aria-labelledby="v3p-barber-work">
        <h2 id="v3p-barber-work" className="v3p-section-title">
          {t('profile.barber.work')}
        </h2>
        <p className="v3-meta">{t('profile.barber.noWork')}</p>
      </section>
    </div>
  )
}

function PersonGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.5c1.6-3.2 4-4.5 7-4.5s5.4 1.3 7 4.5" strokeLinecap="round" />
    </svg>
  )
}

function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
      <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
