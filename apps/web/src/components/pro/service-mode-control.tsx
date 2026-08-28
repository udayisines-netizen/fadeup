import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, CalendarClock, Users, MoonStar, Check } from 'lucide-react'
import { Panel } from '@/components/ui/page-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useDateTime } from '@/lib/intl/use-intl'
import { cn } from '@/lib/cn'
import { getErrorMessage } from '@/lib/get-error-message'
import {
  SERVICE_MODES,
  availableDurations,
  durationLabelKey,
  locationRowOf,
  modeLabelKey,
  modeSourceKey,
  resolveDurationToExpiry,
  useApplyServiceMode,
  useClearServiceModeTemporaryOverride,
  useSetLocationQueueOpen,
  type ClosingHoursToday,
  type OverrideDuration,
  type ServiceMode,
  type ServiceModeStateRow,
} from '@/lib/queries/service-mode'

/**
 * "How do you want to work right now?"
 *
 * This is the control a barber reaches for between two customers, on a phone,
 * with one hand. It lives on the floor surface rather than in a settings tree,
 * because a mode that takes four taps to find is a mode nobody changes — and a
 * shop that cannot pause walk-ins in three seconds simply stops taking them by
 * ignoring the door instead.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW
 *
 *   * Enum values. `queue_only` is an identity in the database and a phrase in
 *     ten locale files; a professional never meets the former.
 *   * Any precedence logic. The server returns the effective mode AND where it
 *     came from, and this renders that sentence. If the UI recomputed it, it
 *     would eventually disagree with the trigger that refuses the booking, and
 *     the customer would meet the disagreement.
 *
 * THE TWO CONTROLS ARE SEPARATE BECAUSE THE TWO FACTS ARE SEPARATE
 *
 * Choosing a mode is "which channels do we offer". The queue toggle is "is the
 * line open right now". They are rendered apart, worded apart, and neither
 * silently moves the other — which is exactly how they behave in the database.
 * A shop that pauses walk-ins for lunch and then switches to reservations-only
 * for the afternoon finds the queue still paused when it switches back.
 *
 * NOTHING HERE CANCELS ANYONE
 *
 * The copy is explicit that changing the mode stops NEW arrivals and leaves the
 * people already booked or already waiting exactly where they are, because that
 * is the single most likely thing for a professional to fear before tapping.
 */

const MODE_ICONS: Record<ServiceMode, typeof CalendarCheck> = {
  hybrid: CalendarCheck,
  reservation_only: CalendarClock,
  queue_only: Users,
  unavailable: MoonStar,
}

export interface ServiceModeControlProps {
  rows: ServiceModeStateRow[] | undefined
  isPending: boolean
  locationId: string | undefined
  /** The ESTABLISHMENT'S timezone. Every duration resolves against this, never the browser's. */
  timeZone: string
  /** Today's hours, so "until closing" is offered only when it is genuinely known. */
  closingToday?: ClosingHoursToday | null
  /** owner/manager. A barber sees the state but cannot change the establishment. */
  canManageLocation: boolean
  /** owner/manager/receptionist — closing the line is a front-of-house call. */
  canManageQueue: boolean
}

