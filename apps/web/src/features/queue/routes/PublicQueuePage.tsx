import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Row } from '@/shared/ui/Row'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { StickyActionBar } from '@/shared/ui/StickyActionBar'
import { IconLocation, IconShop } from '@/shared/ui/icons'
import {
  usePublicOrganizationName,
  usePublicQueueServiceState,
  usePublicQueueStatus,
  useMyQueueStatus,
  useQueuePublicLocations,
  type JoinQueueResult,
} from '@/features/queue/api/publicQueue'
import { JoinQueueSheet } from '@/features/queue/components/JoinQueueSheet'
import { QueueSummary, type PublicQueueState } from '@/features/queue/components/QueueSummary'
import { QueueTracking, type TrackedEntry } from '@/features/queue/components/QueueTracking'
import {
  clearLocalQueueEntry,
  readLocalQueueEntry,
  saveLocalQueueEntry,
  type LocalQueueEntry,
} from '@/features/queue/lib/localEntry'

/**
 * /q/:slug — l'écran qu'un client ouvre depuis son canapé. PUBLIC : ni
 * authentification, ni géolocalisation, ni jeton pour CONSULTER (vérifié
 * dans le schéma, F1 §2). C'est ce lien que le QR du salon encode, avec
 * `?l=<lieu>&t=<jeton>` en plus pour rejoindre.
 *
 * Une seule question : y a-t-il du monde ? — puis un seul geste : rejoindre.
 */
