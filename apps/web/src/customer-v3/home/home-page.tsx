/**
 * FadeUp V3 — signed-in customer Home.
 *
 * A returning customer never sees the marketing landing again: Home is
 * personal (FADEUP_VISUAL_V3_DIRECTION.md §13, brief §41). The hierarchy is
 * strictly real-data-gated: NEXT renders only with a live upcoming
 * appointment, BOOK AGAIN only with completed history, NEAR YOU from the
 * live search RPC. No invented rails, no fake sections; anonymous visitors
 * get discovery and search and nothing personal.
 */
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/auth-context'
import {
  useMyAppointments,
  bookingStage,
  isLiveStage,
  type MyAppointment,
} from '@/lib/queries/customer-app'
import {
  useSearchPublicProfessionals,
  usePublicCurrencies,
} from '@/lib/queries/marketplace'
import { useCustomerLocation } from '@/customer-v3/hooks/use-customer-location'
import { useDateTime } from '@/lib/intl/use-intl'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { V3_ROUTES, v3BookingPath } from '@/customer-v3/routes'
import { ResultRow } from '@/customer-v3/ui/result-row'
import { LocationScope } from '@/customer-v3/ui/location-scope'

const NEAR_YOU_LIMIT = 6

export function CustomerV3HomePage() {
  const { t } = useTranslation('v3')
  useDocumentMeta({ title: t('app.home.metaTitle'), description: t('app.home.metaDescription'), noIndex: true })

  const { user } = useAuth()
  const location = useCustomerLocation()
  const navigate = useNavigate()

  const appointments = useMyAppointments(Boolean(user), user?.id)

  const { next, bookAgain } = useMemo(() => {
    const rows = appointments.data ?? []
    const now = Date.now()
    const upcoming = rows
      .filter((a) => isLiveStage(bookingStage(a)) && new Date(a.startsAt).getTime() > now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    /* Book again: most recent completed visit per organization+barber pair. */
    const seen = new Set<string>()
    const again: MyAppointment[] = []
    for (const a of rows) {
      if (bookingStage(a) !== 'completed') continue
      const key = `${a.organizationId}:${a.barberId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      again.push(a)
      if (again.length >= 6) break
    }
    return { next: upcoming[0] ?? null, bookAgain: again }
  }, [appointments.data])

  const discovery = useSearchPublicProfessionals(
    {
      country: location.isAnywhere ? null : location.countryCode,
      latitude: location.coordinates?.latitude ?? null,
      longitude: location.coordinates?.longitude ?? null,
      sort: location.coordinates ? 'nearest' : 'recommended',
      entityType: 'shop',
      limit: NEAR_YOU_LIMIT,
    },
    { keepPreviousData: true },
  )
  const results = discovery.data ?? []
  const currencies = usePublicCurrencies(results.map((r) => r.organizationId))

  return (
    <div>
      <header className="v3a-page-head">
        <h1 className="v3a-greeting">{t('app.home.greeting')}</h1>
      </header>

      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          const value = new FormData(event.currentTarget).get('q')
          const query = typeof value === 'string' && value.trim() ? `?q=${encodeURIComponent(value.trim())}` : ''
          navigate(`${V3_ROUTES.marketplace}${query}`)
        }}
      >
        <label className="v3a-search">
          <SearchIcon />
          <input
            type="search"
            name="q"
            placeholder={t('landing.search.whatPlaceholder')}
            aria-label={t('landing.search.whatLabel')}
          />
        </label>
      </form>

      <LocationScope location={location} />

      {next ? <NextAppointment appointment={next} /> : null}

      <section className="v3a-section" aria-labelledby="v3a-near-title">
        <div className="v3a-section-head">
          <h2 id="v3a-near-title" className="v3a-section-title">
            {location.precision === 'precise'
              ? t('app.home.nearYou')
              : location.countryLabel && !location.isAnywhere
                ? t('app.home.inCountry', { country: location.countryLabel })
                : t('app.home.discover')}
          </h2>
          <Link to={V3_ROUTES.marketplace} className="v3a-section-link">
            {t('app.home.seeAll')}
          </Link>
        </div>
        {discovery.isError ? (
          <p className="v3a-error" role="alert">
            {t('app.errors.load')}
          </p>
        ) : discovery.isPending ? (
          <div className="v3a-results" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="v3a-skeleton-row">
                <span className="v3-skeleton" style={{ inlineSize: '40%', blockSize: '1.1rem' }} />
                <span className="v3-skeleton" style={{ inlineSize: '62%', blockSize: '0.85rem' }} />
              </div>
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="v3a-empty">
            <p className="v3a-empty-title">{t('app.home.emptyTitle')}</p>
            <p className="v3-meta">{t('app.home.emptyBody')}</p>
          </div>
        ) : (
          <div className="v3a-results">
            {results.map((result) => (
              <ResultRow
                key={result.locationId}
                result={result}
                currency={currencies[result.organizationId]}
              />
            ))}
          </div>
        )}
      </section>

      {bookAgain.length > 0 ? (
        <section className="v3a-section" aria-labelledby="v3a-again-title">
          <div className="v3a-section-head">
            <h2 id="v3a-again-title" className="v3a-section-title">
              {t('app.home.bookAgain')}
            </h2>
          </div>
          <div className="v3a-again-rail">
            {bookAgain.map((appointment) => (
              <BookAgainCard key={appointment.id} appointment={appointment} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

function NextAppointment({ appointment }: { appointment: MyAppointment }) {
  const { t } = useTranslation('v3')
  const dt = useDateTime()
  const stage = bookingStage(appointment)

  const what = [appointment.serviceName, appointment.barberDisplayName, appointment.locationName]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="v3a-section" aria-labelledby="v3a-next-title">
      <div className="v3a-section-head">
        <h2 id="v3a-next-title" className="v3a-section-title">
          {t('app.home.next')}
        </h2>
      </div>
      <Link to={V3_ROUTES.appointments} className="v3a-next v3-float v3-press">
        <span className="v3a-next-when">
          <time className="v3-num" dateTime={appointment.startsAt}>
            {dt.dateTime(appointment.startsAt, appointment.locationTimezone)}
          </time>
          <span className="v3a-next-stage">
            {stage === 'confirmed' ? t('app.home.stageConfirmed') : t('app.home.stageWaiting')}
          </span>
        </span>
        <span className="v3a-next-what">{what}</span>
      </Link>
    </section>
  )
}

function BookAgainCard({ appointment }: { appointment: MyAppointment }) {
  const { t } = useTranslation('v3')
  const dt = useDateTime()

  return (
    <Link
      to={v3BookingPath(appointment.organizationSlug, {
        locationId: appointment.locationId,
        barberId: appointment.barberId,
      })}
      className="v3a-again v3-press"
    >
      <span className="v3a-row-name">{appointment.locationName}</span>
      <span className="v3a-row-meta">
        {appointment.barberDisplayName ? <span>{appointment.barberDisplayName}</span> : null}
        {appointment.serviceName ? <span>{appointment.serviceName}</span> : null}
        <span>{dt.date(appointment.startsAt, appointment.locationTimezone)}</span>
      </span>
      <span className="v3-btn v3-btn--quiet" aria-hidden="true">
        {t('app.home.bookAgainCta')}
      </span>
    </Link>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" strokeLinecap="round" />
    </svg>
  )
}