export function ServiceModeControl({
  rows,
  isPending,
  locationId,
  timeZone,
  closingToday,
  canManageLocation,
  canManageQueue,
}: ServiceModeControlProps) {
  const { t } = useTranslation(['app', 'common'])
  const dt = useDateTime()

  const location = locationRowOf(rows)
  const [duration, setDuration] = useState<OverrideDuration>('manual')

  const { apply, isPending: isApplying, error: applyError } = useApplyServiceMode()
  const setQueueOpen = useSetLocationQueueOpen()
  const clearOverride = useClearServiceModeTemporaryOverride()

  const durations = useMemo(
    () => availableDurations(timeZone, new Date(), closingToday),
    [timeZone, closingToday],
  )

  if (isPending) {
    return (
      <Panel title={t('app:serviceMode.title')}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-4 w-2/3 rounded" />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        </div>
      </Panel>
    )
  }

  if (!location || !locationId) {
    return (
      <Panel title={t('app:serviceMode.title')}>
        <p className="text-sm text-ink-500">{t('app:serviceMode.noLocation')}</p>
      </Panel>
    )
  }

  const isTemporary = location.modeSource === 'location_temporary_override'
  const error = applyError ?? setQueueOpen.error ?? clearOverride.error
  const activeLocationId = locationId

  async function choose(mode: ServiceMode) {
    if (!canManageLocation) return
    await apply({
      scope: 'location',
      locationId: activeLocationId,
      mode,
      expiresAt: resolveDurationToExpiry(duration, timeZone, new Date(), closingToday),
      temporary: duration !== 'manual',
    })
    // Back to the standing choice, so the next tap is not silently temporary.
    setDuration('manual')
  }

  return (
    <Panel
      title={t('app:serviceMode.title')}
      meta={t('app:serviceMode.subtitle')}
      bodyClassName="flex flex-col gap-4 p-4"
    >
      {/* WHAT IS TRUE RIGHT NOW, and why. The provenance sentence is the whole
          reason a professional does not have to hold the precedence rules in
          their head — "queue only until 15:30, because you set it" is a
          complete explanation. */}
      <div className="rounded-lg border border-border bg-paper-100 px-3 py-2.5">
        <p className="text-sm font-medium text-ink-950">
          {t('app:serviceMode.currentlyLabel')}{' '}
          <span className="text-accent-700">{t(modeLabelKey(location.effectiveServiceMode))}</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-500">
          {t(modeSourceKey(location.modeSource))}
          {location.modeExpiresAt
            ? ` · ${t('app:serviceMode.untilTime', { time: dt.time(location.modeExpiresAt, timeZone) })}`
            : null}
        </p>
      </div>

      {/* HOW LONG. Above the modes, because it changes what tapping one MEANS,
          and a control that silently reinterprets the next tap is a trap. */}
      {canManageLocation ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {t('app:serviceMode.durationLabel')}
          </span>
          <SegmentedControl
            options={durations.map((value) => ({ value, label: t(durationLabelKey(value)) }))}
            value={durations.includes(duration) ? duration : 'manual'}
            onChange={setDuration}
            ariaLabel={t('app:serviceMode.durationLabel')}
            size="sm"
          />
        </div>
      ) : null}

      {/* THE MODES. One column on a phone so every target is full-width and
          comfortably thumb-sized; two from `sm` up, where there is room. */}
      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        role="group"
        aria-label={t('app:serviceMode.title')}
      >
        {SERVICE_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode]
          const isCurrent = location.effectiveServiceMode === mode
          return (
            <button
              key={mode}
              type="button"
              disabled={!canManageLocation || isApplying}
              aria-pressed={isCurrent}
              onClick={() => void choose(mode)}
              className={cn(
                'flex min-h-16 items-start gap-3 rounded-lg border px-3 py-3 text-start transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600',
                'disabled:cursor-not-allowed disabled:opacity-60',
                isCurrent
                  ? 'border-accent-200 bg-accent-100'
                  : 'border-border bg-paper-0 hover:border-accent-200 hover:bg-paper-100',
              )}
            >
              <Icon
                className={cn(
                  'mt-0.5 h-5 w-5 shrink-0',
                  isCurrent ? 'text-accent-700' : 'text-ink-500',
                )}
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5 text-sm font-medium text-ink-950">
                  {t(modeLabelKey(mode))}
                  {isCurrent ? (
                    <Check className="h-3.5 w-3.5 text-accent-700" aria-hidden="true" />
                  ) : null}
                </span>
                <span className="text-pretty text-xs text-ink-500">
                  {t(`app:serviceMode.help.${mode}`)}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {/* Returning to the standing arrangement. Only offered when a temporary
          override is actually in force, so the button is never a no-op the Pro
          has to reason about. */}
      {isTemporary && canManageLocation ? (
        <Button
          variant="secondary"
          disabled={clearOverride.isPending}
          onClick={() =>
            void clearOverride.mutateAsync({
              scope: 'location',
              locationId: activeLocationId,
              barberId: null,
            })
          }
        >
          {t('app:serviceMode.backToNormal')}
        </Button>
      ) : null}

      {/* THE LIVE QUEUE, kept visibly apart. Its own heading, its own wording,
          and copy that says what closing it does NOT do. */}
      <div className="border-t border-border pt-4">
        <Switch
          label={t('app:serviceMode.queueOpenLabel')}
          description={
            location.queueOpen
              ? t('app:serviceMode.queueOpenHelp')
              : t('app:serviceMode.queueClosedHelp')
          }
          checked={location.queueOpen}
          disabled={!canManageQueue || setQueueOpen.isPending}
          onChange={(event) =>
            void setQueueOpen.mutateAsync({
              locationId: activeLocationId,
              queueOpen: event.target.checked,
            })
          }
        />
        {!location.modeAllowsQueue ? (
          // The state §22 insists must remain representable, explained rather
          // than hidden: the line can be open while the mode still refuses new
          // joins. Silently forcing the toggle off would destroy the setting
          // the shop will want back in an hour.
          <p className="mt-2 text-pretty text-xs text-ink-500">
            {t('app:serviceMode.queueBlockedByMode')}
          </p>
        ) : null}
      </div>

      {error ? <Alert variant="error">{getErrorMessage(error)}</Alert> : null}

      {!canManageLocation ? (
        <p className="text-xs text-ink-500">{t('app:serviceMode.readOnly')}</p>
      ) : null}
    </Panel>
  )
}