export function PublicQueuePage() {
  const { t } = useTranslation('v2')
  const { slug = '' } = useParams()
  const [searchParams] = useSearchParams()
  const { session } = useSession()

  const urlLocationId = searchParams.get('l')
  const urlToken = searchParams.get('t')

  const organization = usePublicOrganizationName(slug)
  const locations = useQueuePublicLocations(slug)

  // Résolution du lieu : paramètre du QR, sinon lieu unique, sinon choix.
  const resolvedLocation = useMemo(() => {
    const rows = locations.data ?? []
    if (urlLocationId) return rows.find((row) => row.id === urlLocationId) ?? null
    if (rows.length === 1) return rows[0] ?? null
    return null
  }, [locations.data, urlLocationId])

  const locationId = resolvedLocation?.id ?? null
  const isServiceArea = resolvedLocation?.kind === 'service_area'

  const [joinOpen, setJoinOpen] = useState(false)
  const [localEntry, setLocalEntry] = useState<LocalQueueEntry | null>(() => readLocalQueueEntry())

  const serviceState = usePublicQueueServiceState(slug, isServiceArea ? null : locationId)
  const queueStatus = usePublicQueueStatus(slug, isServiceArea ? null : locationId, {
    // Un client qui SUIT SA PLACE garde son poll actif même onglet caché :
    // c'est ce qui porte l'appel et sa notification.
    pollInBackground: Boolean(localEntry && localEntry.slug === slug),
  })
  const myQueue = useMyQueueStatus(Boolean(session))

  // Une entrée locale d'un AUTRE salon ne concerne pas cet écran.
  const relevantLocal = localEntry && localEntry.slug === slug && localEntry.locationId === locationId ? localEntry : null

  const trackedFromAccount: TrackedEntry | null = useMemo(() => {
    if (!session) return null
    const row = (myQueue.data ?? []).find((entry) => entry.location_id === locationId)
    if (!row) return null
    return { id: row.id, status: row.status, queuePosition: row.queue_position }
  }, [session, myQueue.data, locationId])

  const trackedFromLocal: TrackedEntry | null = useMemo(() => {
    if (!relevantLocal) return null
    const row = (queueStatus.data ?? []).find((entry) => entry.id === relevantLocal.entryId)
    if (!row) return null
    return { id: row.id, status: row.status, queuePosition: row.queue_position }
  }, [relevantLocal, queueStatus.data])

  const tracked = trackedFromAccount ?? trackedFromLocal
  // « Disparue » = l'entrée suivie n'est plus dans les états actifs — servie,
  // sortie après grâce, ou retirée. Jamais déclaré avant la première réponse.
  const trackedGone = Boolean(
    !tracked &&
      relevantLocal &&
      queueStatus.isSuccess &&
      (!session || myQueue.isSuccess),
  )

  const handleJoined = useCallback(
    (entry: JoinQueueResult, authenticated: boolean) => {
      if (!locationId) return
      const record: LocalQueueEntry = { entryId: entry.id, slug, locationId, joinedAt: entry.created_at }
      // Même connectés, on garde la trace locale : le suivi survit à une
      // déconnexion et le poll public répond sans session.
      saveLocalQueueEntry(record)
      setLocalEntry(record)
      if (authenticated) void myQueue.refetch()
    },
    [locationId, slug, myQueue],
  )

  const dismissTracking = useCallback(() => {
    clearLocalQueueEntry()
    setLocalEntry(null)
  }, [])

  // Titre de l'onglet : le nom réel du salon.
  useEffect(() => {
    const name = organization.data?.name
    if (name) document.title = `${name} — FadeUp`
  }, [organization.data?.name])

  const waitingCount = (queueStatus.data ?? []).filter((entry) => entry.status === 'waiting').length
  const state = serviceState.data
  const queueState: PublicQueueState = serviceState.isError
    ? 'unknown'
    : state
      ? state.queue_accepting_new_entries
        ? 'open'
        : 'closed'
      : 'unknown'
  const canJoin = queueState === 'open' && !tracked && !isServiceArea && Boolean(locationId)

  if (organization.isSuccess && !organization.data) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <EmptyState
          title={t('queue.public.notFound.title')}
          description={t('queue.public.notFound.description')}
          action={
            <Button variant="secondary" onClick={() => window.history.back()}>
              {t('common.action.back')}
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-xl px-4 pb-28 pt-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-fu-xl font-semibold">
          {organization.data?.name ?? (organization.isPending ? '…' : slug)}
        </h1>
        {resolvedLocation && (locations.data ?? []).length > 1 && (
          <p className="flex items-center gap-1.5 text-fu-sm text-[var(--fu-text-secondary)]">
            <IconLocation aria-hidden="true" className="size-4" />
            {resolvedLocation.name}
          </p>
        )}
        <Link
          to={`/shop/${encodeURIComponent(slug)}`}
          className="mt-1 inline-flex min-h-11 items-center gap-1.5 self-start text-fu-sm font-medium text-[var(--fu-accent-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
        >
          <IconShop aria-hidden="true" className="size-4" />
          {t('queue.public.viewProfile')}
        </Link>
      </header>

      {/* Salon multi-lieux ouvert sans paramètre : choisir le lieu d'abord. */}
      {!resolvedLocation && (locations.data ?? []).length > 1 && (
        <section aria-label={t('queue.public.pickLocation')} className="mt-6">
          <p className="mb-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.public.pickLocation')}</p>
          {(locations.data ?? []).map((row) => (
            <Row
              key={row.id}
              as="link"
              to={`/q/${encodeURIComponent(slug)}?l=${row.id}`}
              title={row.name}
              subtitle={row.city ?? undefined}
              chevron
            />
          ))}
        </section>
      )}

      {locations.isPending && (
        <div className="mt-8 flex flex-col items-center gap-3">
          <SkeletonRect className="h-16 w-24" />
          <SkeletonRect className="h-4 w-40" />
        </div>
      )}

      {/* Zone de service : pas de salle d'attente — l'état RÉEL, avec une sortie. */}
      {isServiceArea && (
        <EmptyState
          className="mt-8"
          title={t('queue.public.serviceArea.title')}
          description={t('queue.public.serviceArea.description')}
          action={
            <Link
              to={`/shop/${encodeURIComponent(slug)}`}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-[var(--fu-accent)] px-4 text-fu-sm font-medium text-[var(--fu-accent-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2"
            >
              {t('queue.public.serviceArea.action')}
            </Link>
          }
        />
      )}

      {resolvedLocation && !isServiceArea && (
        <>
          {tracked || trackedGone ? (
            <QueueTracking
              entry={tracked}
              gone={trackedGone}
              organizationName={organization.data?.name ?? ''}
              onDismiss={dismissTracking}
            />
          ) : queueStatus.isPending || serviceState.isPending ? (
            <div className="mt-8 flex flex-col items-center gap-3" aria-busy="true">
              <SkeletonRect className="h-16 w-24" />
              <SkeletonRect className="h-4 w-40" />
            </div>
          ) : queueStatus.isError ? (
            <EmptyState
              className="mt-8"
              title={t('queue.public.error.title')}
              description={t('queue.public.error.description')}
              action={
                <Button variant="secondary" onClick={() => void queueStatus.refetch()}>
                  {t('common.action.retry')}
                </Button>
              }
            />
          ) : (
            <QueueSummary
              waitingCount={waitingCount}
              queueState={queueState}
              /* Aucune RPC publique ne fournit d'estimation fiable : null,
                 donc rien d'affiché — jamais une minute inventée. */
              estimatedWaitMinutes={null}
            />
          )}

          {queueState === 'closed' && !tracked && !trackedGone && (
            <p className="text-center text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.public.closedHint')}</p>
          )}

          {canJoin && (
            /* Sous 768 px la nav basse consumer occupe le bord de l'écran
               (3,5 rem + safe-area) : la barre d'action se pose AU-DESSUS,
               jamais dessous — premier écran à combiner les deux. */
            <StickyActionBar className="bottom-14 pb-3 md:bottom-0 md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <Button variant="primary" size="lg" onClick={() => setJoinOpen(true)} data-testid="queue-join-cta">
                {t('queue.public.joinCta')}
              </Button>
            </StickyActionBar>
          )}

          {locationId && (
            <JoinQueueSheet
              open={joinOpen}
              onOpenChange={setJoinOpen}
              slug={slug}
              locationId={locationId}
              initialToken={urlToken}
              onJoined={handleJoined}
            />
          )}
        </>
      )}
    </div>
  )
}
