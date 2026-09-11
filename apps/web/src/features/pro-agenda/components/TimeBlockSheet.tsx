import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OrganizationBarber } from '@/shared/data/proBarbers'
import { Button } from '@/shared/ui/Button'
import { Checkbox } from '@/shared/ui/Checkbox'
import { DateTime } from '@/shared/ui/DateTime'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { Sheet } from '@/shared/ui/Sheet'
import type { AgendaAppointmentRow, TimeBlockRow } from '@/features/pro-agenda/api/agenda'
import { expandWeekly, type Occurrence } from '@/features/pro-agenda/lib/recurrence'
import { addDays, instantAt, type DayKey } from '@/features/pro-agenda/lib/time'
import { holdsSlot, intervalsOverlap } from '@/features/pro-agenda/lib/layout'

/**
 * OS-1 — bloquer du temps : pause, congé, formation. Ponctuel ou
 * hebdomadaire jusqu'à une date (occurrences matérialisées, série liée).
 * Un blocage posé sur des rendez-vous existants ne les déplace pas — les
 * rendez-vous sont protégés à leur heure (MASTER_SPEC §7) — la feuille le
 * dit AVANT le geste. Un blocage existant se retire, seul ou avec sa série.
 */
export interface BlockDraft {
  barberId: string
  dayKey: DayKey
  minutes: number
}

export interface BlockSubmit {
  barberId: string
  reason: string
  occurrences: Occurrence[]
  seriesId: string | null
}

export interface TimeBlockSheetProps {
  /** Création (brouillon) OU édition (ligne existante). */
  draft: BlockDraft | null
  existing: TimeBlockRow | null
  timezone: string
  barbers: OrganizationBarber[]
  appointments: AgendaAppointmentRow[]
  isSolo: boolean
  canBlockFor: (barberId: string) => boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: BlockSubmit) => void
  onDelete: (block: TimeBlockRow, scope: 'one' | 'series') => void
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function TimeBlockSheet({ draft, existing, timezone, barbers, appointments, isSolo, canBlockFor, busy, onOpenChange, onSubmit, onDelete }: TimeBlockSheetProps) {
  const { t } = useTranslation('v2')
  const [barberId, setBarberId] = useState('')
  const [day, setDay] = useState<DayKey>('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [reason, setReason] = useState('')
  const [weekly, setWeekly] = useState(false)
  const [until, setUntil] = useState<DayKey>('')

  useEffect(() => {
    if (!draft) return
    setBarberId(draft.barberId)
    setDay(draft.dayKey)
    setStart(toTime(draft.minutes))
    setEnd(toTime(Math.min(draft.minutes + 60, 24 * 60 - 5)))
    setReason('')
    setWeekly(false)
    setUntil(addDays(draft.dayKey, 28))
  }, [draft])

  const open = Boolean(draft) || Boolean(existing)
  const allowed = barbers.filter((b) => canBlockFor(b.id))

  const range = useMemo(() => {
    const [sh, sm] = start.split(':').map(Number)
    const [eh, em] = end.split(':').map(Number)
    if (!day || sh === undefined || sm === undefined || eh === undefined || em === undefined || [sh, sm, eh, em].some(Number.isNaN)) return null
    const starts = instantAt(day, sh * 60 + sm, timezone)
    const ends = instantAt(day, eh * 60 + em, timezone)
    if (ends.getTime() <= starts.getTime()) return null
    return { starts, ends }
  }, [day, end, start, timezone])

  const occurrences = useMemo(() => {
    if (!range) return []
    if (!weekly) return [{ starts_at: range.starts.toISOString(), ends_at: range.ends.toISOString() }]
    return expandWeekly({ starts: range.starts, ends: range.ends, timezone, untilDay: until || day })
  }, [day, range, timezone, until, weekly])

  const overlapping = useMemo(
    () =>
      appointments.filter(
        (row) =>
          row.barber_id === barberId &&
          holdsSlot(row.status) &&
          occurrences.some((o) => intervalsOverlap({ start: Date.parse(o.starts_at), end: Date.parse(o.ends_at) }, { start: Date.parse(row.starts_at), end: Date.parse(row.ends_at) })),
      ).length,
    [appointments, barberId, occurrences],
  )

  const invalidRange = start !== '' && end !== '' && range === null

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!range || !barberId || occurrences.length === 0) return
    onSubmit({
      barberId,
      reason: reason.trim(),
      occurrences,
      seriesId: weekly && occurrences.length > 1 ? crypto.randomUUID() : null,
    })
  }

  if (existing) {
    const barber = barbers.find((b) => b.id === existing.barber_id)
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={t('pro.agenda.block.editTitle')} description={existing.reason ?? undefined}>
        <div className="flex flex-col gap-4" data-testid="agenda-block-sheet">
          <p className="font-fu-mono text-fu-lg tabular-nums">
            <DateTime value={existing.starts_at} timezone={timezone} format="time" />
            {' – '}
            <DateTime value={existing.ends_at} timezone={timezone} format="time" />
          </p>
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">
            <DateTime value={existing.starts_at} timezone={timezone} format="weekday" />
            {!isSolo && barber && <span> · {barber.display_name}</span>}
          </p>
          {existing.series_id && <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.agenda.block.seriesHint')}</p>}
          {canBlockFor(existing.barber_id) && (
            <div className="flex flex-col gap-2">
              <Button variant="secondary" fullWidth loading={busy} data-testid="agenda-block-remove" onClick={() => onDelete(existing, 'one')}>
                {t('pro.agenda.block.remove')}
              </Button>
              {existing.series_id && (
                <Button variant="tertiary" className="text-[color:var(--fu-danger)]" disabled={busy} data-testid="agenda-block-remove-series" onClick={() => onDelete(existing, 'series')}>
                  {t('pro.agenda.block.removeSeries')}
                </Button>
              )}
            </div>
          )}
        </div>
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('pro.agenda.block.title')} description={t('pro.agenda.block.description')}>
      <form onSubmit={submit} className="flex flex-col gap-3" data-testid="agenda-block-form">
        {!isSolo && (
          <Select label={t('pro.agenda.block.barber')} value={barberId} onValueChange={setBarberId} options={allowed.map((b) => ({ value: b.id, label: b.display_name }))} />
        )}
        <Input label={t('pro.agenda.block.date')} type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('pro.agenda.block.start')} type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} required />
          <Input label={t('pro.agenda.block.end')} type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} required error={invalidRange ? t('pro.agenda.block.invalidRange') : undefined} />
        </div>
        <Input label={t('pro.agenda.block.reason')} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t('pro.agenda.block.reasonPlaceholder')} data-testid="agenda-block-reason" />
        <Checkbox label={t('pro.agenda.block.weekly')} checked={weekly} onCheckedChange={setWeekly} />
        {weekly && (
          <Input
            label={t('pro.agenda.block.until')}
            type="date"
            value={until}
            min={day}
            onChange={(e) => setUntil(e.target.value)}
            hint={t('pro.agenda.block.occurrences', { count: occurrences.length })}
            data-testid="agenda-block-until"
          />
        )}
        {overlapping > 0 && (
          <p className="rounded-[var(--radius-control)] border border-[var(--fu-state-warn)] px-3 py-2 text-fu-sm" data-testid="agenda-block-overlap-warning">
            {t('pro.agenda.block.overlapsAppointments', { count: overlapping })}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={!range || !barberId} data-testid="agenda-block-submit">
          {t('pro.agenda.block.submit')}
        </Button>
      </form>
    </Sheet>
  )
}

