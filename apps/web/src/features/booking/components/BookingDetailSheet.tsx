import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNow } from '@/shared/hooks/useNow'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Dialog } from '@/shared/ui/Dialog'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { IconInfo } from '@/shared/ui/icons'
import {
  useAvailableSlots,
  useCancelAppointment,
  useRescheduleAppointment,
  BookingRefusedError,
  type MyAppointment,
} from '@/features/booking/api/booking'
import { isExpired, isLateCancellation, remainingParts } from '@/features/booking/lib/deadline'
import { bookingRefusalMessageKey, type BookingRefusalCode } from '@/features/booking/lib/refusals'
import { bookableDays, dateInTimezone, firstPopulatedPart, type PartOfDay } from '@/features/booking/lib/slots'
import { usePublicPlatformSettings } from '@/features/booking/api/platformSettings'
import { DayStrip } from '@/features/booking/components/DayStrip'
import { TimeSlotGrid } from '@/features/booking/components/TimeSlotGrid'

/**
 * Le détail d'une réservation ou d'une demande, et ses deux gestes (F4 §7) :
 *
 * - ANNULATION : libre jusqu'à 12 h avant ; plus tard elle reste possible et
 *   sans frais (aucun moyen de paiement n'existe), simplement dite « tardive »
 *   AVANT le geste. La base historise (`cancelled_by_customer`, décidé à
 *   l'instant du geste).
 * - REPORT en libre-service : mêmes créneaux réels que le tunnel, même
 *   barber, même service — le serveur revalide tout, aucun optimisme.
 */
