import { useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { color, radius, spacing } from '@/shared/theme/tokens'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'

/**
 * La bande de jours du tunnel — 90 jours (MASTER_SPEC §6), défilement
 * horizontal natif, mobile d'abord.
 *
 * Proposer un JOUR n'affirme AUCUNE disponibilité : tous les jours sont
 * cliquables, c'est `get_public_available_slots` qui répond, jour par jour.
 * Un jour sans créneau affiche un état vide honnête, pas un jour grisé —
 * griser voudrait dire qu'on sait, et on ne sait pas avant d'avoir demandé.
 *
 * Les libellés se calculent dans le fuseau du LIEU (les jours d'un salon de
 * Tokyo ne sont pas ceux de Paris).
 */
export function DayStrip({
  days,
  value,
  onChange,
  timeZone,
}: {
  /** AAAA-MM-JJ, fuseau du lieu (`bookableDays`). */
  days: readonly string[]
  value: string | null
  onChange: (day: string) => void
  timeZone: string
}) {
  const { t, i18n } = useTranslation('v2')

  const labels = useMemo(() => {
    const weekday = new Intl.DateTimeFormat(i18n.language, { timeZone, weekday: 'short' })
    const dayNum = new Intl.DateTimeFormat(i18n.language, { timeZone, day: 'numeric' })
    const month = new Intl.DateTimeFormat(i18n.language, { timeZone, month: 'short' })
    return days.map((day, index) => {
      // Midi UTC du jour civil : évite tout basculement de date au formatage.
      const at = new Date(`${day}T12:00:00Z`)
      return {
        day,
        top: index === 0 ? t('booking.slots.today') : index === 1 ? t('booking.slots.tomorrow') : weekday.format(at),
        num: dayNum.format(at),
        month: month.format(at),
      }
    })
  }, [days, i18n.language, t, timeZone])

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel={t('booking.slots.pickDay')}
      contentContainerStyle={styles.strip}
    >
      {labels.map(({ day, top, num, month }) => {
        const selected = value === day
        return (
          <Pressable
            key={day}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${top} ${num} ${month}`}
            onPress={() => onChange(day)}
            style={({ pressed }) => [styles.day, selected && styles.daySelected, pressed && styles.pressed]}
          >
            <FuText variant="badge" tone="secondary">
              {top}
            </FuText>
            <MonoText size="base" weight="medium">
              {num}
            </MonoText>
            <FuText variant="badge" tone="secondary">
              {month}
            </FuText>
          </Pressable>
        )
      })}
      {/* Un peu d'air en fin de bande : le dernier jour ne colle pas au bord. */}
      <View style={styles.tail} />
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  strip: { gap: spacing(2), paddingVertical: spacing(0.5) },
  day: {
    minWidth: 60,
    minHeight: 68,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(2),
    paddingVertical: spacing(1.5),
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  daySelected: { borderColor: color.accent, backgroundColor: color.accentSoft },
  pressed: { opacity: 0.7 },
  tail: { width: spacing(2) },
})
