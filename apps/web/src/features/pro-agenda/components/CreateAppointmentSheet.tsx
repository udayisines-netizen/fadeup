import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OrganizationBarber } from '@/shared/data/proBarbers'
import { formatDuration, formatMoney } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonText } from '@/shared/ui/Skeleton'
import { Textarea } from '@/shared/ui/Textarea'
import type { AgendaService } from '@/features/pro-agenda/api/agenda'
import type { DayKey } from '@/features/pro-agenda/lib/time'

/**
 * OS-1 — la réservation manuelle : « un client appelle ». Formulaire DENSE
 * (contrat §14.5, tranché ici) : prestation, barber, date, heure, nom —
 * le reste facultatif. Prérempli depuis l'endroit cliqué sur la grille
 * (barber + heure) : dans le cas courant, il ne reste que la prestation et
 * le nom à saisir. Le conflit se vérifie AVANT l'envoi (dialogue).
 */
export interface CreateDraft {
  barberId: string
  dayKey: DayKey
  minutes: number
}

export interface CreateSubmit {
  serviceId: string
  barberId: string
  dayKey: DayKey
  minutes: number
  customerName: string
  customerPhone: string
  customerEmail: string
  notes: string
}

export interface CreateAppointmentSheetProps {
  draft: CreateDraft | null
  services: AgendaService[] | undefined
  barbers: OrganizationBarber[]
  currency: string
  isSolo: boolean
  seesRevenue: boolean
  busy: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: CreateSubmit) => void
}

function toTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

export function CreateAppointmentSheet({ draft, services, barbers, currency, isSolo, seesRevenue, busy, onOpenChange, onSubmit }: CreateAppointmentSheetProps) {
  const { t, i18n } = useTranslation('v2')
  const [serviceId, setServiceId] = useState('')
  const [barberId, setBarberId] = useState('')
  const [day, setDay] = useState<DayKey>('')
  const [time, setTime] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!draft) return
    setBarberId(draft.barberId)
    setDay(draft.dayKey)
    setTime(toTime(draft.minutes))
    // La prestation se recalcule pour CE barber (la précédente pourrait ne
    // pas être dans ses aptitudes).
    setServiceId('')
    setName('')
    setPhone('')
    setEmail('')
    setNotes('')
    setTouched(false)
  }, [draft])

  // Première prestation apte au barber choisi, sinon la première.
  useEffect(() => {
    if (!services || services.length === 0 || serviceId) return
    const eligible = services.find((s) => s.barber_ids.includes(barberId)) ?? services[0]
    if (eligible) setServiceId(eligible.id)
  }, [services, barberId, serviceId])

  const service = useMemo(() => services?.find((s) => s.id === serviceId) ?? null, [services, serviceId])
  const eligibleBarbers = useMemo(
    () => (service ? barbers.filter((b) => service.barber_ids.includes(b.id) && b.is_bookable) : barbers),
    [barbers, service],
  )
  const barberEligible = eligibleBarbers.some((b) => b.id === barberId)
  const nameError = touched && name.trim().length === 0 ? t('booking.refusal.missing_name') : undefined

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    setTouched(true)
    const [h, m] = time.split(':').map(Number)
    if (!serviceId || !barberId || !day || h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m) || name.trim().length === 0) return
    onSubmit({
      serviceId,
      barberId,
      dayKey: day,
      minutes: h * 60 + m,
      customerName: name.trim(),
      customerPhone: phone.trim(),
      customerEmail: email.trim(),
      notes: notes.trim(),
    })
  }

  return (
    <Sheet open={Boolean(draft)} onOpenChange={onOpenChange} title={t('pro.agenda.create.title')} description={t('pro.agenda.create.description')}>
      <form onSubmit={submit} className="flex flex-col gap-3" data-testid="agenda-create-form">
        {services === undefined ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <SkeletonText className="w-1/2" />
            <SkeletonText className="w-2/3" />
          </div>
        ) : services.length === 0 ? (
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.agenda.create.noService')}</p>
        ) : (
          <Select
            label={t('pro.agenda.create.service')}
            value={serviceId}
            onValueChange={(next) => {
              setServiceId(next)
            }}
            options={services.map((s) => ({
              value: s.id,
              label: `${s.name} · ${formatDuration(s.duration_minutes, i18n.language)}${seesRevenue ? ` · ${formatMoney(s.price_cents, currency, i18n.language)}` : ''}`,
            }))}
          />
        )}
        {!isSolo && (
          <Select
            label={t('pro.agenda.create.barber')}
            value={barberEligible ? barberId : ''}
            onValueChange={setBarberId}
            placeholder={eligibleBarbers.length === 0 ? t('pro.agenda.create.noBarber') : undefined}
            error={!barberEligible && service ? t('booking.refusal.barber_unavailable') : undefined}
            options={eligibleBarbers.map((b) => ({ value: b.id, label: b.display_name }))}
          />
        )}
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('pro.agenda.create.date')} type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
          <Input label={t('pro.agenda.create.time')} type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
        </div>
        <Input
          label={t('pro.agenda.create.name')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          error={nameError}
          autoComplete="off"
          data-testid="agenda-create-name"
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label={t('pro.agenda.create.phone')} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          <Input label={t('pro.agenda.create.email')} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </div>
        <Textarea label={t('pro.agenda.create.notes')} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} className="[&>textarea]:min-h-16" />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={!service || !barberEligible} data-testid="agenda-create-submit">
          {t('pro.agenda.create.submit')}
        </Button>
        <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.agenda.create.hint')}</p>
      </form>
    </Sheet>
  )
}