/**
 * The per-barber row, for the roster view.
 *
 * Split from the establishment control on purpose: a barber setting their own
 * mode and a manager setting the shop's are different decisions with different
 * blast radii, and a single merged control would make the smaller one feel as
 * consequential as the larger.
 */
export function BarberServiceModeRow({
  row,
  locationId,
  canManage,
  timeZone,
}: {
  row: ServiceModeStateRow
  locationId: string
  canManage: boolean
  timeZone: string
}) {
  const { t } = useTranslation(['app', 'common'])
  const dt = useDateTime()
  const { apply, isPending } = useApplyServiceMode()

  const inherits = row.barberServiceModeOverride === null
  const isTemporary = row.modeSource === 'barber_temporary_override'
  const barberId = row.barberId

  return (
    <div className="flex flex-col gap-2 border-b border-border px-3 py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium text-ink-950">
          {row.barberDisplayName ?? t('app:serviceMode.unnamedProfessional')}
        </span>
        <span className="text-xs text-ink-500">
          {t(modeLabelKey(row.effectiveServiceMode))}
          {' · '}
          {inherits ? t('app:serviceMode.inheriting') : t(modeSourceKey(row.modeSource))}
          {isTemporary && row.modeExpiresAt
            ? ` · ${t('app:serviceMode.untilTime', { time: dt.time(row.modeExpiresAt, timeZone) })}`
            : null}
        </span>
      </div>

      {canManage && barberId ? (
        <div className="flex shrink-0 flex-wrap gap-1.5">
          {SERVICE_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={isPending}
              aria-pressed={row.effectiveServiceMode === mode}
              onClick={() =>
                void apply({
                  scope: 'barber',
                  locationId,
                  barberId,
                  mode,
                  expiresAt: null,
                  temporary: false,
                })
              }
              className={cn(
                'min-h-11 rounded-md border px-2.5 text-xs font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-600',
                'disabled:cursor-not-allowed disabled:opacity-60',
                row.effectiveServiceMode === mode
                  ? 'border-accent-200 bg-accent-100 text-accent-800'
                  : 'border-border bg-paper-0 text-ink-700 hover:bg-paper-100',
              )}
            >
              {t(modeLabelKey(mode))}
            </button>
          ))}
          {!inherits ? (
            <button
              type="button"
              disabled={isPending}
              onClick={() =>
                void apply({
                  scope: 'barber',
                  locationId,
                  barberId,
                  // "Follow the shop" is the establishment's own mode, applied
                  // as this barber's — the honest alternative would be a NULL
                  // override, which the RPC also accepts, but showing the
                  // resulting mode is what the Pro is actually asking for.
                  mode: row.locationDefaultServiceMode,
                  expiresAt: null,
                  temporary: false,
                })
              }
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'min-h-11 text-xs')}
            >
              {t('app:serviceMode.followShop')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
