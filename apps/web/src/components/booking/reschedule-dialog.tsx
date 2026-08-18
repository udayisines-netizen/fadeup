import { useState } from 'react'
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
import { TextField } from '@/components/ui/text-field'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/cn'
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
 * A CUSTOMER's move returns the appointment to pending — the shop is the
 * authority on its own diary, exactly as it is for the original booking — and
 * the copy says so rather than implying the new time is agreed.
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
  }
  onDone?: () => void
}) {
  const { t } = useTranslation('customer-app')
  const reschedule = useRescheduleAppointment(undefined)

  const [date, setDate] = useState(() => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10))
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const slotsQuery = usePublicAvailableSlots(
    appointment.organizationSlug,
    appointment.locationId,
    appointment.barberId ?? undefined,
    appointment.serviceId ?? undefined,
    date,
  )

  const slots = slotsQuery.data ?? []

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
          <TextField
            label={t('reschedule.dateLabel')}
            type="date"
            value={date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => {
              setDate(event.target.value)
              setSelected(null)
            }}
          />

          {error ? <Alert variant="error">{error}</Alert> : null}

          {slotsQuery.isPending ? (
            <div className="grid grid-cols-3 gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-11 w-full" />
              ))}
            </div>
          ) : slots.length === 0 ? (
            <EmptyState icon={CalendarX} title={t('reschedule.noSlotsTitle')} description={t('reschedule.noSlotsBody')} />
          ) : (
            <div
              role="radiogroup"
              aria-label={t('reschedule.slotsLabel')}
              // Three across on the narrowest phone keeps every target well
              // past 44px while still showing a usable number of times.
              className="grid grid-cols-3 gap-2 sm:grid-cols-4"
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
                    })}
                  </button>
                )
              })}
            </div>
          )}

          <p className="text-sm text-ink-500">{t('reschedule.needsConfirmation')}</p>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="secondary">
              {t('reschedule.cancel')}
            </Button>
          </DialogClose>
          <Button type="button" onClick={submit} disabled={!selected} isLoading={reschedule.isPending}>
            {t('reschedule.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
