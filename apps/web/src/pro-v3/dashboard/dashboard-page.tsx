/**
 * FadeUp V3 — Pro dashboard as an operational worklist: NOW, QUEUE, NEXT.
 *
 * The day is a worklist, not a KPI wall. Every number is a real row narrowed
 * to the active scope on the row's OWN locationId; the 30-day strip is the
 * analytics summary verbatim (organization-wide — the contract has no
 * location parameter and the panel says so when a location scope is active).
 * Deliberately absent, as audited: revenue, expected takings (needs
 * product-owner sign-off), margin, forecast.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useDocumentMeta } from '@/lib/use-document-meta'
import { useOrgAppointmentsForDate, type Appointment } from '@/lib/queries/appointments'
import { useOrgQueue } from '@/lib/queries/queue'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { hasAnyActivity, useOrganizationAnalyticsSummary } from '@/lib/queries/analytics-summary'
import { todayInZone } from '@/lib/calendar/time'
import { useProV3Scope } from '@/pro-v3/shell/pro-v3-shell'
import { PRO_V3_ROUTES } from '@/pro-v3/routes'

export function ProV3DashboardPage() {
  const { t, i18n } = useTranslation('v3')
  const scope = useProV3Scope()

  /* "Today" is the SHOP's day, not the browser's — the same rule the
     calendar already enforces. */
  const timezone =
    scope.locations.find((l) => l.id === scope.locationId)?.timezone ??
    scope.locations[0]?.timezone ??
    'UTC'
  const today = useMemo(() => todayInZone(timezone), [timezone])
  const appointments = useOrgAppointmentsForDate(scope.organizationId, today)
  const queue = useOrgQueue(scope.organizationId)
  const barbers = useOrgBarbers(scope.organizationId)
  const staffProfiles = useOrgStaffProfiles(scope.organizationId)
  const summary = useOrganizationAnalyticsSummary(scope.organizationId)

  useDocumentMeta({ title: t('pro.dashboard.metaTitle'), description: t('pro.dashboard.metaDescription'), noIndex: true })

  const inScope = <T extends { locationId: string }>(rows: T[] | undefined): T[] =>
    (rows ?? []).filter((row) => !scope.locationId || row.locationId === scope.locationId)

  const todays = inScope(appointments.data)
    .slice()
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  /* Queue order IS creation order for waiting entries — the ordinal below is
     the list's own order, not an invented position field. */
  const waiting = inScope(queue.data)
    .filter((entry) => entry.status === 'waiting')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  /* NOW = genuinely in the chair or within the 15-minute lead window;
     everything else still ahead is NEXT. */
  const now = Date.now()
  const LEAD_MS = 15 * 60_000
  const live = todays.filter(
    (a) => a.status !== 'cancelled' && a.status !== 'no_show' && new Date(a.endsAt).getTime() > now,
  )
  const nowRows = live.filter((a) => new Date(a.startsAt).getTime() <= now + LEAD_MS)
  const nextRows = live.filter((a) => new Date(a.startsAt).getTime() > now + LEAD_MS)
  const completedToday = todays.filter((a) => a.status === 'completed').length

  const barberName = (barberId: string) => {
    const placement = (barbers.data ?? []).find((entry) => entry.id === barberId)
    if (!placement) return null
    return (
      (staffProfiles.data ?? []).find((profile) => profile.id === placement.staffProfileId)
        ?.displayName ?? null
    )
  }

  const timeFormat = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const dayLabel = new Intl.DateTimeFormat(i18n.language, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())

  const stats = summary.data ?? null

  const appointmentRow = (appointment: Appointment) => {
    const isLive = appointment.status === 'confirmed' || appointment.status === 'pending'
    return (
      <div key={appointment.id} className="v3pro-row">
        <time className="v3-num" dateTime={appointment.startsAt}>
          {timeFormat.format(new Date(appointment.startsAt))}
        </time>
        <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <bdi>{appointment.customerName}</bdi>
          {barberName(appointment.barberId) ? (
            <span style={{ color: 'var(--v3-ink-soft)' }}>
              {' · '}
              <bdi>{barberName(appointment.barberId)}</bdi>
            </span>
          ) : null}
        </span>
        <span data-status={isLive ? 'live' : undefined}>
          {t(`pro.status.${appointment.status}`)}
        </span>
      </div>
    )
  }

  return (
    <div>
      <div className="v3pro-head">
        <div className="v3pro-headline">
          <h1 className="v3-h1">{t('pro.dashboard.today')}</h1>
          <span className="v3-meta">{dayLabel}</span>
        </div>
        {!appointments.isPending ? (
          <div className="v3pro-headline-facts v3-num">
            <span>{t('pro.dashboard.bookings', { count: todays.length })}</span>
            <span>{t('pro.dashboard.done', { count: completedToday })}</span>
            <span>{t('pro.dashboard.waiting', { count: waiting.length })}</span>
          </div>
        ) : null}
      </div>

      <div className="v3pro-worklist">
        <div style={{ display: 'grid', gap: '1rem' }}>
          <section className="v3pro-panel" aria-labelledby="v3pro-now">
            <h2 id="v3pro-now" className="v3pro-panel-title">
              {t('pro.dashboard.now')}
            </h2>
            {appointments.isPending ? (
              <div className="v3-skeleton" style={{ blockSize: '3rem', margin: '0.75rem 1rem' }} aria-hidden="true" />
            ) : nowRows.length > 0 ? (
              nowRows.map(appointmentRow)
            ) : (
              <p className="v3pro-empty">{t('pro.dashboard.noNext')}</p>
            )}
          </section>

          <section className="v3pro-panel" aria-labelledby="v3pro-next">
            <h2 id="v3pro-next" className="v3pro-panel-title">
              {t('pro.dashboard.next')}
            </h2>
            {nextRows.length > 0 ? (
              nextRows.map(appointmentRow)
            ) : (
              <p className="v3pro-empty">{t('pro.dashboard.nothingElse')}</p>
            )}
            <div style={{ borderBlockStart: '1px solid var(--v3-hairline)', padding: '0.625rem 1rem' }}>
              <Link to={PRO_V3_ROUTES.calendar} className="v3a-section-link">
                {t('pro.dashboard.openCalendar')}
              </Link>
            </div>
          </section>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <section className="v3pro-panel" aria-labelledby="v3pro-queue">
            <h2 id="v3pro-queue" className="v3pro-panel-title">
              {t('pro.dashboard.queue')}
            </h2>
            {queue.isPending ? (
              <div className="v3-skeleton" style={{ blockSize: '2.5rem', margin: '0.75rem 1rem' }} aria-hidden="true" />
            ) : waiting.length > 0 ? (
              waiting.map((entry, index) => (
                <div key={entry.id} className="v3pro-row" style={{ gridTemplateColumns: 'auto 1fr' }}>
                  <span className="v3pro-queue-pos">{index + 1}</span>
                  <span style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <bdi>{entry.customerName}</bdi>
                  </span>
                </div>
              ))
            ) : (
              <p className="v3pro-empty">{t('pro.dashboard.emptyQueue')}</p>
            )}
          </section>

          <section className="v3pro-panel" aria-labelledby="v3pro-30d">
            <h2 id="v3pro-30d" className="v3pro-panel-title">
              {scope.locationId ? t('pro.dashboard.summaryOrgWide') : t('pro.dashboard.summary')}
            </h2>
            {stats && hasAnyActivity(stats) ? (
              <dl className="v3pro-strip">
                {[
                  { key: 'completed', value: String(stats.appointmentsCompleted) },
                  { key: 'uniqueCustomers', value: String(stats.uniqueCustomers) },
                  { key: 'repeatCustomers', value: String(stats.repeatCustomers) },
                  { key: 'profileViews', value: String(stats.profileViews) },
                  ...(stats.bookingConversionRate !== null
                    ? [
                        {
                          key: 'conversion',
                          value: new Intl.NumberFormat(i18n.language, {
                            style: 'percent',
                            maximumFractionDigits: 0,
                          }).format(stats.bookingConversionRate),
                        },
                      ]
                    : []),
                ].map((cell) => (
                  <div key={cell.key}>
                    <dt>{t(`pro.kpi.${cell.key}`)}</dt>
                    <dd className="v3-num">{cell.value}</dd>
                  </div>
                ))}
              </dl>
            ) : summary.isPending ? (
              <div className="v3-skeleton" style={{ blockSize: '2.5rem', margin: '0.75rem 1rem' }} aria-hidden="true" />
            ) : (
              <p className="v3pro-empty">{t('pro.dashboard.noSummary')}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
