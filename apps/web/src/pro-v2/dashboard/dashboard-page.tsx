import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { useOrgAppointmentsForDate, type Appointment } from '@/lib/queries/appointments'
import { useOrgQueue } from '@/lib/queries/queue'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'
import { hasAnyActivity, useOrganizationAnalyticsSummary } from '@/lib/queries/analytics-summary'
import { useProScope } from '@/pro-v2/shell/pro-v2-shell'

/**
 * The operational cockpit — "what needs my attention right now", from real
 * rows only.
 *
 * ============================================================================
 * WHAT EACH NUMBER IS
 * ============================================================================
 *
 * NEXT — the first of today's appointments whose end is still ahead, in the
 * active scope. TODAY — today's appointment count by status. QUEUE — rows in
 * the live queue with `waiting` status. All three come from the same
 * org-scoped contracts the legacy cockpit uses, narrowed to the location
 * scope client-side ON THE ROW'S OWN locationId — filtering real rows by a
 * real field, not recomputation.
 *
 * THE 30-DAY PANEL is `get_organization_analytics_summary` verbatim: completed
 * appointments, unique/repeat customers, profile views, booking conversion.
 * The conversion ratio is rendered from the server's own number and never
 * recomputed here.
 *
 * ============================================================================
 * WHAT IS DELIBERATELY MISSING
 * ============================================================================
 *
 * REVENUE. Appointment rows carry no price column, and pricing a completed
 * appointment by TODAY'S service price would misstate any visit that predates
 * a price change. Until appointments record what was actually charged,
 * revenue has no truthful source, and the cockpit does not invent one —
 * recorded as a backend gap. The same applies to today's takings, margin and
 * forecast.
 *
 * ANALYTICS SCOPE. The summary contract is organization-wide (no location
 * parameter), so while location scope narrows the operational panels, the
 * 30-day panel states the whole organization.
 */
