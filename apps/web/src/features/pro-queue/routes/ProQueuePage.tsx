import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProOrganization } from '@/shared/data/organization'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Row } from '@/shared/ui/Row'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { Select } from '@/shared/ui/Select'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { Switch } from '@/shared/ui/Switch'
import { useToast } from '@/shared/ui/Toast'
import { IconPending, IconQr, IconQueue, IconSettings } from '@/shared/ui/icons'
import {
  useCompleteAndCallNext,
  useDurationInsights,
  useMoveQueueEntry,
  useProQueue,
  useProQueueBarbers,
  useProQueueChannel,
  useQueueCheckIn,
  useQueueTransition,
  useServiceModeState,
  useSetQueueOpen,
  useSetServiceMode,
  type ProQueueEntry,
  type ServiceMode,
} from '@/features/pro-queue/api/proQueue'
import { Sheet } from '@/shared/ui/Sheet'
import { ProQueueEntryRow } from '@/features/pro-queue/components/ProQueueEntryRow'
import { useNow } from '@/features/pro-queue/lib/useNow'
import { canManageQueueSettings } from '@/features/pro-queue/lib/queueSettings'

/**
 * /dashboard/queue — l'outil du comptoir : debout, entre deux clients, un
 * téléphone dans une main. Densité et rapidité avant l'élégance (F1 §4).
 *
 * - Ouvrir/fermer : UN geste, confirmation immédiate.
 * - « Appeler le suivant » : barre basse collante, au pouce, sans défilement.
 * - Les seuils (grâce, capacité, géofence) sont LUS EN BASE
 *   (`get_location_queue_check_in`) — jamais codés en dur.
 * - Realtime : canal `queue:<location_id>`, écriture DIRECTE du cache — le
 *   seul endroit du produit où c'est autorisé. Seul l'élément modifié s'anime.
 * - Réorganisation manuelle : PAS CONSTRUITE — aucun support en base
 *   (ni colonne de position, ni RPC, ni audit : la position dérive de
 *   `created_at`). Écart F1 remonté au rapport, rien n'est simulé.
 */

const SERVICE_MODES: ServiceMode[] = ['hybrid', 'reservation_only', 'queue_only', 'unavailable']

