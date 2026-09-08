import { StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { formatDateTime } from '@/shared/lib/format'
import { isExpired, remainingParts } from '@/shared/lib/deadline'
import { color, radius, shadow, spacing } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import type { MyAppointment } from '@/features/booking/api/booking'
import { countdownText } from '@/features/booking/lib/requestCopy'

/**
 * P1PRO §5 — le salon ne peut pas assurer l'horaire demandé et en PROPOSE un
 * autre. La ligne reste `pending` : ce n'est ni une réservation ni un refus,
 * c'est une question posée au client — donc en TÊTE de « Mes réservations ».
 *
 * Ce qui est dit, dans cet ordre : l'horaire DEMANDÉ barré
 * (`counter_original_starts_at`, jamais réécrit), l'horaire PROPOSÉ en
 * évidence (`starts_at`, le créneau réellement retenu), le mot du salon,
 * l'échéance qui défile (elle a REDÉMARRÉ : le salon vient de montrer sa
 * volonté), puis Accepter (primaire) / Refuser (secondaire).
 *
 * Refuser CLÔT la demande : l'horaire d'origine ne revit pas — le salon
 * avait déjà dit non. C'est dit AVANT le geste, jamais découvert après.
 *
 * Zéro optimisme : rien ne bascule tant que la base n'a pas répondu.
 */
export function CounterProposalCard({
  row,
  now,
  accepting,
  acceptFailed,
  onAccept,
  onDecline,
  declineDisabled,
}: {
  row: MyAppointment
  now: Date
  accepting: boolean
  acceptFailed: boolean
  onAccept: () => void
  onDecline: () => void
  declineDisabled: boolean
}) {
  const { t, i18n } = useTranslation('v2')
  const timezone = row.location_timezone

  const expired = row.expires_at !== null && isExpired(row.expires_at, now)
  const countdown = expired
    ? t('booking.bookings.resolutionExpired')
    : countdownText(t, row.expires_at !== null ? remainingParts(row.expires_at, now) : null)

  return (
    <View style={[styles.card, shadow.card]}>
      <FuText variant="sm" tone="secondary">
        {t('booking.counter.intro', { name: row.organization_name })}
      </FuText>
      <FuText variant="bodySemibold">
        {row.service_name}
        {row.barber_display_name ? ` · ${row.barber_display_name}` : ''}
      </FuText>

      <View style={styles.slots}>
        {row.counter_original_starts_at ? (
          <View style={styles.slotLine}>
            <FuText variant="sm" tone="secondary">
              {t('booking.counter.requestedLabel')}
            </FuText>
            <MonoText size="sm" tone="secondary" style={styles.struck}>
              {formatDateTime(row.counter_original_starts_at, timezone, 'datetime', i18n.language)}
            </MonoText>
          </View>
        ) : null}
        <View style={styles.slotLine}>
          <FuText variant="sm" tone="secondary">
            {t('booking.counter.proposedLabel')}
          </FuText>
          <MonoText size="base" weight="medium">
            {formatDateTime(row.starts_at, timezone, 'datetime', i18n.language)}
          </MonoText>
        </View>
      </View>

      {row.counter_note ? (
        <View style={styles.note}>
          <FuText variant="sm" tone="secondary">
            {row.counter_note}
          </FuText>
        </View>
      ) : null}

      {countdown ? (
        <MonoText size="sm" tone="secondary">
          {countdown}
        </MonoText>
      ) : null}

      <View style={styles.actions}>
        <View style={styles.accept}>
          <Button label={t('booking.counter.accept')} fullWidth loading={accepting} onPress={onAccept} />
        </View>
        <Button
          label={t('booking.counter.decline')}
          variant="secondary"
          disabled={declineDisabled}
          onPress={onDecline}
        />
      </View>

      {acceptFailed ? (
        <FuText variant="sm" tone="danger" accessibilityRole="alert">
          {t('booking.counter.acceptError')}
        </FuText>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: spacing(2),
    padding: spacing(4),
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.borderStrong,
    backgroundColor: color.surface,
  },
  slots: { gap: spacing(1), marginTop: spacing(1) },
  slotLine: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), flexWrap: 'wrap' },
  struck: { textDecorationLine: 'line-through' },
  note: {
    padding: spacing(3),
    borderRadius: radius.control,
    backgroundColor: color.surfaceSubtle,
  },
  actions: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(1) },
  accept: { flex: 2 },
})
