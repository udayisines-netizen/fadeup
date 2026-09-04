import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { useDemoProAgenda, useDemoProContext, useDemoProModes, useDemoProQueue } from '@/features/demo/api/pro'
import { DemoFrame } from '@/features/demo/components/DemoFrame'
import { DateTime } from '@/shared/ui/DateTime'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { StateBadge, type FadeUpState } from '@/shared/ui/StateBadge'
import { IconCalendar, IconQueue } from '@/shared/ui/icons'

/**
 * Étude C — FadeUp Pro, l'accueil opérationnel TODAY / NOW / NEXT / QUEUE
 * (P1c §5C). Sombre, dense, hiérarchie par valeur de fond et bordures —
 * jamais d'ombre. Ni admin SaaS, ni grille de KPI : l'écran répond à UNE
 * question — « que se passe-t-il maintenant, et ensuite ? ».
 *
 * Données réelles uniquement (get_calendar_appointments, queue_entries RLS,
 * get_service_mode_state). Sans session professionnelle : structure + états
 * vides honnêtes — le résultat VALIDE prévu par le prompt quand la base n'a
 * ni agenda ni file.
 */

const OPERATIONAL_LEGEND: FadeUpState[] = [
  'queue-open',
  'queue-full',
  'called',
  'missed',
  'pending-request',
  'offline',
  'partial-data',
]

function PanelTitle({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-2 font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
      {icon}
      {label}
    </h3>
  )
}

