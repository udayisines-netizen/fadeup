import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProOrganization } from '@/shared/data/organization'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Row } from '@/shared/ui/Row'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { IconBack } from '@/shared/ui/icons'
import { useDurationInsights } from '@/features/pro-queue/api/proQueue'

/**
 * /dashboard/queue/durations — la transparence F1b : « Vous annoncez 30 min,
 * la moyenne observée est de 27 min sur 34 prestations. » Aucun logiciel ne
 * dit ça au professionnel aujourd'hui. Quand l'écart dépasse ±50 %,
 * l'affichage client est borné et le drapeau le dit — au pro de corriger sa
 * durée annoncée ou sa façon de pointer « Terminé ».
 */
export function ProQueueDurationsPage() {
  const { t } = useTranslation('v2')
  const { organization, loading } = useProOrganization()

  const location = (organization?.locations ?? []).find((row) => row.kind === 'physical_address') ?? null
  const insights = useDurationInsights(location?.id ?? null)

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24">
      <Link
        to="/dashboard/queue"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-fu-sm font-medium text-[var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
      >
        <IconBack aria-hidden="true" className="size-4" />
        {t('queue.durations.back')}
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-fu-xl font-semibold">{t('queue.durations.title')}</h1>
        <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.durations.description')}</p>
      </header>

      {loading || insights.isPending ? (
        <div>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (insights.data?.length ?? 0) === 0 ? (
        <EmptyState
          title={t('queue.durations.empty.title')}
          description={t('queue.durations.empty.description')}
          action={
            <Link
              to="/dashboard/queue"
              className="text-fu-sm font-medium text-[var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
            >
              {t('queue.durations.back')}
            </Link>
          }
        />
      ) : (
        <section className="rounded-[var(--radius-card)] bg-[var(--fu-surface)] px-4 py-1" data-testid="duration-insights">
          {(insights.data ?? []).map((row) => (
            <Row
              key={`${row.barber_id ?? 'none'}-${row.service_id}`}
              className="px-0"
              title={row.service_name}
              subtitle={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span>{row.barber_display_name ?? t('queue.durations.firstAvailable')}</span>
                  <span>· {t('queue.durations.samples', { count: row.sample_count })}</span>
                  {row.estimate_capped && (
                    <span className="font-medium text-[var(--fu-state-warn,var(--fu-text-secondary))]" title={t('queue.durations.cappedHint')}>
                      {t('queue.durations.cappedBadge')}
                    </span>
                  )}
                </span>
              }
              trailing={
                <span className="flex flex-col items-end gap-0.5 text-fu-sm">
                  <span className="text-[var(--fu-text-secondary)]">
                    {t('queue.durations.declared')} <Duration minutes={row.declared_minutes} />
                  </span>
                  {row.observed_minutes !== null && (
                    <span>
                      {t('queue.durations.observed')} <Duration minutes={Math.round(row.observed_minutes)} />
                    </span>
                  )}
                </span>
              }
            />
          ))}
          {(insights.data ?? []).some((row) => row.estimate_capped) && (
            <p className="border-t border-[var(--fu-border)] py-3 text-fu-xs text-[var(--fu-text-secondary)]">
              {t('queue.durations.cappedHint')}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
