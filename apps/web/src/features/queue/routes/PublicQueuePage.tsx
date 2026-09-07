import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Row } from '@/shared/ui/Row'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { StickyActionBar } from '@/shared/ui/StickyActionBar'
import { useToast } from '@/shared/ui/Toast'
import { IconLocation, IconShop } from '@/shared/ui/icons'
import {
  usePublicOrganizationName,
  usePublicQueueServiceState,
  usePublicQueues,
  usePublicQueueStatus,
  useMyQueueStatus,
  useQueuePublicLocations,
  useQueueEntryTracking,
  useLeaveQueue,
  useChangeQueueBarber,
  QueueJoinRefusedError,
  type JoinQueueResult,
  type PublicQueueFile,
} from '@/features/queue/api/publicQueue'
import { refusalMessageKey } from '@/features/queue/lib/refusals'
import { JoinQueueSheet } from '@/features/queue/components/JoinQueueSheet'
import { QueueList } from '@/features/queue/components/QueueList'
import { QueueSummary, type PublicQueueState } from '@/features/queue/components/QueueSummary'
import { QueueTracking } from '@/features/queue/components/QueueTracking'
import {
  clearLocalQueueEntry,
  readLocalQueueEntry,
  saveLocalQueueEntry,
  type LocalQueueEntry,
} from '@/features/queue/lib/localEntry'

/**
 * /q/:slug — l'écran qu'un client ouvre depuis son canapé. PUBLIC : ni
 * authentification, ni géolocalisation, ni jeton pour CONSULTER. C'est ce
 * lien que le QR du salon encode, avec `?l=<lieu>&t=<jeton>` pour rejoindre.
 *
 * F1b : un barbershop expose UNE FILE PAR BARBER, « premier disponible » en
 * tête (le choix du barber est une possibilité, pas une obligation). Un
 * salon à un seul barber garde l'écran F1 d'origine — lui proposer de
 * « choisir » son unique barber serait du bruit. Le suivi de place passe par
 * `get_queue_entry_tracking` : position dans SA file, échéance d'appel,
 * estimation, sortie, changement de barber.
 */
