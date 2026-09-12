import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProOrganization } from '@/shared/data/organization'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { useIsDesktop } from '@/shared/hooks/useMediaQuery'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { Select } from '@/shared/ui/Select'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { IconAnalytics, IconClients, IconPending } from '@/shared/ui/icons'
import { deviceTimezone } from '@/shared/lib/format'
import { useDurationGaps, useOrganizationInsights, type DurationGap } from '@/features/pro-insights/api/insights'
import {
  conversionRate,
  durationVerdict,
  hasMoney,
  hasNoHistory,
  trendFor,
  viewsArePartial,
  windowBounds,
  type DurationVerdict,
  type InsightWindowKey,
} from '@/features/pro-insights/lib/insights'

/**
 * OS-3 §3 — les insights. Régime AÉRÉ (P1PRO §3) : des BLOCS bordés, UN
 * chiffre dominant, les autres secondaires. Pas de grille de douze cartes
 * identiques — quand tout a la même taille, le patron ne sait pas quoi
 * regarder.
 *
 * LE CHIFFRE QUI DOMINE est ce que FadeUp a APPORTÉ : les réservations reçues
 * par la plateforme sur la période. C'est le chiffre qui empêche une
 * résiliation, et c'est le seul que le salon ne peut pas lire ailleurs. Le
 * revenu est un bloc secondaire — il domine déjà l'accueil, et il n'est rendu
 * qu'à qui a le droit de le voir (réglage OS-1, masqué SERVEUR : ce composant
 * n'a même pas le nombre).
 *
 * AUCUN CHIFFRE INVENTÉ : une organisation sans activité connue affiche un
 * état vide, pas une grille de zéros ; une variation n'apparaît que si le
 * serveur a jugé la période de comparaison légitime ; une durée observée n'est
 * annoncée qu'au-delà de cinq mesures.
 */

function PanelTitle({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
      {icon}
      {label.toLocaleUpperCase()}
    </h2>
  )
}

const panelClass = 'rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4 lg:p-5'