export function ProQueuePage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  const { organization, loading: organizationLoading } = useProOrganization()

  const [pickedLocationId, setPickedLocationId] = useState<string | null>(null)
  const locations = organization?.locations ?? []
  const location = locations.find((row) => row.id === pickedLocationId) ?? locations[0] ?? null
  const locationId = location?.id ?? null
  const isServiceArea = location?.kind === 'service_area'

  const queue = useProQueue(isServiceArea ? null : locationId)
  useProQueueChannel(isServiceArea ? null : locationId)
  const checkIn = useQueueCheckIn(isServiceArea ? null : locationId)
  const modes = useServiceModeState(locationId)
  const barbers = useProQueueBarbers(isServiceArea ? null : locationId)
  const insights = useDurationInsights(isServiceArea ? null : locationId)
  const transition = useQueueTransition(locationId)
  const completeAndNext = useCompleteAndCallNext(locationId)
  const moveEntry = useMoveQueueEntry(locationId)
  const setQueueOpen = useSetQueueOpen(locationId)
  const setServiceMode = useSetServiceMode(locationId)
  const now = useNow(1_000)

  const [movingEntry, setMovingEntry] = useState<ProQueueEntry | null>(null)

  const entries = queue.data ?? []
  const inService = entries.filter((entry) => entry.status === 'in_service')
  const called = entries.filter((entry) => entry.status === 'called')
  const waiting = entries.filter((entry) => entry.status === 'waiting')

  // F1b — les files : « premier disponible » puis chaque barber. Le
  // regroupement n'apparaît que si PLUSIEURS barbers prennent la file ; un
  // salon solo garde la liste plate de F1.
  const barberRows = barbers.data ?? []
  const queueCapableBarbers = barberRows.filter((row) => row.queue_enabled && row.is_bookable)
  const multiFile = queueCapableBarbers.length > 1
  const barberNameById = useMemo(
    () => new Map(barberRows.map((row) => [row.id, row.display_name])),
    [barberRows],
  )
  const waitingFiles = useMemo(() => {
    if (!multiFile) return null
    const groups: { barberId: string | null; name: string | null; entries: typeof waiting }[] = []
    const firstAvailable = waiting.filter((entry) => entry.barber_id === null)
    if (firstAvailable.length > 0) groups.push({ barberId: null, name: null, entries: firstAvailable })
    const seen = new Set<string>()
    for (const entry of waiting) {
      if (entry.barber_id === null || seen.has(entry.barber_id)) continue
      seen.add(entry.barber_id)
      groups.push({
        barberId: entry.barber_id,
        name: barberNameById.get(entry.barber_id) ?? null,
        entries: waiting.filter((row) => row.barber_id === entry.barber_id),
      })
    }
    return groups
  }, [multiFile, waiting, barberNameById])

  const locationMode = useMemo(() => (modes.data ?? []).find((row) => row.scope === 'location'), [modes.data])
  const queueOpen = locationMode?.queue_open ?? null
  const graceMinutes = checkIn.data?.queue_call_grace_minutes ?? null
  const capacityPerBarber = checkIn.data?.queue_capacity_per_barber ?? null

  const canManageSettings = canManageQueueSettings(organization?.role)

  const busy = transition.isPending || completeAndNext.isPending

  // Un échec de transition NE DOIT PAS être silencieux : c'est un 403
  // silencieux qui a caché le défaut de GRANT de B1 sur queue_stage.
  const surfaceError = { onError: () => toast({ title: t('errors.data.unknown'), tone: 'error' as const }) }

  const callNext = () => {
    const next = waiting[0]
    if (next) transition.mutate({ entryId: next.id, status: 'called' }, surfaceError)
  }

  const toggleQueue = (open: boolean) => {
    setQueueOpen.mutate(open, {
      onSuccess: () => {
        toast({
          title: open ? t('queue.pro.toast.opened') : t('queue.pro.toast.closed'),
          tone: 'success',
        })
      },
      onError: () => toast({ title: t('errors.data.unknown'), tone: 'error' }),
    })
  }

  if (organizationLoading) {
    return (
      <div className="p-4">
        <SkeletonRow />
        <SkeletonRow />
      </div>
    )
  }

  if (!location) {
    return (
      <div className="p-4">
        <EmptyState
          title={t('queue.pro.noLocation.title')}
          description={t('queue.pro.noLocation.description')}
          action={
            <Link
              to="/setup"
              className="text-fu-sm font-medium text-[var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
            >
              {t('queue.setup.title')}
            </Link>
          }
        />
      </div>
    )
  }

  if (isServiceArea) {
    // Une zone de service n'a pas de salle d'attente — décision B1, l'écran
    // le dit au lieu de proposer une file qui refuserait tout le monde.
    return (
      <div className="p-4">
        <EmptyState
          icon={<IconQueue aria-hidden="true" className="size-6" />}
          title={t('queue.pro.serviceArea.title')}
          description={t('queue.pro.serviceArea.description')}
          action={
            <Link
              to="/dashboard"
              className="text-fu-sm font-medium text-[var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
            >
              {t('common.action.goHome')}
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24">
      {locations.length > 1 && (
        <Select
          label={t('queue.pro.locationLabel')}
          options={locations.map((row) => ({ value: row.id, label: row.name }))}
          value={location.id}
          onValueChange={setPickedLocationId}
        />
      )}

      {/* L'état de la file en un coup d'œil + LE geste du matin et du soir. */}
      <section className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
            {t('queue.pro.title').toLocaleUpperCase()}
          </h2>
          <div className="flex items-center gap-3">
            <p className="font-fu-mono text-fu-3xl font-semibold tabular-nums leading-none" data-testid="pro-queue-waiting-count">
              {waiting.length}
            </p>
            {queueOpen === null ? (
              <StateBadge state="partial-data" size="sm" />
            ) : (
              <StateBadge state={queueOpen ? 'queue-open' : 'queue-closed'} size="sm" />
            )}
          </div>
          {capacityPerBarber !== null && (
            <p className="text-fu-xs text-[var(--fu-text-secondary)]">
              {t('queue.pro.capacityPerBarber', { count: capacityPerBarber })}
            </p>
          )}
        </div>
        <Switch
          label={t('queue.pro.openSwitch')}
          checked={queueOpen ?? false}
          disabled={queueOpen === null || setQueueOpen.isPending}
          onCheckedChange={toggleQueue}
        />
      </section>

      {/* Mode de service : ce que le profil public accepte, répercuté client. */}
      <section className="rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4">
        <h2 className="mb-3 font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
          {t('queue.pro.modeTitle').toLocaleUpperCase()}
        </h2>
        <SegmentedControl
          label={t('queue.pro.modeTitle')}
          options={SERVICE_MODES.map((mode) => ({ value: mode, label: t(`queue.pro.mode.${mode}`) }))}
          value={locationMode?.location_default_service_mode ?? 'hybrid'}
          onValueChange={(value) => setServiceMode.mutate(value as ServiceMode)}
        />
        {locationMode && locationMode.mode_source !== 'location_default' && (
          <p className="mt-2 inline-flex items-baseline gap-1 text-fu-xs text-[var(--fu-text-secondary)]">
            {t('queue.pro.modeOverrideLabel', {
              mode: t(`queue.pro.mode.${locationMode.effective_service_mode}`),
            })}
            {locationMode.mode_expires_at ? (
              <DateTime value={locationMode.mode_expires_at} timezone={location.timezone} format="time" />
            ) : null}
          </p>
        )}
      </section>

      {/* Le QR du salon : affichage grand format + impression + régénération. */}
      {checkIn.data && (
        <Row
          as="link"
          to="/dashboard/queue/qr"
          leading={<IconQr aria-hidden="true" className="size-5 text-[var(--fu-text-secondary)]" />}
          title={t('queue.pro.qrRow.title')}
          subtitle={t('queue.pro.qrRow.subtitle')}
          chevron
          className="rounded-[var(--radius-card)] border border-[var(--fu-border)]"
        />
      )}

      {/* La file elle-même : au fauteuil, appelés, en attente. */}
      <section className="rounded-[var(--radius-card)] bg-[var(--fu-surface)] p-4">
        <h2 className="font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
          {t('queue.pro.listTitle').toLocaleUpperCase()}
        </h2>
        {queue.isPending ? (
          <>
            <SkeletonRow className="px-0" />
            <SkeletonRow className="px-0" />
          </>
        ) : entries.length === 0 ? (
          <EmptyState
            className="px-0 py-8"
            title={t('queue.pro.empty.title')}
            description={queueOpen ? t('queue.pro.empty.openHint') : t('queue.pro.empty.closedHint')}
            action={
              queueOpen === false ? (
                <Button variant="secondary" size="sm" disabled={setQueueOpen.isPending} onClick={() => toggleQueue(true)}>
                  {t('queue.pro.empty.openAction')}
                </Button>
              ) : (
                <Link to="/dashboard/queue/qr" className="text-fu-sm font-medium text-[var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]">
                  {t('queue.pro.empty.qrAction')}
                </Link>
              )
            }
          />
        ) : (
          <div data-testid="pro-queue-list">
            {[...inService, ...called].map((entry) => (
              <ProQueueEntryRow
                key={entry.id}
                entry={entry}
                position={null}
                graceMinutes={graceMinutes}
                timezone={location.timezone}
                now={now}
                busy={busy}
                onCall={(id) => transition.mutate({ entryId: id, status: 'called' }, surfaceError)}
                onArrived={(id) => transition.mutate({ entryId: id, status: 'in_service' }, surfaceError)}
                onNoShow={(id) => transition.mutate({ entryId: id, status: 'no_show' }, surfaceError)}
                onComplete={(id) => completeAndNext.mutate({ entryId: id }, surfaceError)}
              />
            ))}
            {waitingFiles ? (
              /* F1b — l'attente PAR FILE : « premier disponible » d'abord,
                 position calculée dans la file, geste « Déplacer » par rangée. */
              waitingFiles.map((file) => (
                <div key={file.barberId ?? 'first-available'} data-testid="pro-queue-file">
                  <h3 className="mt-3 font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
                    {(file.barberId === null ? t('queue.pro.fileHeaderFirstAvailable') : (file.name ?? '')).toLocaleUpperCase()}
                    {' · '}
                    {file.entries.length}
                  </h3>
                  {file.entries.map((entry, index) => (
                    <ProQueueEntryRow
                      key={entry.id}
                      entry={entry}
                      position={index + 1}
                      graceMinutes={graceMinutes}
                      timezone={location.timezone}
                      now={now}
                      busy={busy}
                      onCall={(id) => transition.mutate({ entryId: id, status: 'called' }, surfaceError)}
                      onArrived={(id) => transition.mutate({ entryId: id, status: 'in_service' }, surfaceError)}
                      onNoShow={(id) => transition.mutate({ entryId: id, status: 'no_show' }, surfaceError)}
                      onComplete={(id) => completeAndNext.mutate({ entryId: id }, surfaceError)}
                      onMove={setMovingEntry}
                    />
                  ))}
                </div>
              ))
            ) : (
              waiting.map((entry, index) => (
                <ProQueueEntryRow
                  key={entry.id}
                  entry={entry}
                  position={index + 1}
                  graceMinutes={graceMinutes}
                  timezone={location.timezone}
                  now={now}
                  busy={busy}
                  onCall={(id) => transition.mutate({ entryId: id, status: 'called' }, surfaceError)}
                  onArrived={(id) => transition.mutate({ entryId: id, status: 'in_service' }, surfaceError)}
                  onNoShow={(id) => transition.mutate({ entryId: id, status: 'no_show' }, surfaceError)}
                  onComplete={(id) => completeAndNext.mutate({ entryId: id }, surfaceError)}
                />
              ))
            )}
          </div>
        )}
      </section>

      {/* F1b — durées : ce que FadeUp a appris. Visible dès qu'une mesure existe. */}
      {(insights.data?.length ?? 0) > 0 && (
        <Row
          as="link"
          to="/dashboard/queue/durations"
          leading={<IconPending aria-hidden="true" className="size-5 text-[var(--fu-text-secondary)]" />}
          title={t('queue.pro.durationsRow.title')}
          subtitle={t('queue.pro.durationsRow.subtitle')}
          chevron
          className="rounded-[var(--radius-card)] border border-[var(--fu-border)]"
        />
      )}

      {/* OS-2 — les réglages ont quitté cet écran : la file se tient DEBOUT au
          comptoir, les seuils se règlent ASSIS. Rendu pour les seuls rôles que
          la page de réglages concerne (garde SQL owner/manager). */}
      {canManageSettings && (
        <div data-testid="pro-queue-settings-link">
          <Row
            as="link"
            to="/dashboard/queue/settings"
            leading={<IconSettings aria-hidden="true" className="size-5 text-[var(--fu-text-secondary)]" />}
            title={t('queue.settings.link')}
            subtitle={t('queue.settings.linkHint')}
            chevron
            className="rounded-[var(--radius-card)] border border-[var(--fu-border)]"
          />
        </div>
      )}

      {/* F1b — la feuille « Déplacer » : vers « premier disponible » ou vers
          la file d'un autre barber. Le client garde son ancienneté. */}
      <Sheet
        open={movingEntry !== null}
        onOpenChange={(next) => {
          if (!next) setMovingEntry(null)
        }}
        title={movingEntry ? t('queue.pro.moveSheet.title', { name: movingEntry.customer_name.split(' ')[0] }) : ''}
        description={t('queue.pro.moveSheet.description')}
      >
        <div className="flex flex-col" data-testid="pro-queue-move-sheet">
          {movingEntry?.barber_id !== null && (
            <Row
              as="button"
              onClick={() => {
                if (!movingEntry) return
                moveEntry.mutate(
                  { entryId: movingEntry.id, toBarberId: null },
                  {
                    onSuccess: () => {
                      setMovingEntry(null)
                      toast({ title: t('queue.pro.movedToast'), tone: 'success' })
                    },
                    onError: () => toast({ title: t('errors.data.unknown'), tone: 'error' }),
                  },
                )
              }}
              disabled={moveEntry.isPending}
              title={t('queue.pro.moveSheet.toFirstAvailable')}
              chevron
            />
          )}
          {queueCapableBarbers
            .filter((barber) => barber.id !== movingEntry?.barber_id)
            .map((barber) => (
              <Row
                key={barber.id}
                as="button"
                onClick={() => {
                  if (!movingEntry) return
                  moveEntry.mutate(
                    { entryId: movingEntry.id, toBarberId: barber.id },
                    {
                      onSuccess: () => {
                        setMovingEntry(null)
                        toast({ title: t('queue.pro.movedToast'), tone: 'success' })
                      },
                      onError: () => toast({ title: t('errors.data.unknown'), tone: 'error' }),
                    },
                  )
                }}
                disabled={moveEntry.isPending}
                title={barber.display_name}
                chevron
              />
            ))}
        </div>
      </Sheet>

      {/* LE geste le plus fréquent de la journée — au pouce, sans défilement.
          Pro : filet, PAS d'ombre (P1 §7). */}
      <div className="fixed start-0 end-0 bottom-0 z-[var(--fu-z-sticky)] border-t border-[var(--fu-border)] bg-[var(--fu-canvas)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 lg:ps-60">
        <div className="mx-auto w-full max-w-4xl">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={waiting.length === 0 || busy}
            onClick={callNext}
            data-testid="pro-queue-call-next"
          >
            {waiting.length === 0
              ? t('queue.pro.callNextEmpty')
              : t('queue.pro.callNext', { name: waiting[0] ? waiting[0].customer_name.split(' ')[0] : '' })}
          </Button>
        </div>
      </div>
    </div>
  )
}