export function PublicQueuePage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()
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
  const [joinTarget, setJoinTarget] = useState<PublicQueueFile | null>(null)
  const [localEntry, setLocalEntry] = useState<LocalQueueEntry | null>(() => readLocalQueueEntry())

  // Une entrée locale d'un AUTRE salon ne concerne pas cet écran.
  const relevantLocal = localEntry && localEntry.slug === slug && localEntry.locationId === locationId ? localEntry : null

  const serviceState = usePublicQueueServiceState(slug, isServiceArea ? null : locationId)
  const queues = usePublicQueues(slug, isServiceArea ? null : locationId, {
    pollInBackground: Boolean(relevantLocal),
  })
  // Le tableau public reste la source du compte global (résumé solo).
  const queueStatus = usePublicQueueStatus(slug, isServiceArea ? null : locationId, {})
  const myQueue = useMyQueueStatus(Boolean(session))

  // L'identifiant de la PROPRE entrée : trace locale d'abord (elle survit à
  // la déconnexion), sinon la file active du compte sur ce lieu (autre
  // appareil du même client connecté).
  const trackedEntryId =
    relevantLocal?.entryId ??
    (session ? ((myQueue.data ?? []).find((entry) => entry.location_id === locationId)?.id ?? null) : null)

  const tracking = useQueueEntryTracking(trackedEntryId)
  const leave = useLeaveQueue()
  const change = useChangeQueueBarber()

  // « Disparue » = le serveur ne connaît plus cette entrée (entry_not_found),
  // ou elle appartient à un autre compte (session changée sur cet appareil).
  const trackedGone = Boolean(
    trackedEntryId && tracking.isError && tracking.error instanceof QueueJoinRefusedError,
  )

  const handleJoined = useCallback(
    (entry: JoinQueueResult, authenticated: boolean) => {
      if (!locationId) return
      const record: LocalQueueEntry = { entryId: entry.id, slug, locationId, joinedAt: entry.created_at }
      // Même connectés, on garde la trace locale : le suivi survit à une
      // déconnexion et la RPC de suivi répond sans session.
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

  const surfaceQueueError = useCallback(
    (error: unknown) => {
      toast({
        title:
          error instanceof QueueJoinRefusedError
            ? t(refusalMessageKey(error.code))
            : t('errors.data.unknown'),
        tone: 'error',
      })
    },
    [toast, t],
  )

  const handleLeave = useCallback(() => {
    if (!trackedEntryId) return
    leave.mutate(trackedEntryId, { onError: surfaceQueueError })
  }, [trackedEntryId, leave, surfaceQueueError])

  const handleChangeBarber = useCallback(
    (toBarberId: string | null) => {
      if (!trackedEntryId || !locationId) return
      change.mutate(
        { entryId: trackedEntryId, toBarberId },
        {
          onSuccess: (row) => {
            // L'entrée a été RÉINSÉRÉE : nouvel identifiant, nouvelle trace.
            const record: LocalQueueEntry = { entryId: row.id, slug, locationId, joinedAt: row.created_at }
            saveLocalQueueEntry(record)
            setLocalEntry(record)
          },
          onError: surfaceQueueError,
        },
      )
    },
    [trackedEntryId, locationId, change, slug, surfaceQueueError],
  )

  // Titre de l'onglet : le nom réel du salon.
  useEffect(() => {
    const name = organization.data?.name
    if (name) document.title = `${name} — FadeUp`
  }, [organization.data?.name])

  const queueFiles = queues.data ?? []
  // Un salon à UN barber garde l'expérience F1 : un résumé, un geste.
  const barberFiles = queueFiles.filter((file) => file.barber_id !== null)
  const multiBarber = barberFiles.length > 1
  const firstAvailable = queueFiles.find((file) => file.barber_id === null) ?? null

  const waitingCount = (queueStatus.data ?? []).filter((entry) => entry.status === 'waiting').length
  const state = serviceState.data
  const queueState: PublicQueueState = serviceState.isError
    ? 'unknown'
    : state
      ? state.queue_accepting_new_entries
        ? 'open'
        : 'closed'
      : 'unknown'
  const isTracking = Boolean((trackedEntryId && !tracking.isError) || trackedGone)
  const canJoin = queueState === 'open' && !isTracking && !isServiceArea && Boolean(locationId)

  const openJoin = useCallback((target: PublicQueueFile | null) => {
    setJoinTarget(target)
    setJoinOpen(true)
  }, [])

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
          {isTracking ? (
            <QueueTracking
              entry={tracking.data ?? null}
              gone={trackedGone}
              organizationName={organization.data?.name ?? ''}
              queues={queueFiles}
              busy={leave.isPending || change.isPending}
              onLeave={handleLeave}
              onChangeBarber={handleChangeBarber}
              onDismiss={dismissTracking}
            />
          ) : queueStatus.isPending || serviceState.isPending || queues.isPending ? (
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
          ) : multiBarber ? (
            /* F1b : les files du salon — « premier disponible » en tête,
               puis les barbers du plus court au plus long. Toucher une file
               ouvre le geste « rejoindre » sur CETTE file. */
            <section aria-label={t('queue.public.queuesLabel')} className="mt-6">
              <QueueSummary
                waitingCount={waitingCount}
                queueState={queueState}
                estimatedWaitMinutes={null}
              />
              <QueueList queues={queueFiles} onPick={canJoin ? openJoin : undefined} />
            </section>
          ) : (
            <QueueSummary
              waitingCount={waitingCount}
              queueState={queueState}
              /* Salon solo : l'estimation de la file « premier disponible »
                 vient de l'estimateur F1b — null tant qu'elle n'est pas
                 fiable, et alors RIEN n'est affiché. */
              estimatedWaitMinutes={firstAvailable?.estimated_wait_minutes ?? null}
            />
          )}

          {queueState === 'closed' && !isTracking && (
            <p className="text-center text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.public.closedHint')}</p>
          )}

          {canJoin && (
            /* Sous 768 px la nav basse consumer occupe le bord de l'écran
               (3,5 rem + safe-area) : la barre d'action se pose AU-DESSUS,
               jamais dessous. Le CTA collant rejoint « premier disponible » —
               beaucoup de clients veulent juste être servis. */
            <StickyActionBar className="bottom-14 pb-3 md:bottom-0 md:pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              <Button variant="primary" size="lg" onClick={() => openJoin(firstAvailable)} data-testid="queue-join-cta">
                {t('queue.public.joinCta')}
              </Button>
            </StickyActionBar>
          )}

          {locationId && (
            <JoinQueueSheet
              open={joinOpen}
              onOpenChange={(next) => {
                setJoinOpen(next)
                if (!next) setJoinTarget(null)
              }}
              slug={slug}
              locationId={locationId}
              initialToken={urlToken}
              targetQueue={joinTarget}
              onJoined={handleJoined}
            />
          )}
        </>
      )}
    </div>
  )
}
