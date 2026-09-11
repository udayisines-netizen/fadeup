import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OrganizationBarber } from '@/shared/data/proBarbers'
import { formatDateTime, formatMoney } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Dialog } from '@/shared/ui/Dialog'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { Sheet } from '@/shared/ui/Sheet'
import { Textarea } from '@/shared/ui/Textarea'
import type { AgendaAppointmentRow } from '@/features/pro-agenda/api/agenda'
import { StatusBadge, toneOf } from '@/features/pro-agenda/components/AppointmentCard'
import { dayKeyInZone, minutesOfDayInZone, type DayKey } from '@/features/pro-agenda/lib/time'

/**
 * OS-1 — la fiche d'un rendez-vous : comprendre en deux secondes, agir en un
 * geste. « Terminé » est LE primaire (le geste le plus fréquent de la
 * journée) ; « Absent » secondaire ; « Déplacer » ouvre le REPLI par menu
 * du glisser (date / heure / barber — c'est aussi le chemin mobile quand le
 * glisser ne convient pas) ; « Annuler la réservation » est destructif,
 * derrière une confirmation — un client attend derrière.
 */
export interface AppointmentSheetProps {
  row: AgendaAppointmentRow | null
  timezone: string
  barbers: OrganizationBarber[]
  isSolo: boolean
  seesRevenue: boolean
  canClose: boolean
  canMove: boolean
  canCancel: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onComplete: (row: AgendaAppointmentRow) => void
  onNoShow: (row: AgendaAppointmentRow) => void
  onMove: (row: AgendaAppointmentRow, target: { dayKey: DayKey; minutes: number; barberId: string }) => void
  onCancel: (row: AgendaAppointmentRow, note: string) => void
}

function Field({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-[var(--fu-border)] py-2.5">
      <dt className="text-fu-xs text-[var(--fu-text-secondary)]">{label}</dt>
      <dd className="text-fu-sm text-[var(--fu-text-primary)]" data-testid={testId}>
        {children}
      </dd>
    </div>
  )
}

