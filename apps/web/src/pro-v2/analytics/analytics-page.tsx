import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/lib/use-document-meta'
import {
  hasAnyActivity,
  useOrganizationAnalyticsSummary,
} from '@/lib/queries/analytics-summary'
import { useCalendarRange } from '@/lib/queries/calendar'
import { Notice } from '@/customer-v2/ui/notice'
import { useProScope } from '@/pro-v2/shell/pro-v2-shell'

/**
 * Analytics — R3's aggregation contracts, finally on a screen of their own.
 *
 * ============================================================================
 * TWO REAL SOURCES, NOTHING ELSE
 * ============================================================================
 *
 * 1. `get_organization_analytics_summary`, called twice: the last 30 days and
 *    the 30 days before that. Every number on the funnel, queue and audience
 *    panels — including both conversion ratios — is the server's own figure,
 *    never recomputed client-side. The delta annotations are the only
 *    arithmetic here: a subtraction of two server aggregates, shown only when
 *    the previous window actually recorded activity (a delta against silence
 *    reads as growth when it is really just the install date).
 *
 * 2. `get_calendar_appointments` over the same 30 days for the per-day
 *    completed series — real appointment rows, location-scoped SERVER-SIDE
 *    via the RPC's own `p_location_id`. Days are bucketed in the viewer's
 *    timezone so the axis and the buckets always agree; an operator views
 *    their own shop from the shop's timezone in every ordinary case.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY MISSING
 * ============================================================================
 *
 * REVENUE / MARGIN / FORECAST. `get_calendar_appointments` joins the price
 * from the SERVICES table — today's price, not what was charged — so summing
 * completed appointments would misstate every visit that predates a price
 * change. Until appointments record the charged amount, revenue analytics
 * have no truthful source (§39). No forecast contract exists either, so none
 * is invented.
 *
 * SCOPE. The summary RPC has no location parameter, so those panels always
 * state the whole organization — labelled as such whenever a location scope
 * is active. Only the daily series narrows with the scope.
 */

const WINDOW_DAYS = 30
const DAY_MS = 86_400_000

