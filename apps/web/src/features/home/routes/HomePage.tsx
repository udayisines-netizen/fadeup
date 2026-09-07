import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  rowAvailability,
  useProfessionalSearchSlice,
  useResultCurrencies,
  useResultServiceStates,
  type ResultAvailability,
} from '@/shared/data/discovery'
import { rankResults } from '@/shared/lib/searchRanking'
import { discoveryKeys } from '@/shared/data/keys'
import { useDocumentMeta } from '@/shared/hooks/useDocumentMeta'
import { useNow } from '@/shared/hooks/useNow'
import { useSession } from '@/shared/hooks/useSession'
import { readLocalQueueEntry } from '@/shared/lib/localQueueEntry'
import { Avatar } from '@/shared/ui/Avatar'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Input } from '@/shared/ui/Input'
import { Row } from '@/shared/ui/Row'
import { SearchResultRow } from '@/shared/ui/SearchResultRow'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconSearch } from '@/shared/ui/icons'
import {
  activeQueueEntry,
  lastCompletedAppointment,
  nextAppointment,
  useAnonymousQueueTracking,
  useFollowedProfessionals,
  useMyAppointments,
  useMyQueueStatus,
} from '@/features/home/api/home'

/**
 * F3 — l'accueil (MASTER_SPEC §3) : ORIENTÉ ACTION, pas éditorial. Un client
 * ouvre FadeUp pour FAIRE quelque chose.
 *
 * Les trois cas :
 * · file active — la position EN HAUT, immédiatement visible, avec le chemin
 *   vers le suivi complet (/q/:slug, l'écran F1b — réutilisé par la route,
 *   pas recopié) ;
 * · client récurrent — prochaine réservation, « réserver à nouveau »
 *   prérempli (tunnel F4 : convention NotBuilt du codebase), profils suivis ;
 * · visiteur — la recherche et de la découverte locale, RIEN d'autre :
 *   aucune section vide, aucun remplissage.
 *
 * Chaque section ne se rend QUE si sa donnée réelle existe.
 */

