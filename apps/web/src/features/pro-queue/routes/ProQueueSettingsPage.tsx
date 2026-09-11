import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProOrganization } from '@/shared/data/organization'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { Row } from '@/shared/ui/Row'
import { Select } from '@/shared/ui/Select'
import { SkeletonRect, SkeletonRow } from '@/shared/ui/Skeleton'
import { Switch } from '@/shared/ui/Switch'
import { useToast } from '@/shared/ui/Toast'
import { IconBack, IconPending, IconQueue } from '@/shared/ui/icons'
import {
  useDurationInsights,
  useProQueueBarbers,
  useQueueCheckIn,
  useSetBarberQueueEnabled,
  useSetGraceSweep,
  useSetQueueThresholds,
} from '@/features/pro-queue/api/proQueue'
import {
  canManageQueueSettings,
  changedThresholds,
  parseQueueSettingsRefusal,
  refusalTarget,
  thresholdErrors,
  toThresholdDraft,
  type ThresholdDraft,
  type ThresholdErrors,
  type ThresholdField,
  type Thresholds,
} from '@/features/pro-queue/lib/queueSettings'

/**
 * /dashboard/queue/settings — OS-2.
 *
 * La file (`/dashboard/queue`) est l'outil du comptoir : DENSE, debout, entre
 * deux clients. Les réglages sont l'inverse : on s'assoit, on décide, on
 * repart. Régime AÉRÉ SOBRE du contrat P1PRO §3 — des blocs de formulaire,
 * pas des rangées.
 *
 * Ce que cet écran ferme : les trois seuils (`queue_capacity_per_barber`,
 * `queue_call_grace_minutes`, `queue_geofence_meters`) existaient en base et
 * n'étaient réglables par PERSONNE. Ils sont désormais lus par
 * `get_location_queue_check_in` et écrits par `set_location_queue_thresholds`
 * — AUCUNE valeur par défaut n'est écrite dans ce fichier.
 *
 * Rôles (P1PRO §0bis, « capacité absente = non rendue ») : les trois blocs
 * d'écriture sont owner/manager, exactement la garde SQL. Un barber ou un
 * réceptionniste ne voit pas un formulaire grisé : il ne voit pas le bloc.
 */

const BLOCK = 'rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4 lg:p-5'
const BLOCK_TITLE = 'font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]'