export function AppointmentSheet({
  row,
  timezone,
  barbers,
  isSolo,
  seesRevenue,
  canClose,
  canMove,
  canCancel,
  busy,
  onOpenChange,
  onComplete,
  onNoShow,
  onMove,
  onCancel,
}: AppointmentSheetProps) {
  const { t, i18n } = useTranslation('v2')
  const [moving, setMoving] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelNote, setCancelNote] = useState('')
  const [moveDay, setMoveDay] = useState<DayKey>('')
  const [moveTime, setMoveTime] = useState('')
  const [moveBarber, setMoveBarber] = useState('')

  if (!row) return null
  const tone = toneOf(row)
  const live = row.status === 'confirmed' || row.status === 'pending'
  const canDecide = live && canClose && row.status === 'confirmed'

  const openMove = () => {
    setMoveDay(dayKeyInZone(new Date(row.starts_at), timezone))
    const minutes = minutesOfDayInZone(new Date(row.starts_at), timezone)
    setMoveTime(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`)
    setMoveBarber(row.barber_id ?? '')
    setMoving(true)
  }
  const submitMove = (event: React.FormEvent) => {
    event.preventDefault()
    const [h, m] = moveTime.split(':').map(Number)
    if (!moveDay || h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return
    onMove(row, { dayKey: moveDay, minutes: h * 60 + m, barberId: moveBarber || (row.barber_id ?? '') })
    setMoving(false)
  }

  const price = seesRevenue && row.price_cents !== null ? formatMoney(row.price_cents, row.currency, i18n.language) : null

  return (
    <>
      <Sheet open={Boolean(row)} onOpenChange={onOpenChange} title={row.customer_name || t('pro.agenda.sheet.title')} description={row.service_name ?? undefined}>
        <div data-testid="agenda-appointment-sheet" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-fu-mono text-fu-lg tabular-nums text-[var(--fu-text-primary)]">
              <DateTime value={row.starts_at} timezone={timezone} format="time" />
              {' – '}
              <DateTime value={row.ends_at} timezone={timezone} format="time" />
            </span>
            <StatusBadge tone={tone} size="md" />
          </div>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">
            <DateTime value={row.starts_at} timezone={timezone} format="weekday" />
          </p>

          {tone === 'forced' && (
            <p className="rounded-[var(--radius-control)] border border-[var(--fu-state-danger)] px-3 py-2 text-fu-sm" data-testid="agenda-forced-note">
              <span className="font-semibold">{t('pro.agenda.sheet.forced')}</span>
              {row.overlap_forced_reason && <span className="block text-[var(--fu-text-secondary)]">{t('pro.agenda.sheet.forcedReason', { reason: row.overlap_forced_reason })}</span>}
            </p>
          )}
          {row.status === 'pending' && row.expires_at && (
            <p className="text-fu-sm text-[var(--fu-state-warn)]">
              {t('pro.agenda.sheet.requestExpires', { time: formatDateTime(row.expires_at, timezone, 'datetime', i18n.language) })}
            </p>
          )}

          <dl className="flex flex-col">
            <Field label={t('pro.agenda.sheet.service')}>
              <span className="flex items-baseline justify-between gap-2">
                <span>{row.service_name ?? '—'}</span>
                {price && <span className="font-fu-mono tabular-nums" data-testid="agenda-price">{price}</span>}
              </span>
            </Field>
            {!isSolo && <Field label={t('pro.agenda.sheet.barber')}>{row.barber_display_name ?? '—'}</Field>}
            {row.customer_phone && (
              <Field label={t('pro.agenda.sheet.phone')}>
                <a href={`tel:${row.customer_phone}`} className="font-fu-mono tabular-nums underline-offset-2 hover:underline">
                  {row.customer_phone}
                </a>
              </Field>
            )}
            {row.notes && <Field label={t('pro.agenda.sheet.notes')}>{row.notes}</Field>}
          </dl>

          {live ? (
            <div className="flex flex-col gap-2">
              {canDecide && (
                <Button variant="primary" size="lg" fullWidth loading={busy} data-testid="agenda-complete" onClick={() => onComplete(row)}>
                  {t('pro.agenda.sheet.complete')}
                </Button>
              )}
              <div className="flex gap-2">
                {canDecide && (
                  <Button variant="secondary" fullWidth disabled={busy} data-testid="agenda-no-show" onClick={() => onNoShow(row)}>
                    {t('pro.agenda.sheet.noShow')}
                  </Button>
                )}
                {canMove && (
                  <Button variant="secondary" fullWidth disabled={busy} data-testid="agenda-move" onClick={openMove}>
                    {t('pro.agenda.sheet.move')}
                  </Button>
                )}
              </div>
              {canDecide && <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.agenda.sheet.noShowHint')}</p>}
              {canCancel && (
                <Button variant="tertiary" className="text-[color:var(--fu-danger)]" disabled={busy} data-testid="agenda-cancel" onClick={() => setCancelling(true)}>
                  {t('pro.agenda.sheet.cancel')}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.agenda.sheet.closed')}</p>
          )}
        </div>
      </Sheet>

      {/* Le repli par menu du glisser — et le chemin mobile assumé. */}
      <Dialog open={moving} onOpenChange={setMoving} title={t('pro.agenda.sheet.moveTitle')}>
        <form onSubmit={submitMove} className="flex flex-col gap-3" data-testid="agenda-move-form">
          <Input label={t('pro.agenda.sheet.moveDate')} type="date" value={moveDay} onChange={(e) => setMoveDay(e.target.value)} required />
          <Input label={t('pro.agenda.sheet.moveTime')} type="time" step={300} value={moveTime} onChange={(e) => setMoveTime(e.target.value)} required />
          {!isSolo && (
            <Select
              label={t('pro.agenda.sheet.moveBarber')}
              value={moveBarber}
              onValueChange={setMoveBarber}
              options={barbers.map((b) => ({ value: b.id, label: b.display_name }))}
            />
          )}
          <Button type="submit" variant="primary" fullWidth loading={busy} data-testid="agenda-move-submit">
            {t('pro.agenda.sheet.moveSubmit')}
          </Button>
        </form>
      </Dialog>

      <Dialog open={cancelling} onOpenChange={setCancelling} title={t('pro.agenda.sheet.cancelTitle')} description={t('pro.agenda.sheet.cancelBody')}>
        <div className="flex flex-col gap-3">
          <Textarea label={t('pro.agenda.sheet.cancelNote')} value={cancelNote} onChange={(e) => setCancelNote(e.target.value)} maxLength={500} className="[&>textarea]:min-h-20" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setCancelling(false)}>
              {t('common.action.back')}
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              data-testid="agenda-cancel-confirm"
              onClick={() => {
                onCancel(row, cancelNote.trim())
                setCancelling(false)
              }}
            >
              {t('pro.agenda.sheet.cancelConfirm')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}