export function HomePage() {
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const { session } = useSession()
  const now = useNow(30_000)
  useDocumentMeta({ title: null })

  /* --- File active : connecté par get_my_queue_status, anonyme par la
         mémoire locale F1b + suivi public. --------------------------------- */
  const myQueue = useMyQueueStatus(Boolean(session))
  const [localEntry] = useState(() => readLocalQueueEntry())
  const anonymousTracking = useAnonymousQueueTracking(!session && localEntry ? localEntry.entryId : null)
  const activeEntry = activeQueueEntry(myQueue.data)
  const anonymousActive =
    !session &&
    localEntry &&
    anonymousTracking.data &&
    (anonymousTracking.data.status === 'waiting' ||
      anonymousTracking.data.status === 'called' ||
      anonymousTracking.data.status === 'in_service')
      ? anonymousTracking.data
      : null

  /* --- Récurrence : rendez-vous et suivis. ------------------------------- */
  const appointments = useMyAppointments(Boolean(session))
  const next = nextAppointment(appointments.data, now)
  const lastCompleted = lastCompletedAppointment(appointments.data)
  const followed = useFollowedProfessionals(Boolean(session))

  /* --- Découverte locale : de vrais résultats, jamais du remplissage. ----- */
  const discoverArgs = useMemo(() => ({ p_limit: 6 }), [])
  const discover = useProfessionalSearchSlice(
    discoveryKeys.search({ surface: 'home', ...discoverArgs }),
    discoverArgs,
  )
  const discoverRows = useMemo(() => discover.data ?? [], [discover.data])
  const serviceStates = useResultServiceStates(
    useMemo(
      () => discoverRows.map((row) => ({ slug: row.organization_slug, locationId: row.location_id })),
      [discoverRows],
    ),
  )
  const currencies = useResultCurrencies(
    useMemo(() => discoverRows.map((row) => row.organization_id), [discoverRows]),
  )
  const discoverAvailability = useMemo(() => {
    const map: Record<string, ResultAvailability> = {}
    for (const row of discoverRows) map[row.location_id] = rowAvailability(row, serviceStates)
    return map
  }, [discoverRows, serviceStates])
  /* Classé UNE FOIS les états résolus (celui qui peut servir dans l'heure
     remonte — même module de poids que /search, revue F3 M6) ; avant, des
     squelettes : six lignes se résolvent vite, et rien ne se rebrasse sous
     le doigt. */
  const discoverReady = discover.isSuccess && serviceStates.settled
  const rankedDiscover = useMemo(
    () => rankResults(discoverRows, discoverAvailability, 'recommended', false),
    [discoverRows, discoverAvailability],
  )

  const queueHref = (slug: string, locationId: string) =>
    `/q/${encodeURIComponent(slug)}?l=${encodeURIComponent(locationId)}`

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-4 md:px-6">
      {/* LA FILE ACTIVE — toujours en tête quand elle existe. */}
      {activeEntry && (
        <section
          aria-live="polite"
          data-testid="home-active-queue"
          className="rounded-[var(--radius-card)] border border-[var(--fu-border-strong)] bg-[var(--fu-surface)] p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">
                {t('home.queue.title', { organization: activeEntry.organization_name })}
              </p>
              {activeEntry.status === 'waiting' && activeEntry.queue_position !== null && (
                <p className="mt-1 flex items-baseline gap-2">
                  <span
                    className="font-fu-mono text-fu-3xl font-semibold tabular-nums leading-none"
                    data-testid="home-queue-position"
                  >
                    {activeEntry.queue_position}
                  </span>
                  <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('home.queue.positionLabel')}</span>
                </p>
              )}
              {activeEntry.status === 'called' && <StateBadge state="called" className="mt-1" />}
              {activeEntry.status === 'in_service' && <StateBadge state="confirmed" className="mt-1" />}
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void navigate(queueHref(activeEntry.organization_slug, activeEntry.location_id))}
              data-testid="home-queue-cta"
            >
              {t('home.queue.cta')}
            </Button>
          </div>
        </section>
      )}

      {/* File active d'un client ANONYME (entrée locale F1b). */}
      {!activeEntry && anonymousActive && localEntry && (
        <section
          aria-live="polite"
          data-testid="home-active-queue-anonymous"
          className="rounded-[var(--radius-card)] border border-[var(--fu-border-strong)] bg-[var(--fu-surface)] p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('home.queue.anonymousTitle')}</p>
              {anonymousActive.status === 'waiting' && anonymousActive.queue_position !== null && (
                <p className="mt-1 flex items-baseline gap-2">
                  <span className="font-fu-mono text-fu-3xl font-semibold tabular-nums leading-none">
                    {anonymousActive.queue_position}
                  </span>
                  <span className="text-fu-sm text-[var(--fu-text-secondary)]">{t('home.queue.positionLabel')}</span>
                </p>
              )}
              {anonymousActive.status === 'called' && <StateBadge state="called" className="mt-1" />}
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={() => void navigate(queueHref(localEntry.slug, localEntry.locationId))}
            >
              {t('home.queue.cta')}
            </Button>
          </div>
        </section>
      )}

      {/* LA RECHERCHE — le geste principal de l'accueil. */}
      <section data-testid="home-search">
        <h1 className="mb-2 text-fu-xl font-semibold">{t('home.search.title')}</h1>
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault()
            const value = new FormData(event.currentTarget).get('q')
            const query = typeof value === 'string' ? value.trim() : ''
            void navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search')
          }}
        >
          <Input
            name="q"
            type="search"
            label={t('home.search.label')}
            placeholder={t('home.search.placeholder')}
            iconStart={<IconSearch />}
            data-testid="home-search-input"
          />
        </form>
      </section>

      {/* Prochaine réservation — seulement si elle existe. */}
      {next && (
        <section data-testid="home-next-appointment">
          <h2 className="mb-2 text-fu-lg font-semibold">{t('home.next.title')}</h2>
          <Row
            as="link"
            to="/bookings"
            chevron
            title={next.service_name}
            subtitle={`${next.organization_name} · ${next.barber_display_name}`}
          >
            <p className="mt-1 flex flex-wrap items-center gap-2 text-fu-sm text-[var(--fu-text-secondary)]">
              <DateTime value={next.starts_at} timezone={next.location_timezone} format="datetime" />
              {next.status === 'pending' && <StateBadge state="pending-request" size="sm" />}
            </p>
          </Row>
        </section>
      )}

      {/* Réserver à nouveau — le tunnel est F4 : la destination l'assume
          (convention NotBuilt), le CTA ne ment pas sur ce qui existe. */}
      {lastCompleted && (
        <section data-testid="home-rebook">
          <h2 className="mb-2 text-fu-lg font-semibold">{t('home.rebook.title')}</h2>
          <Row
            as="link"
            to={`/book/${encodeURIComponent(lastCompleted.organization_slug)}?service=${encodeURIComponent(lastCompleted.service_id)}&barber=${encodeURIComponent(lastCompleted.barber_id)}`}
            chevron
            title={t('home.rebook.cta', { barber: lastCompleted.barber_display_name })}
            subtitle={`${lastCompleted.service_name} · ${lastCompleted.organization_name}`}
          />
        </section>
      )}

      {/* Profils suivis — seulement s'il y en a. */}
      {(followed.data ?? []).length > 0 && (
        <section data-testid="home-followed">
          <h2 className="mb-2 text-fu-lg font-semibold">{t('home.followed.title')}</h2>
          <ul className="flex gap-4 overflow-x-auto pb-1">
            {(followed.data ?? []).map((profile) => (
              <li key={profile.id} className="shrink-0">
                <Link
                  to={`/pro/${encodeURIComponent(profile.handle)}`}
                  className="flex w-20 flex-col items-center gap-1.5 rounded-[var(--radius-control)] p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
                >
                  <Avatar name={profile.display_name} src={profile.avatar_url} size="lg" />
                  <span className="w-full truncate text-center text-fu-xs text-[var(--fu-text-secondary)]">
                    {profile.display_name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Découverte locale — de vrais établissements ; le chemin complet est
          /search. Rien ne se rend tant qu'il n'y a rien à montrer, et la
          liste est classée UNE FOIS les états résolus (celui qui peut servir
          dans l'heure remonte) — jamais rebrassée sous le doigt. */}
      {discoverRows.length > 0 && (
        <section data-testid="home-discover">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-fu-lg font-semibold">{t('home.discover.title')}</h2>
            <Link
              to="/search"
              className="text-fu-sm font-medium text-[var(--fu-text-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
            >
              {t('common.action.seeAll')}
            </Link>
          </div>
          <div
            className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]"
            aria-busy={!discoverReady}
          >
            {discoverReady ? (
              rankedDiscover.map((row) => (
                <SearchResultRow
                  key={row.location_id}
                  row={row}
                  currencyByOrganization={currencies.data}
                  availability={discoverAvailability[row.location_id] ?? 'loading'}
                />
              ))
            ) : (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