export function ProV2AnalyticsPage() {
  const { t, i18n } = useTranslation()
  const scope = useProScope()

  // Instants are computed once per mount: a stable queryKey beats a window
  // that slides a few milliseconds on every render.
  const windows = useMemo(() => {
    const now = Date.now()
    return {
      from: new Date(now - WINDOW_DAYS * DAY_MS).toISOString(),
      to: new Date(now).toISOString(),
      prevFrom: new Date(now - 2 * WINDOW_DAYS * DAY_MS).toISOString(),
    }
  }, [])

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

  useDocumentMeta({
    title: t('app:v2pro.analytics.documentTitle'),
    description: t('app:v2pro.analytics.documentDescription'),
    noIndex: true,
  })

  const stats = summary.data ?? null
  const prev = previous.data ?? null
  const showDeltas = hasAnyActivity(prev)

  const number = new Intl.NumberFormat(i18n.language)
  const signed = new Intl.NumberFormat(i18n.language, { signDisplay: 'always' })
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  })
  const dateFormat = new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' })

  // ── Per-day completed series, real rows bucketed in the viewer's zone ────
  const daily = useMemo(() => {
    const dayKey = new Intl.DateTimeFormat('en-CA')
    const buckets = new Map<string, number>()
    for (const appointment of calendar.appointments) {
      if (appointment.status !== 'completed') continue
      const key = dayKey.format(new Date(appointment.startsAt))
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    const days: Array<{ key: string; date: Date; count: number }> = []
    for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
      const date = new Date(Date.now() - i * DAY_MS)
      const key = dayKey.format(date)
      days.push({ key, date, count: buckets.get(key) ?? 0 })
    }
    return days
  }, [calendar.appointments])

  const dailyTotal = daily.reduce((total, day) => total + day.count, 0)
  const dailyMax = daily.reduce((max, day) => Math.max(max, day.count), 0)

  const delta = (current: number, before: number) => (
    <span className="ms-2 text-v2-caption font-medium tabular-nums text-v2-ink-mute">
      {signed.format(current - before)}
    </span>
  )

  const kpiCell = (key: string, value: number, before: number | null) => (
    <div key={key} className="bg-v2-paper px-4 py-3 md:px-5">
      <dt className="text-v2-caption text-v2-ink-soft">{t(`app:v2pro.analytics.${key}`)}</dt>
      <dd className="mt-0.5 text-v2-lead font-semibold tabular-nums text-v2-ink">
        {number.format(value)}
        {showDeltas && before !== null ? delta(value, before) : null}
      </dd>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
          {t('app:v2pro.nav.analytics')}
        </h1>
        <p className="mt-0.5 text-v2-meta text-v2-ink-soft">
          {t('app:v2pro.analytics.window')}
          {scope.locationId ? <> · {t('app:v2pro.analytics.orgWide')}</> : null}
        </p>
      </div>

      {summary.isError ? (
        <Notice
          tone="failure"
          title={t('customer-app:v2.discovery.errorTitle')}
          body={t('customer-app:v2.discovery.errorBody')}
          actionLabel={t('customer-app:v2.discovery.retry')}
          onAction={() => void summary.refetch()}
        />
      ) : summary.isPending ? (
        <section className="v2-plate p-4 md:p-5">
          <div className="v2-skeleton h-6 w-1/2 rounded-v2-1" />
          <div className="v2-skeleton mt-3 h-6 w-1/3 rounded-v2-1" />
        </section>
      ) : !stats || !hasAnyActivity(stats) ? (
        <Notice
          tone="empty"
          title={t('app:v2pro.analytics.noActivityTitle')}
          body={t('app:v2pro.analytics.noActivityBody')}
          actionLabel={null}
          onAction={null}
        />
      ) : (
        <>
          {/* ── Booking funnel ─────────────────────────────────────────── */}
          <section aria-labelledby="v2pro-funnel" className="v2-plate overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 px-4 py-3 md:px-5">
              <h2 id="v2pro-funnel" className="text-v2-title font-semibold text-v2-ink">
                {t('app:v2pro.analytics.bookingTitle')}
              </h2>
              {stats.bookingConversionRate !== null ? (
                <p className="text-v2-meta font-semibold tabular-nums text-v2-green">
                  {t('app:v2pro.analytics.conversion', {
                    rate: percent.format(stats.bookingConversionRate),
                  })}
                </p>
              ) : null}
            </div>
            <dl className="grid grid-cols-2 gap-px border-t border-v2-hairline bg-v2-hairline md:grid-cols-4">
              {kpiCell('profileViews', stats.profileViews, prev?.profileViews ?? null)}
              {kpiCell('bookingStarts', stats.bookingStarts, prev?.bookingStarts ?? null)}
              {kpiCell('created', stats.appointmentsCreated, prev?.appointmentsCreated ?? null)}
              {kpiCell('completed', stats.appointmentsCompleted, prev?.appointmentsCompleted ?? null)}
            </dl>
            {stats.appointmentsCancelled > 0 || stats.appointmentsNoShow > 0 ? (
              <p className="border-t border-v2-hairline px-4 py-2.5 text-v2-meta tabular-nums text-v2-ink-soft md:px-5">
                {t('app:v2pro.analytics.cancelled', { count: stats.appointmentsCancelled })}
                {' · '}
                {t('app:v2pro.analytics.noShow', { count: stats.appointmentsNoShow })}
              </p>
            ) : null}
          </section>

          {/* ── Completed per day ──────────────────────────────────────── */}
          <section aria-labelledby="v2pro-daily" className="v2-plate p-4 md:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="v2pro-daily" className="text-v2-title font-semibold text-v2-ink">
                {t('app:v2pro.analytics.dailyTitle')}
              </h2>
              <p className="text-v2-meta tabular-nums text-v2-ink-soft">{number.format(dailyTotal)}</p>
            </div>
            {calendar.isPending ? (
              <div className="v2-skeleton mt-3 h-16 w-full rounded-v2-1" />
            ) : dailyMax > 0 ? (
              <div
                role="img"
                aria-label={t('app:v2pro.analytics.dailyAria', { total: dailyTotal })}
                className="mt-3 flex h-20 items-end gap-[2px]"
              >
                {daily.map((day) => (
                  <div
                    key={day.key}
                    title={`${dateFormat.format(day.date)}: ${number.format(day.count)}`}
                    className={`min-h-[2px] flex-1 rounded-t-[2px] ${
                      day.count > 0 ? 'bg-v2-green' : 'bg-v2-fill'
                    }`}
                    style={{ height: `${Math.max((day.count / dailyMax) * 100, 3)}%` }}
                  />
                ))}
              </div>
            ) : (
              <p className="mt-2 text-v2-meta text-v2-ink-soft">
                {t('app:v2pro.analytics.dailyEmpty')}
              </p>
            )}
          </section>

          {/* ── Queue funnel ───────────────────────────────────────────── */}
          <section aria-labelledby="v2pro-queue-funnel" className="v2-plate overflow-hidden">
            <div className="flex items-baseline justify-between gap-3 px-4 py-3 md:px-5">
              <h2 id="v2pro-queue-funnel" className="text-v2-title font-semibold text-v2-ink">
                {t('app:v2pro.analytics.queueTitle')}
              </h2>
              {stats.queueConversionRate !== null ? (
                <p className="text-v2-meta font-semibold tabular-nums text-v2-green">
                  {t('app:v2pro.analytics.conversion', {
                    rate: percent.format(stats.queueConversionRate),
                  })}
                </p>
              ) : null}
            </div>
            <dl className="grid grid-cols-2 gap-px border-t border-v2-hairline bg-v2-hairline md:grid-cols-4">
              {kpiCell('queueViews', stats.queueViews, prev?.queueViews ?? null)}
              {kpiCell('queueJoins', stats.queueJoins, prev?.queueJoins ?? null)}
              {kpiCell('queueCompletions', stats.queueCompletions, prev?.queueCompletions ?? null)}
              {kpiCell('queueCancellations', stats.queueCancellations, prev?.queueCancellations ?? null)}
            </dl>
          </section>

          {/* ── Audience ───────────────────────────────────────────────── */}
          <section aria-labelledby="v2pro-audience" className="v2-plate overflow-hidden">
            <h2
              id="v2pro-audience"
              className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5"
            >
              {t('app:v2pro.analytics.audienceTitle')}
            </h2>
            <dl className="grid grid-cols-2 gap-px border-t border-v2-hairline bg-v2-hairline md:grid-cols-4">
              {kpiCell('uniqueCustomers', stats.uniqueCustomers, prev?.uniqueCustomers ?? null)}
              {kpiCell('repeatCustomers', stats.repeatCustomers, prev?.repeatCustomers ?? null)}
              {kpiCell('follows', stats.follows, prev?.follows ?? null)}
              {kpiCell('favorites', stats.favorites, prev?.favorites ?? null)}
            </dl>
            {stats.unfollows > 0 || stats.unfavorites > 0 ? (
              <p className="border-t border-v2-hairline px-4 py-2.5 text-v2-meta tabular-nums text-v2-ink-soft md:px-5">
                {t('app:v2pro.analytics.unfollows', { count: stats.unfollows })}
                {' · '}
                {t('app:v2pro.analytics.unfavorites', { count: stats.unfavorites })}
              </p>
            ) : null}
          </section>

          {showDeltas ? (
            <p className="text-v2-caption text-v2-ink-mute">
              {t('app:v2pro.analytics.vsPrevious')}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
