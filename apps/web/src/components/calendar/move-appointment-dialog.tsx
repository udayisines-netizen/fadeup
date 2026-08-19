import { useState } from 'react'
import { CalendarX } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { TextField } from '@/components/ui/text-field'
import { SelectField } from '@/components/ui/select-field'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/cn'
import { useAvailableSlots } from '@/lib/queries/appointments'
import { useRescheduleAppointment } from '@/lib/queries/booking-requests'
import { calendarErrorMessage, type CalendarAppointment } from '@/lib/queries/calendar'
import { zonedDateKey, todayInZone } from '@/lib/calendar/time'
import type { CalendarProfessional } from '@/lib/calendar/professionals'
import { useTranslation } from 'react-i18next'

/**
 * Moving an appointment, from the shop's side.
 *
 * Deliberately NOT the customer's RescheduleDialog. The two look similar and
 * mean different things: when a customer moves a booking it returns to
 * `pending` for the shop to answer, and when the SHOP moves it, it keeps the
 * status it had. Sharing one component would mean one of the two audiences
 * reading copy that is untrue for them.
 *
 * The times come from get_available_slots — the real engine, now split-shift
 * and time-block aware — so a lunch closure or a blocked hour simply is not
 * offered. The server re-validates on submit regardless, and the GiST
 * exclusion constraint is the final authority: if a colleague takes the
 * destination between this list loading and the tap, the move is refused and
 * the original appointment is left exactly as it was.
 */
export function MoveAppointmentDialog({
  open,
  onOpenChange,
  appointment,
  organizationId,
  professionals,
  onMoved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: CalendarAppointment
  organizationId: string
  professionals: CalendarProfessional[]
  onMoved?: () => void
}) {
  const { t } = useTranslation()
  const timeZone = appointment.locationTimezone
  const [date, setDate] = useState(() => zonedDateKey(appointment.startsAt, timeZone))
  const [barberId, setBarberId] = useState(appointment.barberId ?? '')
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reschedule = useRescheduleAppointment(organizationId)

  const slotsQuery = useAvailableSlots(
    organizationId,
    appointment.locationId,
    barberId || undefined,
    appointment.serviceId ?? undefined,
    date,
  )
  const slots = slotsQuery.data ?? []

  async function submit() {
    if (!selected) return
    setError(null)
    try {
      await reschedule.mutateAsync({
        appointmentId: appointment.id,
        startsAt: selected,
        // Only sent when it actually changed — reassigning is a different
        // decision from moving, and the RPC treats null as "keep".
        barberId: barberId && barberId !== appointment.barberId ? barberId : null,
      })
      onOpenChange(false)
      setSelected(null)
      onMoved?.()
    } catch (cause) {
      setError(calendarErrorMessage(cause))
      // The destination is gone, so what is on screen is stale.
      void slotsQuery.refetch()
    }
  }

  const movingToAnotherProfessional = Boolean(barberId) && barberId !== appointment.barberId

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('app:move.moveThisAppointment')}</DialogTitle>
          <DialogDescription>
            {appointment.customerName}
            {appointment.serviceName ? ` · ${appointment.serviceName}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('common:field.date')}
              type="date"
              value={date}
              min={todayInZone(timeZone)}
              onChange={(event) => {
                setDate(event.target.value)
                setSelected(null)
              }}
            />
            {professionals.length > 1 ? (
              <SelectField
                label={t('common:entity.professional')}
                value={barberId}
                options={professionals.map((professional) => ({
                  value: professional.barberId,
                  label: professional.displayName,
                }))}
                onChange={(event) => {
                  setBarberId(event.target.value)
                  setSelected(null)
                }}
              />
            ) : null}
          </div>

          {error ? <Alert variant="error">{error}</Alert> : null}

          {!appointment.serviceId ? (
            <Alert variant="warning">
              This appointment has no service attached, so we can&apos;t work out how long it needs. Edit it from the
              schedule instead.
            </Alert>
          ) : slotsQuery.isPending ? (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full" />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <EmptyState
              icon={CalendarX}
              title={t('app:move.nothingFreeThatDay')}
              description={t('app:move.openingHoursBlockedTimeAnd')}
            />
          ) : (
            <div
              role="radiogroup"
              aria-label={t('app:move.availableTimes')}
              // Three across even on a 375px screen keeps every target well
              // past 44px while still showing a useful number of times.
              className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4"
            >
              {slots.map((slot) => {
                const isSelected = selected === slot.slotStart
                return (
                  <button
                    key={slot.slotStart}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelected(slot.slotStart)}
                    className={cn(
                      'min-h-11 rounded-md border px-2 text-sm transition-colors',
                      isSelected
                        ? 'border-ink-950 bg-ink-950 text-on-accent'
                        : 'border-border text-ink-950 hover:bg-paper-100',
                    )}
                  >
                    {new Date(slot.slotStart).toLocaleTimeString(undefined, {
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone,
                    })}
                  </button>
                )
              })}
            </div>
          )}

          <p className="text-sm text-ink-500">
            {movingToAnotherProfessional
              ? 'The customer will be told about the new time and the new professional.'
              : 'The customer will be told about the new time. The appointment keeps its current status.'}
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t('app:move.keepAsItIs')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={() => void submit()} disabled={!selected} isLoading={reschedule.isPending}>
            {t('app:move.moveAppointment')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
