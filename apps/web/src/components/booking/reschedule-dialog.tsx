import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { DateStrip } from '@/components/ui/date-strip'
import { TimeSlotGrid, firstPopulatedPart, type PartOfDay } from '@/components/ui/time-slot-grid'
import { todayInZone, addDays } from '@/lib/calendar/time'
import { usePublicAvailableSlots } from '@/lib/queries/public-booking'
import { bookingErrorKey, useRescheduleAppointment } from '@/lib/queries/booking-requests'

/**
 * Moving an appointment, using the REAL availability engine.
 *
 * The slots come from get_public_available_slots — the same function the
 * public booking wizard uses, which intersects opening hours with the
 * professional's own hours, applies date exceptions, and excludes anything
 * overlapping an existing appointment's buffered range. Offering a grid of
 * times the shop cannot actually work would be worse than offering none.
 *
 * The server still re-validates on submit, and the GiST exclusion constraint
 * is the final authority: if someone takes the destination between this list
 * loading and the customer tapping, the move is refused and the original
 * appointment is untouched. That failure is surfaced here as "just taken",
 * because it is a normal thing to happen and not an error the person caused.
 *
 * SINCE LOT E, A MOVE PRESERVES THE STATUS. `reschedule_appointment` keeps a
 * confirmed appointment confirmed and a legacy pending one pending — it does
 * not send a confirmed booking back for re-approval. The copy here used to say
 * "The shop confirms the new time, just like the original booking" and the
 * button said "Request new time"; both described LOT C and are now false, in
 * the same way the booking success screen was. They now say what the database
 * actually does.
 *
 * The date and time controls are the SAME ones the booking flow uses — a date
 * strip and slots grouped by part of day — because moving an appointment is
 * the same act as making one, and it was previously a bare `<input type=date>`
 * over a flat grid of every slot in the day.
 */
export function RescheduleDialog({
  open,
  onOpenChange,
  appointment,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: {
    id: string
    organizationSlug: string
    locationId: string
    barberId: string | null
    serviceId: string | null
    /** The SHOP's zone. Every time shown here is wall-clock in it. */
    locationTimezone: string
    /** Legacy pending rows still exist and DO await the shop's answer. */
    isAwaitingApproval?: boolean
  }
  onDone?: () => void
}) {
  const { t } = useTranslation('customer-app')
  const reschedule = useRescheduleAppointment(undefined)

  const timeZone = appointment.locationTimezone
  // Tomorrow, in the shop's zone — not in the device's, where "tomorrow" can
  // be a different date.
  const [date, setDate] = useState(() => addDays(todayInZone(timeZone), 1))
  const [selected, setSelected] = useState<string | null>(null)
  const [part, setPart] = useState<PartOfDay>('morning')
  const [error, setError] = useState<string | null>(null)

  const slotsQuery = usePublicAvailableSlots(
    appointment.organizationSlug,
    appointment.locationId,
    appointment.barberId ?? undefined,
    appointment.serviceId ?? undefined,
    date,
  )

  const slots = useMemo(() => slotsQuery.data ?? [], [slotsQuery.data])

  // Open on a period that actually has something in it, once per day chosen —
  // not on every background refetch, which would move the customer's tab
  // underneath them mid-choice.
  const settledFor = useRef<string | null>(null)
  useEffect(() => {
    if (slots.length === 0 || settledFor.current === date) return
    settledFor.current = date
    setPart(firstPopulatedPart(slots, timeZone))
  }, [slots, date, timeZone])

  async function submit() {
    if (!selected) return
    setError(null)
    try {
      await reschedule.mutateAsync({ appointmentId: appointment.id, startsAt: selected })
      onOpenChange(false)
      setSelected(null)
      onDone?.()
    } catch (cause) {
      const key = bookingErrorKey(cause)
      setError(
        key === 'requests.errors.slotTaken'
          ? t('reschedule.slotTaken')
          : key === 'requests.errors.notReschedulable'
            ? t('reschedule.notAllowed')
            : t('reschedule.failed'),
      )
      // The destination is gone, so the list on screen is stale.
      void slotsQuery.refetch()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('reschedule.title')}</DialogTitle>
          <DialogDescription>{t('reschedule.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <DateStrip
            value={date}
            timeZone={timeZone}
            onChange={(next) => {
              setDate(next)
              setSelected(null)
            }}
          />

          {error ? <Alert variant="error">{error}</Alert> : null}

          {slotsQuery.isPending ? (
            <div className="flex flex-col gap-3" aria-hidden="true">
              <Skeleton className="h-11 w-full rounded-lg" />
              <Skeleton className="h-28 w-full rounded-lg" />
            </div>
          ) : slots.length === 0 ? (
            <EmptyState icon={CalendarX} title={t('reschedule.noSlotsTitle')} description={t('reschedule.noSlotsBody')} />
          ) : (
            <TimeSlotGrid
              slots={slots}
              value={selected}
              onChange={setSelected}
              timeZone={timeZone}
              part={part}
              onPartChange={setPart}
            />
          )}

          {/* True either way: a confirmed appointment stays confirmed, and a
              legacy pending one is still waiting on the shop. */}
          <p className="text-sm text-ink-500">
            {appointment.isAwaitingApproval ? t('reschedule.needsConfirmation') : t('reschedule.staysConfirmed')}
          </p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t('reschedule.cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!selected} isLoading={reschedule.isPending}>
            {appointment.isAwaitingApproval ? t('reschedule.submit') : t('reschedule.submitConfirmed')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
