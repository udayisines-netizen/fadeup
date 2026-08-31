/**
 * FadeUp V3 — Analytics: data is the visual.
 *
 * Controls first (window: 7/30/90 days — the summary RPC takes from/to),
 * then the booking funnel, a product-designed completed-per-day bar chart
 * (real rows bucketed in the viewer's zone, documented), the queue funnel
 * and the audience table with deltas against the previous window of equal
 * length. Location scope narrows only the daily series (the summary
 * contract is organization-wide and the panel says so). No revenue, no
 * margin, no forecast — ever, per the audited gaps.
 */
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useDocumentMeta } from '@/lib/use-document-meta'
import { hasAnyActivity, useOrganizationAnalyticsSummary } from '@/lib/queries/analytics-summary'
import { useCalendarRange } from '@/lib/queries/calendar'
import { useProV3Scope } from '@/pro-v3/shell/pro-v3-shell'

const DAY_MS = 86_400_000
const WINDOW_OPTIONS = [7, 30, 90] as const

export function ProV3AnalyticsPage() {
  const { t, i18n } = useTranslation('v3')
  const scope = useProV3Scope()
  const [windowDays, setWindowDays] = useState<(typeof WINDOW_OPTIONS)[number]>(30)

  /* Stable per window-choice: a key that slides every render defeats the cache. */
  const windows = useMemo(() => {
    const now = Date.now()
    return {
      from: new Date(now - windowDays * DAY_MS).toISOString(),
      to: new Date(now).toISOString(),
      prevFrom: new Date(now - 2 * windowDays * DAY_MS).toISOString(),
    }
  }, [windowDays])

  const summary = useOrganizationAnalyticsSummary(scope.organizationId, {
    from: windows.from,
    to: windows.to,
  })
  const previous = useOrganizationAnalyticsSummary(scope.organizationId, {
    from: windows.prevFrom,
    to: windows.from,
  })
  const calendar = useCalendarRange(
    scope.organizationId,
    { from: windows.from, to: windows.to },
    { locationId: scope.locationId },
  )

  useDocumentMeta({ title: t('pro.analytics.metaTitle'), description: t('pro.analytics.metaDescription'), noIndex: true })

  const stats = summary.data ?? null
  const prev = previous.data ?? null
  const showDeltas = hasAnyActivity(prev)

  const number = new Intl.NumberFormat(i18n.language)
  const signed = new Intl.NumberFormat(i18n.language, { signDisplay: 'always' })
  const percent = new Intl.NumberFormat(i18n.language, { style: 'percent', maximumFractionDigits: 0 })
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })

  /* Per-day completed series — real rows bucketed in the viewer's zone. */
  const daily = useMemo(() => {
    const dayKey = new Intl.DateTimeFormat('en-CA')
    const buckets = new Map<string, number>()
    for (const appointment of calendar.appointments) {
      if (appointment.status !== 'completed') continue
      const key = dayKey.format(new Date(appointment.startsAt))
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const days: Array<{ key: string; date: Date; count: number }> = []
    for (let i = windowDays - 1; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * DAY_MS)
      const key = dayKey.format(date)
      days.push({ key, date, count: buckets.get(key) ?? 0 })
    }
    return days
  }, [calendar.appointments, windowDays])

  const dailyTotal = daily.reduce((total, day) => total + day.count, 0)
  const dailyMax = daily.reduce((max, day) => Math.max(max, day.count), 0)

  const row = (labelKey: string, value: number, before: number | null) => (
    <div key={labelKey} className="v3pro-row" style={{ minBlockSize: 40, gridTemplateColumns: '1fr auto auto' }}>
      <span>{t(`pro.analytics.${labelKey}`)}</span>
      <span className="v3-num">{number.format(value)}</span>
      <span className="v3-meta v3-num" style={{ minInlineSize: '3rem', textAlign: 'end' }}>
        {showDeltas && before !== null ? signed.format(value - before) : ''}
      </span>
    </div>
  )

  return (
    <div>
      <div className="v3pro-head">
        <div className="v3pro-headline">
          <h1 className="v3-h1">{t('pro.nav.analytics')}</h1>
          {scope.locationId ? <span className="v3-meta">{t('pro.analytics.orgWide')}</span> : null}
        </div>
        <div className="v3a-chips" style={{ padding: 0 }} role="group" aria-label={t('pro.analytics.windowLabel')}>
          {WINDOW_OPTIONS.map((days) => (
            <button
              key={days}
              type="button"
              className="v3-chip v3-press"
              aria-pressed={windowDays === days}
              onClick={() => setWindowDays(days)}
            >
              {t('pro.analytics.window', { count: days })}
            </button>
          ))}
        </div>
      </div>

      {summary.isError ? (
        <p className="v3a-error" role="alert">
          {t('app.errors.load')}
        </p>
      ) : summary.isPending ? (
        <div className="v3-skeleton" style={{ blockSize: '6rem' }} aria-hidden="true" />
      ) : !stats || !hasAnyActivity(stats) ? (
        <div className="v3a-empty">
          <p className="v3a-empty-title">{t('pro.analytics.emptyTitle')}</p>
          <p className="v3-meta">{t('pro.analytics.emptyBody')}</p>
        </div>
      ) : (
        <div className="v3an-grid">
          <section className="v3pro-panel" aria-labelledby="v3an-funnel">
            <h2 id="v3an-funnel" className="v3pro-panel-title">
              {t('pro.analytics.funnel')}
            </h2>
            {row('profileViews', stats.profileViews, prev?.profileViews ?? null)}
            {row('bookingStarts', stats.bookingStarts, prev?.bookingStarts ?? null)}
            {row('appointmentsCreated', stats.appointmentsCreated, prev?.appointmentsCreated ?? null)}
            {row('appointmentsCompleted', stats.appointmentsCompleted, prev?.appointmentsCompleted ?? null)}
            {stats.bookingConversionRate !== null ? (
              <div className="v3pro-row" style={{ minBlockSize: 40, gridTemplateColumns: '1fr auto' }}>
                <span style={{ fontWeight: 650 }}>{t('pro.kpi.conversion')}</span>
                <span className="v3-num" style={{ color: 'var(--v3-green-ink)' }}>
                  {percent.format(stats.bookingConversionRate)}
                </span>
              </div>
            ) : null}
          </section>

          <section className="v3pro-panel" aria-labelledby="v3an-daily">
            <h2 id="v3an-daily" className="v3pro-panel-title">
              {t('pro.analytics.daily', { count: dailyTotal })}
            </h2>
            <div className="v3an-chart" role="img" aria-label={t('pro.analytics.dailyLabel', { count: dailyTotal })}>
              {daily.map((day) => (
                <div
                  key={day.key}
                  className="v3an-bar"
                  title={`${dateFormat.format(day.date)} · ${day.count}`}
                >
                  <span
                    style={{
                      blockSize: dailyMax > 0 ? `${Math.max(day.count === 0 ? 0 : 6, (day.count / dailyMax) * 100)}%` : 0,
                    }}
                    data-empty={day.count === 0 || undefined}
                  />
                </div>
              ))}
            </div>
            <div className="v3an-axis v3-meta">
              <span>{dateFormat.format(daily[0]?.date ?? new Date())}</span>
              <span>{dateFormat.format(daily[daily.length - 1]?.date ?? new Date())}</span>
            </div>
          </section>

          <section className="v3pro-panel" aria-labelledby="v3an-queue">
            <h2 id="v3an-queue" className="v3pro-panel-title">
              {t('pro.analytics.queueFunnel')}
            </h2>
            {row('queueViews', stats.queueViews, prev?.queueViews ?? null)}
            {row('queueJoins', stats.queueJoins, prev?.queueJoins ?? null)}
            {row('queueCompletions', stats.queueCompletions, prev?.queueCompletions ?? null)}
            {stats.queueConversionRate !== null ? (
              <div className="v3pro-row" style={{ minBlockSize: 40, gridTemplateColumns: '1fr auto' }}>
                <span style={{ fontWeight: 650 }}>{t('pro.kpi.conversion')}</span>
                <span className="v3-num" style={{ color: 'var(--v3-green-ink)' }}>
                  {percent.format(stats.queueConversionRate)}
                </span>
              </div>
            ) : null}
          </section>

          <section className="v3pro-panel" aria-labelledby="v3an-audience">
            <h2 id="v3an-audience" className="v3pro-panel-title">
              {t('pro.analytics.audience')}
            </h2>
            {row('uniqueCustomers', stats.uniqueCustomers, prev?.uniqueCustomers ?? null)}
            {row('repeatCustomers', stats.repeatCustomers, prev?.repeatCustomers ?? null)}
            {row('follows', stats.follows, prev?.follows ?? null)}
            {row('favorites', stats.favorites, prev?.favorites ?? null)}
          </section>
        </div>
      )}
    </div>
  )
}
