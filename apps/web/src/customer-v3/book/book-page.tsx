/**
 * FadeUp V3 — Book tab: the fastest path back to a chair.
 *
 * Rebooking-first: real completed history becomes Book-again cards carrying
 * location + barber; below, one search entry into the marketplace. Nothing
 * is recommended that no contract ranks; anonymous visitors get search.
 */
import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/auth-context'
import { useMyAppointments, bookingStage, type MyAppointment } from '@/lib/queries/customer-app'
import { useDateTime } from '@/lib/intl/use-intl'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { V3_ROUTES, v3BookingPath } from '@/customer-v3/routes'

export function CustomerV3BookPage() {
  const { t } = useTranslation('v3')
  useDocumentMeta({ title: t('book.metaTitle'), description: t('book.metaDescription'), noIndex: true })

  const { user } = useAuth()
  const navigate = useNavigate()
  const appointments = useMyAppointments(Boolean(user), user?.id)
  const dt = useDateTime()

  const bookAgain = useMemo(() => {
    const seen = new Set<string>()
    const again: MyAppointment[] = []
    for (const a of appointments.data ?? []) {
      if (bookingStage(a) !== 'completed') continue
      const key = `${a.organizationId}:${a.barberId ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      again.push(a)
      if (again.length >= 8) break
    }
    return again
  }, [appointments.data])

  return (
    <div className="v3ap-page">
      <header className="v3a-page-head">
        <h1 className="v3-h1">{t('book.title')}</h1>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4.5 4.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            name="q"
            placeholder={t('landing.search.whatPlaceholder')}
            aria-label={t('landing.search.whatLabel')}
          />
        </label>
      </form>

      {appointments.isError ? (
        <p className="v3a-error" role="alert" style={{ marginBlockStart: '1rem' }}>
          {t('app.errors.load')}
        </p>
      ) : user && appointments.isPending ? (
        <div className="v3-skeleton" style={{ blockSize: '5rem', marginBlockStart: '1rem' }} aria-hidden="true" />
      ) : bookAgain.length > 0 ? (
        <section className="v3a-section" aria-labelledby="v3bk-again">
          <div className="v3a-section-head">
            <h2 id="v3bk-again" className="v3a-section-title">
              {t('app.home.bookAgain')}
            </h2>
          </div>
          <div className="v3a-results">
            {bookAgain.map((appointment) => (
              <div key={appointment.id} className="v3a-row">
                <div className="v3a-row-link">
                  <span className="v3a-row-name">
                    <bdi>{appointment.locationName}</bdi>
                  </span>
                  <span className="v3a-row-meta">
                    {appointment.barberDisplayName ? <span>{appointment.barberDisplayName}</span> : null}
                    {appointment.serviceName ? <span>{appointment.serviceName}</span> : null}
                    <span>{dt.date(appointment.startsAt, appointment.locationTimezone)}</span>
                  </span>
                </div>
                <Link
                  to={v3BookingPath(appointment.organizationSlug, {
                    locationId: appointment.locationId,
                    barberId: appointment.barberId,
                  })}
                  className="v3-btn v3-btn--book v3-press v3a-row-book"
                >
                  {t('app.home.bookAgainCta')}
                </Link>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className="v3a-empty">
          <p className="v3a-empty-title">{t('book.emptyTitle')}</p>
          <p className="v3-meta">{t('book.emptyBody')}</p>
          <Link to={V3_ROUTES.marketplace} className="v3-btn v3-btn--book v3-press">
            {t('landing.discovery.viewAll')}
          </Link>
        </div>
      )}
    </div>
  )
}