export function ProQueueSettingsPage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  const { organization, loading: organizationLoading } = useProOrganization()

  const [pickedLocationId, setPickedLocationId] = useState<string | null>(null)
  const locations = organization?.locations ?? []
  const location = locations.find((row) => row.id === pickedLocationId) ?? locations[0] ?? null
  const locationId = location?.id ?? null
  const isServiceArea = location?.kind === 'service_area'

  const canManage = canManageQueueSettings(organization?.role)
  // Un rôle sans droit n'interroge même pas la RPC des seuils : elle lui
  // répondrait 42501 et l'écran n'a rien à en faire.
  const manageableLocationId = canManage && !isServiceArea ? locationId : null

  const checkIn = useQueueCheckIn(manageableLocationId)
  const barbers = useProQueueBarbers(manageableLocationId)
  const insights = useDurationInsights(isServiceArea ? null : locationId)
  const setThresholds = useSetQueueThresholds(locationId)
  const setBarberQueue = useSetBarberQueueEnabled(locationId)
  const setGraceSweep = useSetGraceSweep(locationId)

  /** Les seuils tels que la BASE les rend. `null` tant qu'ils ne sont pas lus. */
  const serverThresholds = useMemo<Thresholds | null>(() => {
    const row = checkIn.data
    if (!row) return null
    const { queue_capacity_per_barber: capacity, queue_call_grace_minutes: grace, queue_geofence_meters: geofence } = row
    if (capacity === null || grace === null || geofence === null) return null
    return { capacity, grace, geofence }
  }, [checkIn.data])

  // Synchronisation du brouillon PENDANT le rendu (motif React recommandé) :
  // au premier chargement comme après un enregistrement, le formulaire repart
  // de ce que le serveur a réellement retenu.
  // Le lieu fait partie de la signature : changer d'établissement recharge le
  // brouillon même quand les deux lieux ont, par hasard, les mêmes seuils.
  const signature = serverThresholds
    ? `${locationId}/${serverThresholds.capacity}/${serverThresholds.grace}/${serverThresholds.geofence}`
    : null
  const [syncedSignature, setSyncedSignature] = useState<string | null>(null)
  const [draft, setDraft] = useState<ThresholdDraft | null>(null)
  const [touched, setTouched] = useState<Partial<Record<ThresholdField, boolean>>>({})
  const [serverRefusal, setServerRefusal] = useState<{ field: ThresholdField | null; messageKey: string } | null>(null)

  if (serverThresholds && signature !== syncedSignature) {
    setSyncedSignature(signature)
    setDraft(toThresholdDraft(serverThresholds))
    setTouched({})
    setServerRefusal(null)
  }

  const clientErrors: ThresholdErrors = draft ? thresholdErrors(draft) : {}
  const changes = serverThresholds && draft ? changedThresholds(serverThresholds, draft) : null
  const hasClientError = Object.keys(clientErrors).length > 0

  const errorFor = (field: ThresholdField): string | undefined => {
    if (serverRefusal?.field === field) return t(serverRefusal.messageKey)
    if (touched[field] && clientErrors[field]) return t(clientErrors[field])
    return undefined
  }

  const editField = (field: ThresholdField) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value
    setDraft((previous) => (previous ? { ...previous, [field]: value } : previous))
    setTouched((previous) => ({ ...previous, [field]: true }))
    if (serverRefusal) setServerRefusal(null)
  }

  const submitThresholds = (event: React.FormEvent) => {
    event.preventDefault()
    if (!changes) return
    if (hasClientError) {
      setTouched({ capacity: true, grace: true, geofence: true })
      return
    }
    setThresholds.mutate(changes, {
      onSuccess: () => {
        setServerRefusal(null)
        toast({ title: t('queue.settings.toast.thresholdsSaved'), tone: 'success' })
      },
      onError: (raw) => {
        // La garde serveur reste la vérité : son refus nommé s'affiche, sur
        // le champ fautif quand il en désigne un.
        const code = parseQueueSettingsRefusal(raw)
        if (code) {
          setServerRefusal(refusalTarget(code))
          setTouched({ capacity: true, grace: true, geofence: true })
          return
        }
        toast({ title: t(errorMessageKey(toAppError(raw))), tone: 'error' })
      },
    })
  }

  const mutationFailed = { onError: (raw: unknown) => toast({ title: t(errorMessageKey(toAppError(raw))), tone: 'error' }) }

  const backLink = (
    <Link
      to="/dashboard/queue"
      className="text-fu-sm font-medium text-[var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
    >
      {t('queue.settings.back')}
    </Link>
  )

  const header = (
    <>
      <Link
        to="/dashboard/queue"
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-fu-sm font-medium text-[var(--fu-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
      >
        <IconBack aria-hidden="true" className="size-4" />
        {t('queue.settings.back')}
      </Link>
      <header className="flex flex-col gap-1">
        <h1 className="text-fu-xl font-semibold">{t('queue.settings.title')}</h1>
        <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.settings.description')}</p>
      </header>
    </>
  )

  if (organizationLoading) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24">
        <SkeletonRow />
        <SkeletonRect className="h-56 w-full" />
      </div>
    )
  }

  if (!location) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24">
        {header}
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

  const locationPicker = locations.length > 1 && (
    <Select
      label={t('queue.pro.locationLabel')}
      options={locations.map((row) => ({ value: row.id, label: row.name }))}
      value={location.id}
      onValueChange={setPickedLocationId}
    />
  )

  if (isServiceArea) {
    // Une zone de service n'a pas de salle d'attente (décision B1) : aucun
    // seuil de file n'a de sens, l'écran le dit au lieu d'en proposer.
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24">
        {header}
        {locationPicker}
        <EmptyState
          icon={<IconQueue aria-hidden="true" className="size-6" />}
          title={t('queue.pro.serviceArea.title')}
          description={t('queue.pro.serviceArea.description')}
          action={backLink}
        />
      </div>
    )
  }

  // Une requête DÉSACTIVÉE reste `pending` pour toujours (TanStack v5) : un
  // rôle sans droit ne doit pas rester bloqué sur des squelettes.
  const loading =
    (manageableLocationId !== null && (checkIn.isPending || barbers.isPending)) || insights.isPending
  const loadError = checkIn.error ?? barbers.error ?? insights.error ?? null
  const barberRows = barbers.data ?? []
  const hasInsights = (insights.data?.length ?? 0) > 0

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24">
      {header}
      {locationPicker}

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t('common.loading.generic')}>
          <SkeletonRect className="h-64 w-full" />
          <SkeletonRect className="h-40 w-full" />
          <SkeletonRect className="h-28 w-full" />
        </div>
      ) : loadError ? (
        <div className={BLOCK}>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(errorMessageKey(toAppError(loadError)))}</p>
          <Button
            variant="secondary"
            className="mt-3"
            onClick={() => {
              void checkIn.refetch()
              void barbers.refetch()
              void insights.refetch()
            }}
          >
            {t('common.action.retry')}
          </Button>
        </div>
      ) : !canManage && !hasInsights ? (
        /* Un rôle sans droit d'écriture ET sans mesure à lire n'a rien à faire
           ici : on le dit, avec le retour vers l'outil qui le concerne. */
        <EmptyState
          icon={<IconQueue aria-hidden="true" className="size-6" />}
          title={t('queue.settings.empty.title')}
          description={t('queue.settings.empty.description')}
          action={backLink}
        />
      ) : (
        <>
          {/* a. Les SEUILS — lus en base, réécrits en base, jamais en dur. */}
          {canManage && (
            <form className={BLOCK} onSubmit={submitThresholds} data-testid="pro-queue-settings-thresholds">
              <h2 className={BLOCK_TITLE}>{t('queue.settings.thresholdsTitle').toLocaleUpperCase()}</h2>
              {draft === null ? (
                <p className="mt-3 text-fu-sm text-[var(--fu-text-secondary)]">
                  {t('queue.settings.thresholdsUnavailable')}
                </p>
              ) : (
                <>
                  <div className="mt-4 grid gap-4 lg:grid-cols-3">
                    <Input
                      label={t('queue.settings.capacity.label')}
                      hint={t('queue.settings.capacity.hint')}
                      error={errorFor('capacity')}
                      suffix={t('queue.settings.capacity.unit')}
                      inputMode="numeric"
                      className="[&_input]:font-fu-mono [&_input]:tabular-nums"
                      value={draft.capacity}
                      onChange={editField('capacity')}
                      data-testid="pro-queue-threshold-capacity"
                    />
                    <Input
                      label={t('queue.settings.grace.label')}
                      hint={t('queue.settings.grace.hint')}
                      error={errorFor('grace')}
                      suffix={t('queue.settings.grace.unit')}
                      inputMode="numeric"
                      className="[&_input]:font-fu-mono [&_input]:tabular-nums"
                      value={draft.grace}
                      onChange={editField('grace')}
                      data-testid="pro-queue-threshold-grace"
                    />
                    <Input
                      label={t('queue.settings.geofence.label')}
                      hint={t('queue.settings.geofence.hint')}
                      error={errorFor('geofence')}
                      suffix={t('queue.settings.geofence.unit')}
                      inputMode="numeric"
                      className="[&_input]:font-fu-mono [&_input]:tabular-nums"
                      value={draft.geofence}
                      onChange={editField('geofence')}
                      data-testid="pro-queue-threshold-geofence"
                    />
                  </div>
                  {serverRefusal?.field === null && (
                    <p className="mt-3 text-fu-sm text-[var(--fu-danger)]">{t(serverRefusal.messageKey)}</p>
                  )}
                  <Button
                    type="submit"
                    variant="primary"
                    className="mt-4"
                    disabled={changes === null || setThresholds.isPending}
                    loading={setThresholds.isPending}
                    data-testid="pro-queue-thresholds-save"
                  >
                    {t('queue.settings.save')}
                  </Button>
                </>
              )}
            </form>
          )}

          {/* b. Les FILES PAR BARBER — rendues même à un seul barber : on vient
              exprès sur cet écran, contrairement à la file du comptoir. */}
          {canManage && barberRows.length > 0 && (
            <section className={BLOCK} data-testid="pro-queue-settings-barbers">
              <h2 className={BLOCK_TITLE}>{t('queue.pro.barberQueues.title').toLocaleUpperCase()}</h2>
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.pro.barberQueues.hint')}</p>
              <div className="mt-2 flex flex-col">
                {barberRows.map((barber) => (
                  <Switch
                    key={barber.id}
                    label={t('queue.pro.barberQueues.toggleLabel', { name: barber.display_name })}
                    checked={barber.queue_enabled}
                    disabled={setBarberQueue.isPending || !barber.is_bookable}
                    onCheckedChange={(enabled) => setBarberQueue.mutate({ barberId: barber.id, enabled }, mutationFailed)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* c. La SORTIE AUTOMATIQUE après le délai de grâce (F1b §6). */}
          {canManage && checkIn.data && (
            <section className={BLOCK} data-testid="pro-queue-settings-sweep">
              <h2 className={BLOCK_TITLE}>{t('queue.settings.sweepTitle').toLocaleUpperCase()}</h2>
              <div className="mt-2">
                <Switch
                  label={t('queue.pro.graceSweep.label')}
                  checked={checkIn.data.queue_grace_sweep_enabled ?? false}
                  disabled={setGraceSweep.isPending}
                  onCheckedChange={(enabled) => setGraceSweep.mutate(enabled, mutationFailed)}
                />
              </div>
              <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.pro.graceSweep.hint')}</p>
            </section>
          )}

          {/* d. Ce que FadeUp a appris — RIEN d'observé quand rien n'est mesuré. */}
          <section className={BLOCK} data-testid="pro-queue-settings-durations">
            <h2 className={BLOCK_TITLE}>{t('queue.settings.durationsTitle').toLocaleUpperCase()}</h2>
            <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.settings.durationsHint')}</p>
            {hasInsights ? (
              <div className="mt-3" data-testid="pro-queue-settings-durations-link">
                <Row
                  as="link"
                  to="/dashboard/queue/durations"
                  className="rounded-[var(--radius-card)] border border-[var(--fu-border)] px-4"
                  leading={<IconPending aria-hidden="true" className="size-5 text-[var(--fu-text-secondary)]" />}
                  title={t('queue.settings.durationsLink')}
                  chevron
                />
              </div>
            ) : (
              <p className="mt-3 text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.settings.durationsEmpty')}</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
