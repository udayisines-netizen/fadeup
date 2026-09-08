import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import type { BookingRequestRow } from '@/shared/data/proRequests'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonText } from '@/shared/ui/Skeleton'
import { Textarea } from '@/shared/ui/Textarea'
import { useCounterPropose, useStaffSlots, RequestActionError } from '@/features/pro-requests/api/requests'

/**
 * P1PRO §10 — la feuille de contre-proposition : « pas 18h, mais 18h30 ».
 * Les créneaux viennent de `get_available_slots` (la vérité staff du jour
 * choisi) — rien n'est proposé qui ne soit pas réellement proposable. Le
 * créneau proposé sera RETENU jusqu'à la réponse du client, et l'horaire
 * demandé est libéré : la feuille le dit avant le geste.
 */

export interface CounterProposeSheetProps {
  request: BookingRequestRow
  organizationId: string
  /** Fuseau du LIEU de la demande — toute heure de service se lit dans lui. */
  timezone: string
  onOpenChange: (open: boolean) => void
  onProposed: () => void
}

/** Les 14 prochains jours — assez pour « plus tard cette semaine », sans calendrier complet. */
function nextDays(count: number): string[] {
  const days: string[] = []
  const cursor = new Date()
  for (let i = 0; i < count; i += 1) {
    days.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`,
    )
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

export function CounterProposeSheet({ request, organizationId, timezone, onOpenChange, onProposed }: CounterProposeSheetProps) {
  const { t, i18n } = useTranslation('v2')
  const days = useMemo(() => nextDays(14), [])
  const [day, setDay] = useState(days[0] ?? '')
  const [picked, setPicked] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const propose = useCounterPropose(organizationId)
  const slots = useStaffSlots({
    organizationId,
    locationId: request.location_id,
    barberId: request.barber_id,
    serviceId: request.service_id,
    date: day || null,
  })

  const slotRows = useMemo(() => {
    const rows = slots.data ?? []
    // Le créneau que le client a DEMANDÉ n'est pas une proposition : le
    // salon aurait accepté. On le retire s'il apparaît.
    return rows.filter((slot) => slot.slot_start !== request.starts_at)
  }, [slots.data, request.starts_at])

  const dayLabel = (value: string, index: number): string => {
    if (index === 0) return t('booking.slots.today')
    if (index === 1) return t('booking.slots.tomorrow')
    return new Intl.DateTimeFormat(i18n.language, { weekday: 'short', day: 'numeric' }).format(new Date(`${value}T12:00:00`))
  }

  const submit = () => {
    if (!picked) return
    propose.mutate(
      { appointmentId: request.id, startsAt: picked, note: note.trim() || undefined },
      {
        onSuccess: () => {
          onProposed()
          onOpenChange(false)
        },
      },
    )
  }

  const errorLabel =
    propose.error instanceof RequestActionError
      ? propose.error.code === 'request_expired'
        ? t('pro.requests.counterSheet.errorExpired')
        : t(`booking.refusal.${propose.error.code}`, { defaultValue: t('pro.requests.counterSheet.error') })
      : propose.isError
        ? t('pro.requests.counterSheet.error')
        : null

  return (
    <Sheet open onOpenChange={onOpenChange} title={t('pro.requests.counterSheet.title')}>
      <div className="flex flex-col gap-4 pb-2" data-testid="counter-propose-sheet">
        <p className="text-fu-sm text-[var(--fu-text-secondary)]">
          {t('pro.requests.counterSheet.context', { name: request.customer_name })}{' '}
          <DateTime value={request.starts_at} timezone={timezone} format="datetime" />
        </p>

        {/* Le jour — chips denses, 14 jours. */}
        <div>
          <p className="mb-2 text-fu-sm font-medium text-[var(--fu-text-primary)]">
            {t('pro.requests.counterSheet.dayLabel')}
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1" role="listbox" aria-label={t('pro.requests.counterSheet.dayLabel')}>
            {days.map((value, index) => (
              <button
                key={value}
                type="button"
                role="option"
                aria-selected={day === value}
                onClick={() => {
                  setDay(value)
                  setPicked(null)
                }}
                className={cn(
                  'shrink-0 rounded-[var(--radius-control)] border px-3 py-2 text-fu-sm capitalize',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]',
                  day === value
                    ? 'border-transparent bg-[var(--fu-accent)] font-medium text-[color:var(--fu-accent-fg)]'
                    : 'border-[var(--fu-border)] text-[var(--fu-text-secondary)] hover:bg-[var(--fu-surface-hover)]',
                )}
              >
                {dayLabel(value, index)}
              </button>
            ))}
          </div>
        </div>

        {/* Les créneaux RÉELS du jour. */}
        <div>
          <p className="mb-2 text-fu-sm font-medium text-[var(--fu-text-primary)]">
            {t('pro.requests.counterSheet.slotsLabel')}
          </p>
          {slots.isPending ? (
            <div className="space-y-2" aria-busy="true">
              <SkeletonText className="w-2/3" />
              <SkeletonText className="w-1/2" />
            </div>
          ) : slotRows.length === 0 ? (
            <p className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="counter-no-slots">
              {t('pro.requests.counterSheet.noSlots')}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4" data-testid="counter-slots">
              {slotRows.slice(0, 24).map((slot) => (
                <button
                  key={slot.slot_start}
                  type="button"
                  aria-pressed={picked === slot.slot_start}
                  onClick={() => setPicked(slot.slot_start)}
                  className={cn(
                    'rounded-[var(--radius-control)] border px-2 py-2 font-fu-mono text-fu-sm tabular-nums',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]',
                    picked === slot.slot_start
                      ? 'border-transparent bg-[var(--fu-accent)] font-medium text-[color:var(--fu-accent-fg)]'
                      : 'border-[var(--fu-border)] text-[var(--fu-text-primary)] hover:bg-[var(--fu-surface-hover)]',
                  )}
                >
                  <DateTime value={slot.slot_start} timezone={timezone} format="time" />
                </button>
              ))}
            </div>
          )}
        </div>

        <Textarea
          id="counter-note"
          label={t('pro.requests.counterSheet.noteLabel')}
          value={note}
          maxLength={280}
          onChange={(event) => setNote(event.target.value)}
          placeholder={t('pro.requests.counterSheet.notePlaceholder')}
        />

        <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.requests.counterSheet.holdNote')}</p>

        {errorLabel && (
          <p className="text-fu-sm text-[var(--fu-danger)]" role="alert">
            {errorLabel}
          </p>
        )}

        <Button
          variant="primary"
          size="lg"
          fullWidth
          data-testid="counter-submit"
          disabled={!picked}
          loading={propose.isPending}
          onClick={submit}
        >
          {t('pro.requests.counterSheet.submit')}
        </Button>
      </div>
    </Sheet>
  )
}