export function DemoProPage() {
  useApplySurfaceTheme('pro')
  const { t } = useTranslation('v2')
  const { context, loading, hasSession } = useDemoProContext()
  const agenda = useDemoProAgenda(context)
  const queue = useDemoProQueue(context)
  const modes = useDemoProModes(context)

  const timezone = context?.timezone ?? 'Europe/Paris'
  const now = new Date()
  const rows = agenda.data ?? []
  const current = rows.find((a) => new Date(a.starts_at) <= now && new Date(a.ends_at) > now && a.status === 'confirmed')
  const upcoming = rows.filter((a) => new Date(a.starts_at) > now && a.status !== 'cancelled')
  const next = upcoming[0]
  const queueRows = queue.data ?? []
  const mode = modes.data?.find((m) => m.scope === 'location') ?? modes.data?.[0]
  // Mode inconnu (RPC en échec ou sans session) → partial-data, jamais un
  // état de file inventé.
  const queueState: FadeUpState =
    modes.isError || !mode ? 'partial-data' : mode.queue_accepting_new_entries ? 'queue-open' : 'queue-closed'

  return (
    <DemoFrame
      title={t('demo.index.proTitle')}
      note="get_calendar_appointments · queue_entries (RLS) · get_service_mode_state"
    >
      {/* En-tête TODAY : la date, l'organisation, le volume réel du jour. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-fu-mono text-fu-xs tracking-widest text-[var(--fu-text-secondary)]">
            {t('demo.pro.today').toLocaleUpperCase()}
          </p>
          <p className="mt-1 text-fu-xl font-semibold capitalize">
            <DateTime value={now} timezone={timezone} format="weekday" />
          </p>
        </div>
        <div className="text-end">
          <p className="truncate text-fu-sm font-medium">{context?.organizationName ?? '—'}</p>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">
            {t('demo.pro.appointments', { count: rows.length })}
          </p>
        </div>
      </div>

      {!hasSession && (
        <div className="mt-4 rounded-[var(--radius-card)] border border-[var(--fu-border-strong)] bg-[var(--fu-surface)]">
          <EmptyState
            title={t('demo.pro.needsPro.title')}
            description={t('demo.pro.needsPro.description')}
            action={
              <Link
                to="/auth/login?redirect=%2Fdemo%2Fpro"
                className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-[var(--fu-accent)] px-4 text-fu-sm font-medium text-[var(--fu-accent-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--fu-canvas)]"
              >
                {t('demo.pro.needsPro.action')}
              </Link>
            }
          />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* NOW / NEXT — la moitié « fauteuil » de l'écran. */}
        <section className="flex flex-col gap-4">
          <div className="rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4">
            <PanelTitle label={t('demo.pro.now')} />
            {loading || agenda.isLoading ? (
              <SkeletonRow className="border-none px-0" />
            ) : current ? (
              <Row
                className="border-none px-0"
                title={current.customer_name ?? current.service_name}
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-3">
                    <span>{current.service_name}</span>
                    <DateTime value={current.starts_at} timezone={current.location_timezone ?? timezone} format="time" />
                  </span>
                }
                trailing={<StateBadge state="confirmed" size="sm" />}
              />
            ) : (
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('demo.pro.nowEmpty')}</p>
            )}
          </div>

          <div className="rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4">
            <PanelTitle label={t('demo.pro.next')} icon={<IconCalendar aria-hidden="true" className="size-3.5" />} />
            {loading || agenda.isLoading ? (
              <SkeletonRow className="border-none px-0" />
            ) : next ? (
              <Row
                className="border-none px-0"
                title={next.customer_name ?? next.service_name}
                subtitle={
                  <span className="flex flex-wrap items-center gap-x-3">
                    <DateTime value={next.starts_at} timezone={next.location_timezone ?? timezone} format="time" />
                    <span>{next.service_name}</span>
                  </span>
                }
                trailing={
                  next.price_cents !== null ? <Money cents={next.price_cents} currency={next.currency ?? 'EUR'} /> : undefined
                }
              />
            ) : (
              <EmptyState
                className="px-0 py-6"
                title={t('demo.pro.agendaEmpty.title')}
                description={t('demo.pro.agendaEmpty.description')}
                action={
                  <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('demo.pro.agendaEmpty.action')}</span>
                }
              />
            )}
            {/* Le reste de la journée — rangées denses, prix en Mono. */}
            {upcoming.slice(1, 5).map((appointment) => (
              <Row
                key={appointment.id}
                className="px-0"
                title={<span className="text-fu-sm font-medium">{appointment.customer_name ?? appointment.service_name}</span>}
                subtitle={
                  <span className="flex items-center gap-2">
                    <DateTime value={appointment.starts_at} timezone={appointment.location_timezone ?? timezone} format="time" />
                    <Duration minutes={Math.round((new Date(appointment.ends_at).getTime() - new Date(appointment.starts_at).getTime()) / 60000)} />
                  </span>
                }
                trailing={
                  appointment.status === 'pending' ? <StateBadge state="pending-request" size="sm" /> : undefined
                }
              />
            ))}
          </div>
        </section>

        {/* QUEUE — la moitié « porte » de l'écran. */}
        <section className="rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4">
          <div className="flex items-center justify-between gap-2">
            <PanelTitle label={t('demo.pro.queue')} icon={<IconQueue aria-hidden="true" className="size-3.5" />} />
            <StateBadge state={queueState} size="sm" />
          </div>
          {loading || queue.isLoading ? (
            <SkeletonRow className="border-none px-0" />
          ) : queueRows.length === 0 ? (
            <EmptyState
              className="px-0 py-6"
              title={t('demo.pro.queueEmpty.title')}
              description={t('demo.pro.queueEmpty.description')}
              action={<span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('demo.pro.queueEmpty.action')}</span>}
            />
          ) : (
            queueRows.map((entry, index) => (
              <Row
                key={entry.id}
                className={entry.status === 'called' ? 'fu-called px-0' : 'px-0'}
                leading={
                  <span className="inline-flex size-8 items-center justify-center rounded-[var(--radius-avatar)] bg-[var(--fu-surface-hover)] font-fu-mono text-fu-sm tabular-nums">
                    {index + 1}
                  </span>
                }
                title={<span className="text-fu-sm font-medium">{entry.customer_name}</span>}
                trailing={
                  <StateBadge
                    state={entry.status === 'called' ? 'called' : entry.status === 'in_service' ? 'confirmed' : 'queue-open'}
                    size="sm"
                  />
                }
              />
            ))
          )}
        </section>
      </div>

      {/* Vocabulaire opérationnel — LÉGENDE explicite, pas des données. */}
      <section className="mt-8">
        <h3 className="font-fu-mono text-fu-xs tracking-widest text-[var(--fu-text-secondary)]">
          {t('demo.pro.legend')}
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {OPERATIONAL_LEGEND.map((state) => (
            <StateBadge key={state} state={state} size="sm" />
          ))}
        </div>
        <p className="mt-3 text-fu-xs text-[var(--fu-text-secondary)]">{t('demo.pro.revenueNote')}</p>
      </section>
    </DemoFrame>
  )
}