export function BookingDetailSheet({
  appointment,
  open,
  onOpenChange,
  onFindAlternative,
}: {
  appointment: MyAppointment
  open: boolean
  onOpenChange: (open: boolean) => void
  onFindAlternative: () => void
}) {
  const { t } = useTranslation('v2')
  const now = useNow(30_000)
  const cancel = useCancelAppointment()
  const reschedule = useRescheduleAppointment()

  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  const [part, setPart] = useState<PartOfDay | null>(null)
  const [refusal, setRefusal] = useState<BookingRefusalCode | null>(null)
  const [done, setDone] = useState<'cancelled' | 'rescheduled' | null>(null)

  const isRequest = appointment.status === 'pending' && appointment.resolution === null
  const requestExpired = isRequest && appointment.expires_at !== null && isExpired(appointment.expires_at, now)
  const actionable =
    (appointment.status === 'pending' || appointment.status === 'confirmed') &&
    appointment.resolution === null &&
    Date.parse(appointment.starts_at) > now.getTime()
  // PLAT-3 — l'avertissement « annulation tardive » et l'horizon de report
  // suivent tous deux le réglage plateforme. Rien ne REFUSE une annulation
  // tardive, ici ni côté serveur : le produit l'autorise et la consigne.
  const platformSettings = usePublicPlatformSettings()
  const late = isLateCancellation(appointment.starts_at, now, platformSettings.freeCancelHours)

  const timezone = appointment.location_timezone
  const days = useMemo(
    () => bookableDays(timezone, now, platformSettings.bookingWindowDays),
    [timezone, now, platformSettings.bookingWindowDays],
  )
  const activeDay = day ?? dateInTimezone(now, timezone)
  const slots = useAvailableSlots(
    rescheduling ? appointment.organization_slug : null,
    appointment.location_id,
    appointment.barber_id,
    appointment.service_id,
    rescheduling ? activeDay : null,
  )

  const remaining =
    isRequest && !requestExpired && appointment.expires_at ? remainingParts(appointment.expires_at, now) : null

  const runCancel = async () => {
    setRefusal(null)
    try {
      await cancel.mutateAsync(appointment.id)
      setConfirmCancelOpen(false)
      setDone('cancelled')
    } catch (error) {
      setConfirmCancelOpen(false)
      if (error instanceof BookingRefusedError) setRefusal(error.code)
      else throw error
    }
  }

  const runReschedule = async (slotStart: string) => {
    setRefusal(null)
    try {
      await reschedule.mutateAsync({ appointmentId: appointment.id, startsAt: slotStart })
      setRescheduling(false)
      setDone('rescheduled')
    } catch (error) {
      if (error instanceof BookingRefusedError) {
        setRefusal(error.code)
        void slots.refetch()
      } else {
        throw error
      }
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={isRequest ? t('booking.bookings.requestDetailsTitle') : t('booking.bookings.detailsTitle')}
    >
      <div className="flex flex-col gap-4" data-testid="booking-detail">
        {done === 'cancelled' ? (
          <p role="status" className="text-fu-base text-[var(--fu-text-primary)]">
            {t('booking.bookings.cancelDone')}
          </p>
        ) : done === 'rescheduled' ? (
          <p role="status" className="text-fu-base text-[var(--fu-text-primary)]">
            {t('booking.bookings.rescheduleDone')}
          </p>
        ) : null}

        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0">
          <Row title={appointment.service_name} subtitle={t('booking.summary.service')} />
          <Row title={appointment.barber_display_name} subtitle={t('booking.summary.professional')} />
          <Row
            title={<DateTime value={appointment.starts_at} timezone={timezone} format="datetime" />}
            subtitle={t('booking.summary.when')}
          />
          {appointment.price_cents !== null && (
            <Row
              title={<Money cents={appointment.price_cents} currency={appointment.currency} />}
              subtitle={`${t('booking.summary.price')} — ${t('booking.summary.payOnSite')}`}
            />
          )}
        </div>

        {isRequest && !requestExpired && (
          <div className="flex flex-col items-start gap-1">
            <StateBadge state="pending-request" />
            {appointment.expires_at && (
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">
                {t('booking.request.deadlineLabel')}{' '}
                <DateTime value={appointment.expires_at} timezone={timezone} format="datetime" />
              </p>
            )}
            {remaining && (
              <p className="font-fu-mono text-fu-sm tabular-nums text-[var(--fu-text-primary)]">
                {t('booking.request.expiresIn', {
                  time:
                    remaining.hours > 0
                      ? t('booking.request.hoursMinutes', { hours: remaining.hours, minutes: remaining.minutes })
                      : t('booking.request.minutesOnly', { minutes: remaining.minutes }),
                })}
              </p>
            )}
          </div>
        )}

        {requestExpired && (
          <div className="flex flex-col gap-2">
            <p className="text-fu-base text-[var(--fu-text-primary)]">{t('booking.request.expiredTitle')}</p>
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('booking.request.expiredBody')}</p>
            <Button variant="primary" onClick={onFindAlternative}>
              {t('booking.request.findAlternative')}
            </Button>
          </div>
        )}

        {refusal && (
          <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="detail-refusal">
            <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {t(bookingRefusalMessageKey(refusal))}
          </p>
        )}

        {actionable && done === null && !requestExpired && (
          <div className="flex flex-col gap-2">
            {rescheduling ? (
              <div className="flex flex-col gap-3" data-testid="reschedule-picker">
                <p className="text-fu-base font-medium text-[var(--fu-text-primary)]">
                  {t('booking.bookings.rescheduleTitle')}
                </p>
                <DayStrip
                  days={days}
                  value={activeDay}
                  onChange={(next) => setDay(next)}
                  timeZone={timezone}
                />
                {slots.isLoading ? (
                  <div className="grid grid-cols-3 gap-2" aria-hidden="true">
                    <SkeletonRect className="h-11" />
                    <SkeletonRect className="h-11" />
                    <SkeletonRect className="h-11" />
                  </div>
                ) : (slots.data ?? []).length === 0 ? (
                  <p className="rounded-[var(--radius-card)] border border-dashed border-[var(--fu-border)] px-4 py-6 text-center text-fu-sm text-[var(--fu-text-secondary)]">
                    {t('booking.slots.noneDay')}
                  </p>
                ) : (
                  <TimeSlotGrid
                    slots={slots.data ?? []}
                    value={null}
                    onChange={(slotStart) => void runReschedule(slotStart)}
                    timeZone={timezone}
                    part={part ?? firstPopulatedPart(slots.data ?? [], timezone)}
                    onPartChange={setPart}
                  />
                )}
                <Button variant="tertiary" onClick={() => setRescheduling(false)} disabled={reschedule.isPending}>
                  {t('booking.flow.back')}
                </Button>
              </div>
            ) : (
              <>
                <Button variant="secondary" onClick={() => setRescheduling(true)}>
                  {t('booking.bookings.reschedule')}
                </Button>
                <Button variant="tertiary" onClick={() => setConfirmCancelOpen(true)} loading={cancel.isPending}>
                  {isRequest ? t('booking.bookings.cancelRequest') : t('booking.bookings.cancel')}
                </Button>
              </>
            )}
          </div>
        )}

        <Dialog
          open={confirmCancelOpen}
          onOpenChange={setConfirmCancelOpen}
          title={isRequest ? t('booking.bookings.cancelRequestTitle') : t('booking.bookings.cancelTitle')}
          description={isRequest ? t('booking.bookings.cancelRequestBody') : t('booking.bookings.cancelBody')}
        >
          <div className="flex flex-col gap-3">
            {!isRequest && late && (
              <p className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="late-cancel-warning">
                <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {t('booking.bookings.cancelLateWarning')}
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => void runCancel()} loading={cancel.isPending}>
                {t('booking.bookings.confirmCancel')}
              </Button>
              <Button variant="tertiary" fullWidth onClick={() => setConfirmCancelOpen(false)}>
                {t('booking.bookings.keep')}
              </Button>
            </div>
          </div>
        </Dialog>
      </div>
    </Sheet>
  )
}