export function ProV2DashboardPage() {
  const { t, i18n } = useTranslation()
  const scope = useProScope()

  const today = useMemo(() => new Intl.DateTimeFormat('en-CA').format(new Date()), [])

  const appointments = useOrgAppointmentsForDate(scope.organizationId, today)
  const queue = useOrgQueue(scope.organizationId)
  const barbers = useOrgBarbers(scope.organizationId)
  const staffProfiles = useOrgStaffProfiles(scope.organizationId)
  const summary = useOrganizationAnalyticsSummary(scope.organizationId)

  useDocumentMeta({
    title: t('app:v2pro.dashboard.documentTitle'),
    description: t('app:v2pro.dashboard.documentDescription'),
    noIndex: true,
  })

  const inScope = <T extends { locationId: string }>(rows: T[] | undefined): T[] =>
    (rows ?? []).filter((row) => !scope.locationId || row.locationId === scope.locationId)

  const todaysAppointments = inScope(appointments.data)
  const waiting = inScope(queue.data).filter((entry) => entry.status === 'waiting')

  const now = Date.now()
  const next: Appointment | null =
    todaysAppointments
      .filter(
        (appointment) =>
          appointment.status !== 'cancelled' &&
          appointment.status !== 'no_show' &&
          new Date(appointment.endsAt).getTime() > now,
      )
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null

  const completedToday = todaysAppointments.filter((entry) => entry.status === 'completed').length

  // barbers → staff_profiles is the real join: a barber row is a placement, the
  // display name lives on the staff profile behind it.
  const barberName = (barberId: string) => {
    const placement = (barbers.data ?? []).find((entry) => entry.id === barberId)
    if (!placement) return null
    return (
      (staffProfiles.data ?? []).find((profile) => profile.id === placement.staffProfileId)
        ?.displayName ?? null
    )
  }

  const timeFormat = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' })

  const stats = summary.data ?? null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
        {t('app:v2pro.dashboard.title')}
      </h1>

      {/* ── Operational row ─────────────────────────────────────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        <section className="v2-plate p-4 md:p-5">
          <h2 className="text-v2-caption font-semibold uppercase tracking-[0.08em] text-v2-ink-soft">
            {t('app:v2pro.dashboard.next')}
          </h2>
          {appointments.isPending ? (
            <div className="v2-skeleton mt-2 h-6 w-2/3 rounded-v2-1" />
          ) : next ? (
            <>
              <p className="mt-1.5 text-v2-heading font-semibold tabular-nums text-v2-ink">
                {timeFormat.format(new Date(next.startsAt))}
              </p>
              <p className="mt-0.5 truncate text-v2-meta text-v2-ink-soft">
                <bdi>{next.customerName}</bdi>
                {barberName(next.barberId) ? (
                  <>
                    {' · '}
                    <bdi>{barberName(next.barberId)}</bdi>
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-v2-body text-v2-ink-soft">{t('app:v2pro.dashboard.noNext')}</p>
          )}
        </section>

        <section className="v2-plate p-4 md:p-5">
          <h2 className="text-v2-caption font-semibold uppercase tracking-[0.08em] text-v2-ink-soft">
            {t('app:v2pro.dashboard.queue')}
          </h2>
          {queue.isPending ? (
            <div className="v2-skeleton mt-2 h-6 w-1/3 rounded-v2-1" />
          ) : (
            <p className="mt-1.5 text-v2-heading font-semibold tabular-nums text-v2-ink">
              {waiting.length}
              <span className="ms-2 text-v2-meta font-medium text-v2-ink-soft">
                {t('app:v2pro.dashboard.waitingLabel')}
              </span>
            </p>
          )}
        </section>

        <section className="v2-plate p-4 md:p-5">
          <h2 className="text-v2-caption font-semibold uppercase tracking-[0.08em] text-v2-ink-soft">
            {t('app:v2pro.dashboard.today')}
          </h2>
          {appointments.isPending ? (
            <div className="v2-skeleton mt-2 h-6 w-1/2 rounded-v2-1" />
          ) : (
            <>
              <p className="mt-1.5 text-v2-heading font-semibold tabular-nums text-v2-ink">
                {todaysAppointments.length}
                <span className="ms-2 text-v2-meta font-medium text-v2-ink-soft">
                  {t('app:v2pro.dashboard.appointmentsLabel')}
                </span>
              </p>
              <p className="mt-0.5 text-v2-meta tabular-nums text-v2-ink-soft">
                {t('app:v2pro.dashboard.completedToday', { count: completedToday })}
              </p>
            </>
          )}
        </section>
      </div>

      {/* ── Today's schedule ─────────────────────────────────────────────── */}
      <section aria-labelledby="v2pro-schedule" className="v2-plate overflow-hidden">
        <h2 id="v2pro-schedule" className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
          {t('app:v2pro.dashboard.schedule')}
        </h2>
        {todaysAppointments.length > 0 ? (
          <ul>
            {todaysAppointments
              .slice()
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
              .map((appointment) => (
                <li
                  key={appointment.id}
                  className="flex items-center gap-3 border-t border-v2-hairline px-4 py-2.5 md:px-5"
                >
                  <p className="w-14 shrink-0 text-v2-body font-semibold tabular-nums text-v2-ink">
                    {timeFormat.format(new Date(appointment.startsAt))}
                  </p>
                  <p className="min-w-0 flex-1 truncate text-v2-body text-v2-ink">
                    <bdi>{appointment.customerName}</bdi>
                    {barberName(appointment.barberId) ? (
                      <span className="text-v2-ink-soft">
                        {' · '}
                        <bdi>{barberName(appointment.barberId)}</bdi>
                      </span>
                    ) : null}
                  </p>
                  <p className="shrink-0 text-v2-caption font-medium text-v2-ink-mute">
                    {t(`app:v2pro.dashboard.status.${appointment.status}`)}
                  </p>
                </li>
              ))}
          </ul>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('app:v2pro.dashboard.noAppointmentsToday')}
          </p>
        )}
      </section>

      {/* ── 30 days, whole organization ──────────────────────────────────── */}
      <section aria-labelledby="v2pro-summary" className="v2-plate overflow-hidden">
        <h2 id="v2pro-summary" className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5">
          {t('app:v2pro.dashboard.summary')}
        </h2>

        {stats && hasAnyActivity(stats) ? (
          <dl className="grid grid-cols-2 gap-px border-t border-v2-hairline bg-v2-hairline md:grid-cols-4">
            {[
              { key: 'completed', value: stats.appointmentsCompleted },
              { key: 'uniqueCustomers', value: stats.uniqueCustomers },
              { key: 'repeatCustomers', value: stats.repeatCustomers },
              { key: 'profileViews', value: stats.profileViews },
            ].map((cell) => (
              <div key={cell.key} className="bg-v2-paper px-4 py-3 md:px-5">
                <dt className="text-v2-caption text-v2-ink-soft">
                  {t(`app:v2pro.dashboard.kpi.${cell.key}`)}
                </dt>
                <dd className="mt-0.5 text-v2-lead font-semibold tabular-nums text-v2-ink">
                  {cell.value}
                </dd>
              </div>
            ))}
            {stats.bookingConversionRate !== null ? (
              <div className="bg-v2-paper px-4 py-3 md:px-5">
                <dt className="text-v2-caption text-v2-ink-soft">
                  {t('app:v2pro.dashboard.kpi.conversion')}
                </dt>
                <dd className="mt-0.5 text-v2-lead font-semibold tabular-nums text-v2-ink">
                  {new Intl.NumberFormat(i18n.language, {
                    style: 'percent',
                    maximumFractionDigits: 0,
                  }).format(stats.bookingConversionRate)}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : summary.isPending ? (
          <div className="border-t border-v2-hairline px-4 py-4 md:px-5">
            <div className="v2-skeleton h-6 w-1/2 rounded-v2-1" />
          </div>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('app:v2pro.dashboard.noSummary')}
          </p>
        )}
      </section>
    </div>
  )
}