function Stat({ label, value, testId }: { label: string; value: React.ReactNode; testId?: string }) {
  return (
    <div>
      <dt className="text-fu-xs text-[var(--fu-text-secondary)]">{label}</dt>
      <dd className="font-fu-mono text-fu-lg tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}

export function ProInsightsPage() {
  const { t } = useTranslation('v2')
  const isDesktop = useIsDesktop()
  const { organization, loading: orgLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const timezone = organization?.locations[0]?.timezone ?? deviceTimezone()

  const [windowKey, setWindowKey] = useState<InsightWindowKey>('30d')
  // Les bornes ne se recalculent pas à chaque rendu : la clé de requête
  // changerait à la seconde et refetcherait sans fin.
  const bounds = useMemo(() => windowBounds(windowKey, new Date()), [windowKey])

  const insights = useOrganizationInsights(organizationId, bounds.from, bounds.to)
  const gaps = useDurationGaps(organizationId, null)

  const data = insights.data ?? null
  const currency = data?.currency ?? organization?.currency ?? 'EUR'
  const periodOptions = [
    { value: '30d', label: t('pro.insights.period.days30') },
    { value: '90d', label: t('pro.insights.period.days90') },
    { value: '12m', label: t('pro.insights.period.months12') },
  ]

  const bookingsTrend = data ? trendFor(data.fadeup_bookings, data.previous_fadeup_bookings, data.comparison_available) : null
  const viewsTrend = data ? trendFor(data.profile_views, data.previous_profile_views, data.comparison_available) : null
  const revenueTrend = data ? trendFor(data.revenue_cents, data.previous_revenue_cents, data.comparison_available) : null
  const requestRate = data ? conversionRate(data.requests_converted, data.requests_received) : null
  const partialViews = data ? viewsArePartial(data.window_from, data.analytics_since) : false

  /* Le prédicat de type est DÉLIBÉRÉ : un `filter` ordinaire ne rétrécit pas
     l'union, et la branche « pas assez de mesures » n'a ni durée annoncée ni
     durée observée à lire. Le compilateur doit le savoir, pas nous. */
  const measured = useMemo(
    () =>
      (gaps.data ?? [])
        .map((gap) => ({ gap, verdict: durationVerdict(gap.declared_minutes, gap.observed_minutes, gap.sample_count) }))
        .filter(
          (row): row is { gap: DurationGap; verdict: Exclude<DurationVerdict, { kind: 'not-enough' }> } =>
            row.verdict.kind !== 'not-enough',
        ),
    [gaps.data],
  )

  const loading = orgLoading || insights.isPending

  const trendLabel = (trend: ReturnType<typeof trendFor>) => {
    if (trend === null) return null
    if (trend.percent === null) {
      return t('pro.insights.trend.fromNothing', { previous: trend.previous })
    }
    if (trend.direction === 'flat') return t('pro.insights.trend.flat')
    return trend.direction === 'up'
      ? t('pro.insights.trend.up', { percent: trend.percent })
      : t('pro.insights.trend.down', { percent: trend.percent })
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8 lg:py-8" data-testid="pro-insights">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
        <div>
          <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)] lg:text-fu-2xl">
            {t('pro.insights.title')}
          </h1>
          <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.insights.subtitle')}</p>
        </div>
        {isDesktop ? (
          <SegmentedControl
            label={t('pro.insights.period.label')}
            options={periodOptions}
            value={windowKey}
            onValueChange={(value) => setWindowKey(value as InsightWindowKey)}
            className="shrink-0"
          />
        ) : (
          <Select
            label={t('pro.insights.period.label')}
            options={periodOptions}
            value={windowKey}
            onValueChange={(value) => setWindowKey(value as InsightWindowKey)}
            className="w-full"
          />
        )}
      </header>

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t('common.a11y.loading')}>
          <SkeletonRect className="h-40 w-full" />
          <SkeletonRect className="h-28 w-full" />
          <SkeletonRect className="h-28 w-2/3" />
        </div>
      ) : insights.error ? (
        <div className={panelClass} data-testid="pro-insights-error">
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">
            {t(errorMessageKey(toAppError(insights.error)))}
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void insights.refetch()}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : data === null || hasNoHistory(data.first_activity_at) ? (
        /* Organisation sans activité connue : une phrase honnête et une
           action réelle. PAS de grille de zéros, PAS de graphique vide. */
        <div className={panelClass} data-testid="pro-insights-empty">
          <EmptyState
            icon={<IconAnalytics aria-hidden="true" />}
            title={t('pro.insights.empty.title')}
            description={t('pro.insights.empty.description')}
            action={
              organization ? (
                <Link
                  to={`/shop/${encodeURIComponent(organization.slug)}`}
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-[var(--fu-accent)] px-4 text-fu-sm font-medium text-[color:var(--fu-accent-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
                >
                  {t('pro.insights.empty.action')}
                </Link>
              ) : (
                <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.insights.empty.action')}</span>
              )
            }
          />
        </div>
      ) : (
        <div
          className={`flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:gap-5 ${insights.isPlaceholderData ? 'opacity-60' : ''}`}
          aria-busy={insights.isPlaceholderData}
        >
          {/* LE chiffre dominant — ce que FadeUp a apporté. Un seul. */}
          <section className={`${panelClass} lg:col-span-2`} data-testid="pro-insights-hero">
            <PanelTitle label={t('pro.insights.contributionLabel')} />
            <p
              className="mt-2 font-fu-mono text-fu-3xl font-semibold tabular-nums text-[var(--fu-text-primary)] lg:text-fu-4xl"
              data-testid="pro-insights-dominant"
            >
              {data.fadeup_bookings}
            </p>
            <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
              {t('pro.insights.contributionHint', { count: data.fadeup_customers })}
            </p>
            {bookingsTrend !== null && (
              <p
                className="mt-1 font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]"
                data-testid="pro-insights-trend"
              >
                {trendLabel(bookingsTrend)}
              </p>
            )}
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--fu-border)] pt-3">
              <Stat
                label={t('pro.insights.stat.profileViews')}
                value={data.profile_views}
                testId="pro-insights-views"
              />
              <Stat label={t('pro.insights.stat.newFollowers')} value={data.new_followers} />
              <Stat label={t('pro.insights.stat.delivered')} value={data.services_delivered} />
              <Stat label={t('pro.insights.stat.counter')} value={data.counter_bookings} />
            </dl>
            {partialViews && (
              <p className="mt-2 text-fu-xs text-[var(--fu-text-secondary)]" data-testid="pro-insights-views-partial">
                {t('pro.insights.viewsSince')}{' '}
                <DateTime value={data.analytics_since ?? data.window_from} timezone={timezone} format="date" />
              </p>
            )}
            {viewsTrend !== null && (
              <p className="mt-1 font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]">
                {t('pro.insights.stat.profileViews')} · {trendLabel(viewsTrend)}
              </p>
            )}
          </section>

          {/* LE REVENU — rendu SEULEMENT si le serveur l'a rendu. Un rôle qui
              ne le voit pas ne voit pas non plus son emplacement vide
              (P1PRO §8 : la composition se refait sans lui). */}
          {data.revenue_visible && hasMoney(data.revenue_cents) && (
            <section className={panelClass} data-testid="pro-insights-revenue">
              <PanelTitle label={t('pro.insights.revenueLabel')} />
              <p className="mt-2 font-fu-mono text-fu-xl font-semibold tabular-nums text-[var(--fu-text-primary)]">
                <Money cents={data.revenue_cents} currency={currency} />
              </p>
              <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.insights.revenueHint')}</p>
              {revenueTrend !== null && (
                <p className="mt-1 font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]">
                  {trendLabel(revenueTrend)}
                </p>
              )}
              <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--fu-border)] pt-3">
                {hasMoney(data.average_ticket_cents) && (
                  <Stat
                    label={t('pro.insights.stat.averageTicket')}
                    value={<Money cents={data.average_ticket_cents} currency={currency} />}
                  />
                )}
                {/* Zéro absence est une VRAIE information et s'affiche — mais
                    son coût, lui, ne vaut pas une ligne à « 0,00 € » : le
                    montant n'apparaît que quand il y a eu une absence. */}
                <Stat
                  label={t('pro.insights.stat.absences', { count: data.no_show_count })}
                  value={
                    data.no_show_count > 0 && hasMoney(data.no_show_cost_cents) ? (
                      <Money cents={data.no_show_cost_cents} currency={currency} />
                    ) : (
                      data.no_show_count
                    )
                  }
                  testId="pro-insights-absences"
                />
              </dl>
            </section>
          )}

          {/* Les demandes : le maillon de conversion que FadeUp opère. */}
          <section className={panelClass} data-testid="pro-insights-requests">
            <PanelTitle label={t('pro.insights.requestsLabel')} icon={<IconPending aria-hidden="true" className="size-3.5" />} />
            {data.requests_received === 0 ? (
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.insights.requestsNone')}</p>
            ) : (
              <>
                <p className="mt-2 font-fu-mono text-fu-xl font-semibold tabular-nums text-[var(--fu-text-primary)]">
                  {data.requests_converted}
                  <span className="text-fu-sm text-[var(--fu-text-secondary)]">{` / ${data.requests_received}`}</span>
                </p>
                <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">
                  {requestRate === null
                    ? t('pro.insights.requestsNone')
                    : t('pro.insights.requestsHint', { percent: requestRate })}
                </p>
              </>
            )}
          </section>

          {/* Les clients : nouveaux, revenus, et ceux qui ne reviennent plus.
              Le bloc d'appel ambre ne se rend PAS quand le compte est zéro
              (idiome OS-2). */}
          <section className={`${panelClass} lg:col-span-2`} data-testid="pro-insights-customers">
            <PanelTitle label={t('pro.insights.customersLabel')} icon={<IconClients aria-hidden="true" className="size-3.5" />} />
            <dl className="mt-2 flex flex-wrap gap-x-8 gap-y-3">
              <Stat label={t('pro.insights.stat.newCustomers')} value={data.new_customers} />
              <Stat label={t('pro.insights.stat.returningCustomers')} value={data.returning_customers} />
            </dl>
            {data.lapsed_customers > 0 && (
              <div
                className="mt-4 rounded-[var(--radius-card)] border border-[var(--fu-state-warn)] p-3"
                data-testid="pro-insights-lapsed"
              >
                <p className="text-fu-sm text-[var(--fu-text-primary)]">
                  {t('pro.insights.lapsed', { count: data.lapsed_customers })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link
                    to="/dashboard/clients"
                    className="inline-flex min-h-11 items-center text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
                  >
                    {t('pro.insights.lapsedAction')}
                  </Link>
                  <Link
                    to="/dashboard/campaigns"
                    className="inline-flex min-h-11 items-center text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
                    data-testid="pro-insights-lapsed-campaign"
                  >
                    {t('pro.insights.lapsedCampaign')}
                  </Link>
                </div>
              </div>
            )}
          </section>

          {/* Durées annoncées contre observées — la phrase que personne
              d'autre ne dit à un barbier. Dense DANS son bloc. */}
          <section className={`${panelClass} lg:col-span-3`} data-testid="pro-insights-durations">
            <PanelTitle label={t('pro.insights.durationsLabel')} />
            {gaps.isPending ? (
              <div className="mt-2" aria-busy="true">
                <SkeletonRect className="h-12 w-full" />
              </div>
            ) : measured.length === 0 ? (
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="pro-insights-durations-empty">
                {t('pro.insights.durationsEmpty')}
              </p>
            ) : (
              <div className="mt-1">
                {measured.map(({ gap, verdict }) => (
                  <Row
                    key={`${gap.location_id}-${gap.service_id}`}
                    className="px-0"
                    title={<span className="text-fu-sm font-medium">{gap.service_name}</span>}
                    subtitle={
                      <span className="text-fu-xs text-[var(--fu-text-secondary)]">
                        {verdict.kind === 'aligned'
                          ? t('pro.insights.durationAligned', {
                              declared: verdict.declared,
                              samples: verdict.samples,
                            })
                          : t('pro.insights.durationGap', {
                              declared: verdict.declared,
                              observed: verdict.observed,
                              samples: verdict.samples,
                            })}
                      </span>
                    }
                    trailing={
                      verdict.kind === 'gap' ? (
                        <span
                          className={`font-fu-mono text-fu-sm tabular-nums ${verdict.over ? 'text-[var(--fu-state-warn)]' : 'text-[var(--fu-text-secondary)]'}`}
                        >
                          {verdict.over ? '+' : '−'}
                          {verdict.deltaMinutes}
                          {t('pro.insights.minutesSuffix')}
                        </span>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
