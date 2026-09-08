import { useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'

import { useNow } from '@/shared/hooks/useNow'
import { formatDateTime } from '@/shared/lib/format'
import { isExpired, remainingParts } from '@/shared/lib/deadline'
import { color, radius, spacing } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { Money } from '@/shared/ui/Money'
import { Sheet } from '@/shared/ui/Sheet'
import { Skeleton } from '@/shared/ui/Skeleton'
import { StateBadge } from '@/shared/ui/StateBadge'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import {
  BookingRefusedError,
  useAvailableSlots,
  useCancelAppointment,
  useRescheduleAppointment,
  type MyAppointment,
} from '@/features/booking/api/booking'
import { bookingRefusalMessageKey, type BookingRefusalCode } from '@/features/booking/lib/refusals'
import { cancelPlan, isActionable, isPendingRequest } from '@/features/booking/lib/partition'
import { countdownText } from '@/features/booking/lib/requestCopy'
import { bookableDays, dateInTimezone, firstPopulatedPart, type PartOfDay } from '@/features/booking/lib/slots'
import { BookingRow, CardList } from '@/features/booking/components/BookingCard'
import { DayStrip } from '@/features/booking/components/DayStrip'
import { TimeSlotGrid } from '@/features/booking/components/TimeSlotGrid'

/**
 * Le détail d'une réservation ou d'une demande, et ses deux gestes (F4 §7) :
 *
 * - ANNULATION : libre jusqu'à 12 h avant ; plus tard elle reste possible et
 *   sans frais (aucun moyen de paiement n'existe), simplement dite
 *   « tardive » AVANT le geste. Une DEMANDE se retire — elle ne retenait
 *   rien du côté du client, et le vocabulaire le dit.
 * - REPORT en libre-service : mêmes créneaux réels que le tunnel, même
 *   professionnel, même service — le serveur revalide tout, aucun optimisme.
 *
 * Écart natif ASSUMÉ au web : la confirmation d'annulation ne s'ouvre PAS
 * dans une seconde fenêtre modale (deux `Modal` imbriqués sont fragiles sur
 * iOS) — elle prend la place des actions DANS la feuille, ce qui garde
 * l'avertissement tardif et le geste dans le même champ de vision.
 */
export function BookingDetailSheet({
  appointment,
  open,
  onClose,
  onFindAlternative,
}: {
  appointment: MyAppointment
  open: boolean
  onClose: () => void
  onFindAlternative: () => void
}) {
  const { t, i18n } = useTranslation('v2')
  const now = useNow(30_000)
  const cancel = useCancelAppointment()
  const reschedule = useRescheduleAppointment()

  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [rescheduling, setRescheduling] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  const [part, setPart] = useState<PartOfDay | null>(null)
  const [refusal, setRefusal] = useState<BookingRefusalCode | null>(null)
  const [done, setDone] = useState<'cancelled' | 'rescheduled' | null>(null)

  const request = isPendingRequest(appointment)
  const requestExpired = request && appointment.expires_at !== null && isExpired(appointment.expires_at, now)
  const actionable = isActionable(appointment, now)
  const plan = cancelPlan(appointment, now)

  const timezone = appointment.location_timezone
  const days = useMemo(() => bookableDays(timezone, now), [timezone, now])
  const activeDay = day ?? dateInTimezone(now, timezone)
  const slots = useAvailableSlots(
    rescheduling ? appointment.organization_slug : null,
    appointment.location_id,
    appointment.barber_id,
    appointment.service_id,
    rescheduling ? activeDay : null,
  )
  const slotRows = slots.data ?? []

  const remaining =
    request && !requestExpired && appointment.expires_at ? remainingParts(appointment.expires_at, now) : null

  const runCancel = async () => {
    setRefusal(null)
    try {
      await cancel.mutateAsync(appointment.id)
      setConfirmingCancel(false)
      setDone('cancelled')
    } catch (error) {
      setConfirmingCancel(false)
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
      onClose={onClose}
      title={request ? t('booking.bookings.requestDetailsTitle') : t('booking.bookings.detailsTitle')}
    >
      <View style={styles.body}>
        <FuText variant="title">
          {request ? t('booking.bookings.requestDetailsTitle') : t('booking.bookings.detailsTitle')}
        </FuText>

        {done === 'cancelled' ? (
          <FuText variant="body" accessibilityRole="alert">
            {t('booking.bookings.cancelDone')}
          </FuText>
        ) : done === 'rescheduled' ? (
          <FuText variant="body" accessibilityRole="alert">
            {t('booking.bookings.rescheduleDone')}
          </FuText>
        ) : null}

        <CardList>
          <BookingRow title={appointment.service_name} subtitle={t('booking.summary.service')} />
          <BookingRow title={appointment.barber_display_name} subtitle={t('booking.summary.professional')} />
          <BookingRow
            title={
              <MonoText size="base" weight="medium">
                {formatDateTime(appointment.starts_at, timezone, 'datetime', i18n.language)}
              </MonoText>
            }
            subtitle={t('booking.summary.when')}
          />
          {appointment.price_cents !== null ? (
            <BookingRow
              title={<Money cents={appointment.price_cents} currency={appointment.currency} size="base" weight="medium" />}
              subtitle={`${t('booking.summary.price')} — ${t('booking.summary.payOnSite')}`}
            />
          ) : null}
        </CardList>

        {request && !requestExpired ? (
          <View style={styles.deadline}>
            <StateBadge state="pending-request" />
            {appointment.expires_at ? (
              <FuText variant="sm" tone="secondary">
                {t('booking.request.deadlineLabel')}{' '}
                {formatDateTime(appointment.expires_at, timezone, 'datetime', i18n.language)}
              </FuText>
            ) : null}
            {remaining ? (
              <MonoText size="sm" weight="medium">
                {countdownText(t, remaining)}
              </MonoText>
            ) : null}
          </View>
        ) : null}

        {requestExpired ? (
          <View style={styles.expired}>
            <FuText variant="bodyMedium">{t('booking.request.expiredTitle')}</FuText>
            <FuText variant="sm" tone="secondary">
              {t('booking.request.expiredBody')}
            </FuText>
            <Button label={t('booking.request.findAlternative')} fullWidth onPress={onFindAlternative} />
          </View>
        ) : null}

        {refusal ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Ionicons name="information-circle-outline" size={16} color={color.textPrimary} style={styles.noticeIcon} />
            <FuText variant="sm" style={styles.noticeText}>
              {t(bookingRefusalMessageKey(refusal))}
            </FuText>
          </View>
        ) : null}

        {actionable && done === null && !requestExpired ? (
          confirmingCancel ? (
            <View style={styles.confirm}>
              <FuText variant="bodyMedium">{t(plan.titleKey)}</FuText>
              <FuText variant="sm" tone="secondary">
                {t(plan.bodyKey)}
              </FuText>
              {/* L'avertissement tardif est dit AVANT le geste, jamais après. */}
              {plan.lateWarning ? (
                <View style={styles.notice}>
                  <Ionicons name="information-circle-outline" size={16} color={color.textPrimary} style={styles.noticeIcon} />
                  <FuText variant="sm" style={styles.noticeText}>
                    {t('booking.bookings.cancelLateWarning')}
                  </FuText>
                </View>
              ) : null}
              <View style={styles.confirmActions}>
                <Button
                  label={t('booking.bookings.confirmCancel')}
                  variant="secondary"
                  loading={cancel.isPending}
                  onPress={() => void runCancel()}
                />
                <Button
                  label={t('booking.bookings.keep')}
                  variant="ghost"
                  disabled={cancel.isPending}
                  onPress={() => setConfirmingCancel(false)}
                />
              </View>
            </View>
          ) : rescheduling ? (
            <View style={styles.reschedule}>
              <FuText variant="bodyMedium">{t('booking.bookings.rescheduleTitle')}</FuText>
              <DayStrip days={days} value={activeDay} onChange={setDay} timeZone={timezone} />
              {slots.isLoading ? (
                <View style={styles.skeletons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Skeleton height={44} />
                  <Skeleton height={44} width="70%" />
                </View>
              ) : slots.isError ? (
                /* Une panne n'est pas une absence de créneau — on le dit. */
                <View style={styles.loadFailed}>
                  <FuText variant="bodyMedium">{t('mobile.bookingx.loadFailedTitle')}</FuText>
                  <FuText variant="sm" tone="secondary">
                    {t('mobile.bookingx.loadFailedBody')}
                  </FuText>
                  <Button label={t('common.action.retry')} variant="secondary" onPress={() => void slots.refetch()} />
                </View>
              ) : slotRows.length === 0 ? (
                <View style={styles.emptyDay}>
                  <FuText variant="sm" tone="secondary" style={styles.center}>
                    {t('booking.slots.noneDay')}
                  </FuText>
                </View>
              ) : (
                <TimeSlotGrid
                  slots={slotRows}
                  value={null}
                  onChange={(slotStart) => void runReschedule(slotStart)}
                  timeZone={timezone}
                  part={part ?? firstPopulatedPart(slotRows, timezone)}
                  onPartChange={setPart}
                />
              )}
              <Button
                label={t('booking.flow.back')}
                variant="ghost"
                fullWidth
                disabled={reschedule.isPending}
                onPress={() => setRescheduling(false)}
              />
            </View>
          ) : (
            <View style={styles.actions}>
              <Button
                label={t('booking.bookings.reschedule')}
                variant="secondary"
                fullWidth
                onPress={() => setRescheduling(true)}
              />
              <Button
                label={t(plan.actionKey)}
                variant="ghost"
                fullWidth
                onPress={() => setConfirmingCancel(true)}
              />
            </View>
          )
        ) : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing(4), paddingBottom: spacing(2) },
  deadline: { gap: spacing(1), alignItems: 'flex-start' },
  expired: { gap: spacing(2) },
  actions: { gap: spacing(2) },
  confirm: {
    gap: spacing(2),
    padding: spacing(4),
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  confirmActions: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(1) },
  reschedule: { gap: spacing(3) },
  loadFailed: { gap: spacing(2), alignItems: 'flex-start' },
  skeletons: { gap: spacing(2) },
  emptyDay: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    borderRadius: radius.card,
    paddingVertical: spacing(6),
  },
  notice: { flexDirection: 'row', gap: spacing(2) },
  noticeIcon: { marginTop: 3 },
  noticeText: { flex: 1 },
  center: { textAlign: 'center' },
})
