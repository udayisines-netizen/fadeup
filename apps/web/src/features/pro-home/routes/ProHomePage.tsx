import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/shared/hooks/useNow'
import { deviceTimezone } from '@/shared/lib/format'
import { isSoloOrganization, useProEntitlements, useProOrganization } from '@/shared/data/organization'
import { useBookingRequests } from '@/shared/data/proRequests'
import { remainingParts } from '@/shared/lib/deadline'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Duration } from '@/shared/ui/Duration'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconCalendar, IconPending, IconQueue } from '@/shared/ui/icons'
import {
  useCompleteAppointment,
  useMyBarberId,
  useProHomeChannel,
  useProQueueSummary,
  useProToday,
  type TodayAppointment,
} from '@/features/pro-home/api/proHome'

/**
 * P1PRO §9 — l'accueil pro : TODAY / NOW / NEXT / QUEUE (MASTER_SPEC §14).
 *
 * La direction (P1PRO_DESIGN_CONTRACT) : composition en BLOCS pour le grand
 * écran, empilement opérationnel en mobile. UN chiffre domine — le revenu
 * calculé du jour pour owner/manager, SES prestations restantes pour un
 * barber salarié (qui ne voit JAMAIS le revenu du salon) — les autres sont
 * secondaires. Aucun chiffre fabriqué : tout vient de l'agenda réel, de la
 * file réelle et des demandes réelles ; une journée vide est un état vide
 * honnête, pas une grille de zéros.
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

export function ProHomePage() {
  const { t } = useTranslation('v2')
  const now = useNow(30_000)

  const { organization, loading: orgLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const role = organization?.role ?? 'barber'
  const isSolo = isSoloOrganization(organization)
  const canManage = role === 'owner' || role === 'manager' || role === 'receptionist'
  const seesRevenue = role === 'owner' || role === 'manager'

  const { entitlements } = useProEntitlements(organizationId)
  const hasLiveQueue = (entitlements?.liveCapabilities ?? []).includes('liveQueue')

  const today = useProToday(organizationId)
  const queue = useProQueueSummary(organizationId, hasLiveQueue)
  const requests = useBookingRequests(canManage ? organizationId : null)
  const myBarber = useMyBarberId(organizationId)
  const complete = useCompleteAppointment(organizationId)
  useProHomeChannel(organizationId)

  const rows = useMemo(() => today.data ?? [], [today.data])
  const timezone = organization?.locations[0]?.timezone ?? deviceTimezone()

  /* Un barber salarié parle de SA journée ; un rôle gestionnaire de celle du
     salon. `mine` ne filtre que si l'identité barber du compte existe. */
  const scoped = useMemo(() => {
    if (role === 'barber' && myBarber.data) return rows.filter((row) => row.barber_id === myBarber.data)
    return rows
  }, [rows, role, myBarber.data])

  const active = useMemo(
    () => scoped.filter((row) => row.status === 'confirmed' || row.status === 'completed'),
    [scoped],
  )
  const current = active.find(
    (row) => row.status === 'confirmed' && Date.parse(row.starts_at) <= now.getTime() && Date.parse(row.ends_at) > now.getTime(),
  )
  const upcoming = useMemo(
    () =>
      scoped
        .filter((row) => row.status === 'confirmed' && Date.parse(row.starts_at) > now.getTime())
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    [scoped, now],
  )
  const next = upcoming[0]
  const completedRows = useMemo(() => scoped.filter((row) => row.status === 'completed'), [scoped])

  /* Le revenu du jour est un CALCUL depuis les prix configurés des
     prestations TERMINÉES — jamais un montant encaissé (il n'en existe pas). */
  const revenueCents = completedRows.reduce((sum, row) => sum + (row.price_cents ?? 0), 0)
  const currency = scoped.find((row) => row.currency)?.currency ?? 'EUR'

  const requestRows = requests.data ?? []
  const pendingRequests = requestRows.filter((row) => row.counter_proposed_at === null)
  const nearestDeadline = pendingRequests[0]?.expires_at ?? null
  const nearestRemaining = nearestDeadline ? remainingParts(nearestDeadline, now) : null

  const queueRows = queue.data ?? []
  const waitingCount = queueRows.filter((row) => row.status === 'waiting').length

  const loading = orgLoading || today.isPending
  /* Une journée est VIDE quand rien n'y est actif — ni rendez-vous vivant,
     ni demande en attente. Des annulations seules ne composent pas un
     tableau de bord de zéros : l'état vide honnête, avec une action. */
  const emptyDay =
    !loading &&
    rows.every((row) => row.status === 'cancelled' || row.status === 'no_show') &&
    pendingRequests.length === 0

  const markDone = (row: TodayAppointment) => complete.mutate(row.id)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8 lg:py-8" data-testid="pro-home">
      {/* En-tête : la date, rien d'autre — le shell porte déjà l'organisation. */}
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 lg:mb-6">
        <div>
          <p className="font-fu-mono text-fu-xs tracking-widest text-[var(--fu-text-secondary)]">
            {t('pro.home.todayLabel').toLocaleUpperCase()}
          </p>
          <p className="mt-1 text-fu-xl font-semibold capitalize lg:text-fu-2xl">
            <DateTime value={now} timezone={timezone} format="weekday" />
          </p>
        </div>
        {organization && organization.locations.length > 1 && (
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{organization.locations[0]?.name}</p>
        )}
      </header>

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <SkeletonRect className="h-36 w-full" />
          <SkeletonRect className="h-24 w-full" />
          <SkeletonRect className="h-24 w-2/3" />
        </div>
      ) : emptyDay ? (
        /* Journée sans rendez-vous : un état vide honnête avec une action
           réelle — jamais une grille de zéros décoratifs. */
        <div className={panelClass} data-testid="pro-home-empty">
          <EmptyState
            title={t('pro.home.emptyDay.title')}
            description={t('pro.home.emptyDay.description')}
            action={
              organization ? (
                <Link
                  to={`/shop/${encodeURIComponent(organization.slug)}`}
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-[var(--fu-accent)] px-4 text-fu-sm font-medium text-[color:var(--fu-accent-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
                >
                  {t('pro.home.emptyDay.action')}
                </Link>
              ) : (
                <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.home.emptyDay.action')}</span>
              )
            }
          />
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:gap-5">
          {/* LE chiffre dominant — un seul (P1PRO §4). */}
          <section className={`${panelClass} order-4 lg:order-1 lg:col-span-2`} data-testid="pro-home-hero">
            <PanelTitle
              label={seesRevenue ? t('pro.home.revenueLabel') : t('pro.home.remainingLabel')}
            />
            <p className="mt-2 font-fu-mono text-fu-3xl font-semibold tabular-nums text-[var(--fu-text-primary)] lg:text-fu-4xl" data-testid="pro-home-dominant">
              {seesRevenue ? (
                <Money cents={revenueCents} currency={currency} />
              ) : (
                upcoming.length + (current ? 1 : 0)
              )}
            </p>
            <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
              {seesRevenue ? t('pro.home.revenueHint', { count: completedRows.length }) : t('pro.home.remainingHint')}
            </p>
            {/* Les chiffres secondaires — lisibles, sans se disputer l'attention. */}
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-[var(--fu-border)] pt-3">
              <div>
                <dt className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.home.statAppointments')}</dt>
                <dd className="font-fu-mono text-fu-lg tabular-nums">{active.length}</dd>
              </div>
              <div>
                <dt className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.home.statCompleted')}</dt>
                <dd className="font-fu-mono text-fu-lg tabular-nums">{completedRows.length}</dd>
              </div>
              {canManage && (
                <div>
                  <dt className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.home.statPending')}</dt>
                  <dd
                    className={`font-fu-mono text-fu-lg tabular-nums ${pendingRequests.length > 0 ? 'text-[var(--fu-state-warn)]' : ''}`}
                  >
                    {pendingRequests.length}
                  </dd>
                </div>
              )}
            </dl>
          </section>

          {/* DEMANDES — le maillon de conversion, ambre quand ça attend. */}
          {canManage && pendingRequests.length > 0 && (
            <section
              className={`${panelClass} order-2 border-[var(--fu-state-warn)] lg:order-2`}
              data-testid="pro-home-requests"
            >
              <PanelTitle label={t('pro.home.requestsLabel')} icon={<IconPending aria-hidden="true" className="size-3.5" />} />
              <p className="mt-2 font-fu-mono text-fu-2xl font-semibold tabular-nums text-[var(--fu-state-warn)]">
                {pendingRequests.length}
              </p>
              <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
                {nearestRemaining
                  ? t('pro.home.requestsNearest', {
                      time:
                        nearestRemaining.hours > 0
                          ? t('booking.request.hoursMinutes', { hours: nearestRemaining.hours, minutes: nearestRemaining.minutes })
                          : t('booking.request.minutesOnly', { minutes: nearestRemaining.minutes }),
                    })
                  : t('pro.home.requestsCount', { count: pendingRequests.length })}
              </p>
              <Link
                to="/dashboard/requests"
                className="mt-3 inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-[var(--fu-accent)] px-4 text-fu-sm font-medium text-[color:var(--fu-accent-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
                data-testid="pro-home-requests-link"
              >
                {t('pro.home.viewRequests')}
              </Link>
            </section>
          )}

          {/* NOW — le fauteuil. « Terminé » en un geste. */}
          <section className={`${panelClass} order-1 lg:order-3 lg:col-span-2`} data-testid="pro-home-now">
            <PanelTitle label={t('pro.home.nowLabel')} />
            {current ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-fu-lg font-semibold text-[var(--fu-text-primary)]">
                    {current.customer_name || current.service_name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-fu-sm text-[var(--fu-text-secondary)]">
                    <span>{current.service_name}</span>
                    <span className="font-fu-mono tabular-nums">
                      <DateTime value={current.starts_at} timezone={current.location_timezone} format="time" />
                      {' – '}
                      <DateTime value={current.ends_at} timezone={current.location_timezone} format="time" />
                    </span>
                    {!isSolo && current.barber_display_name && <span>{current.barber_display_name}</span>}
                  </p>
                </div>
                <Button
                  variant="primary"
                  data-testid="pro-home-complete"
                  loading={complete.isPending}
                  aria-label={t('pro.home.markDoneAria', { name: current.customer_name || current.service_name || '' })}
                  onClick={() => markDone(current)}
                >
                  {t('pro.home.markDone')}
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.home.nowEmpty')}</p>
            )}
          </section>

          {/* QUEUE — rendue seulement si la capacité liveQueue est réelle. */}
          {hasLiveQueue && (
            <section className={`${panelClass} order-5 lg:order-4`} data-testid="pro-home-queue">
              <div className="flex items-center justify-between gap-2">
                <PanelTitle label={t('pro.home.queueLabel')} icon={<IconQueue aria-hidden="true" className="size-3.5" />} />
                <span className="font-fu-mono text-fu-lg font-semibold tabular-nums">{waitingCount}</span>
              </div>
              {queueRows.length === 0 ? (
                <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.home.queueEmpty')}</p>
              ) : (
                <div className="mt-1">
                  {queueRows.slice(0, 4).map((entry, index) => (
                    <Row
                      key={entry.id}
                      className={entry.status === 'called' ? 'fu-called px-0' : 'px-0'}
                      leading={
                        <span className="inline-flex size-7 items-center justify-center rounded-[var(--radius-avatar)] bg-[var(--fu-surface-hover)] font-fu-mono text-fu-xs tabular-nums">
                          {index + 1}
                        </span>
                      }
                      title={<span className="text-fu-sm font-medium">{entry.customer_name}</span>}
                      trailing={
                        entry.status !== 'waiting' ? (
                          <StateBadge state={entry.status === 'called' ? 'called' : 'confirmed'} size="sm" />
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              )}
              <Link
                to="/dashboard/queue"
                className="mt-3 inline-flex text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
              >
                {t('pro.home.viewQueue')}
              </Link>
            </section>
          )}

          {/* NEXT — le prochain, l'heure en mono. */}
          <section className={`${panelClass} order-3 lg:order-5 lg:col-span-2`} data-testid="pro-home-next">
            <PanelTitle label={t('pro.home.nextLabel')} icon={<IconCalendar aria-hidden="true" className="size-3.5" />} />
            {next ? (
              <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="font-fu-mono text-fu-2xl font-semibold tabular-nums">
                  <DateTime value={next.starts_at} timezone={next.location_timezone} format="time" />
                </span>
                <span className="min-w-0">
                  <span className="text-fu-base font-medium text-[var(--fu-text-primary)]">
                    {next.customer_name || next.service_name}
                  </span>
                  <span className="ms-3 text-fu-sm text-[var(--fu-text-secondary)]">
                    {next.service_name}
                    {!isSolo && next.barber_display_name ? ` · ${next.barber_display_name}` : ''}
                  </span>
                </span>
              </div>
            ) : (
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.home.nextEmpty')}</p>
            )}
          </section>

          {/* TODAY — le fil dense de la journée (régime DENSE, P1PRO §3). */}
          <section className={`${panelClass} order-6 lg:order-6 lg:col-span-3`} data-testid="pro-home-today">
            <PanelTitle label={t('pro.home.timelineLabel')} />
            {scoped.length === 0 ? (
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.home.nextEmpty')}</p>
            ) : (
              <div className="mt-1">
                {[...scoped]
                  .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                  .map((row) => {
                    /* Une rangée passée s'ATTÉNUE par la hiérarchie de couleur
                       (secondaire, 6,55:1 — AA), jamais par une opacité qui
                       ferait tomber le texte sous le contraste (axe). */
                    const settled = row.status === 'completed' || row.status === 'cancelled' || row.status === 'no_show'
                    return (
                    <Row
                      key={row.id}
                      className="px-0"
                      leading={
                        <span className="font-fu-mono text-fu-sm tabular-nums text-[var(--fu-text-secondary)]">
                          <DateTime value={row.starts_at} timezone={row.location_timezone} format="time" />
                        </span>
                      }
                      title={
                        <span className={`text-fu-sm font-medium ${settled ? 'text-[color:var(--fu-text-secondary)]' : ''}`}>
                          {row.customer_name || row.service_name}
                        </span>
                      }
                      subtitle={
                        <span className="flex flex-wrap items-center gap-x-2">
                          <span>{row.service_name}</span>
                          <Duration
                            minutes={Math.max(1, Math.round((Date.parse(row.ends_at) - Date.parse(row.starts_at)) / 60000))}
                          />
                          {!isSolo && row.barber_display_name && <span>{row.barber_display_name}</span>}
                        </span>
                      }
                      trailing={
                        row.status === 'pending' ? (
                          <StateBadge state="pending-request" size="sm" />
                        ) : row.status === 'completed' ? (
                          /* « Réalisée », pas « Confirmé » : le badge dit
                             l'état RÉEL, même au passé. */
                          <span className="text-fu-xs text-[var(--fu-text-secondary)]">
                            {t('pro.requests.outcome.completed')}
                          </span>
                        ) : row.status === 'cancelled' || row.status === 'no_show' ? (
                          <span className="text-fu-xs text-[var(--fu-text-secondary)]">
                            {row.status === 'cancelled' ? t('pro.home.statusCancelled') : t('pro.home.statusNoShow')}
                          </span>
                        ) : seesRevenue && row.price_cents !== null ? (
                          <Money cents={row.price_cents} currency={row.currency} className="font-fu-mono text-fu-sm tabular-nums" />
                        ) : undefined
                      }
                    />
                    )
                  })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

export default ProHomePage
