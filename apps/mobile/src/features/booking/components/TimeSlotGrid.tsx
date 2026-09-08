import { useMemo } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { formatDateTime } from '@/shared/lib/format'
import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { FuText } from '@/shared/ui/Text'
import { MonoText } from '@/shared/ui/MonoText'
import { partOfDayFor, type PartOfDay } from '@/features/booking/lib/slots'
import type { PublicSlot } from '@/features/booking/api/booking'

/**
 * Choisir une heure sans dérouler quarante boutons. Un salon chargé au pas
 * de 15 minutes produit ~40 créneaux par jour : en grille plate c'est un mur.
 * Le découpage matin / après-midi / soir répond « y a-t-il quelque chose
 * après le travail ? » avant tout défilement.
 *
 * AUCUN créneau n'est fabriqué : `slots` vient de
 * `get_public_available_slots` telle quelle. **Un créneau indisponible
 * n'existe pas à l'écran** — il n'y a donc aucun bouton désactivé ici. Un
 * moment vide affiche `nonePart`, un jour vide `noneDay` (l'appelant).
 *
 * Le découpage se fait dans le fuseau du LIEU (un client de Paris qui
 * réserve à Tokyo voit le matin de Tokyo).
 */
export function TimeSlotGrid({
  slots,
  value,
  onChange,
  timeZone,
  part,
  onPartChange,
}: {
  slots: readonly PublicSlot[]
  value: string | null
  onChange: (slotStart: string) => void
  timeZone: string
  part: PartOfDay
  onPartChange: (part: PartOfDay) => void
}) {
  const { t, i18n } = useTranslation('v2')

  const byPart = useMemo(() => {
    const groups: Record<PartOfDay, PublicSlot[]> = { morning: [], afternoon: [], evening: [] }
    for (const slot of slots) groups[partOfDayFor(slot.slot_start, timeZone)].push(slot)
    return groups
  }, [slots, timeZone])

  const visible = byPart[part]

  return (
    <View style={styles.root}>
      {/* Contrôle segmenté natif — trois moments, un seul actif, l'état dit
          par la forme (fond plein) autant que par la couleur. */}
      <View
        accessibilityRole="tablist"
        accessibilityLabel={t('booking.slots.partOfDay')}
        style={styles.segments}
      >
        {(['morning', 'afternoon', 'evening'] as const).map((key) => {
          const active = key === part
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => onPartChange(key)}
              style={({ pressed }) => [styles.segment, active && styles.segmentActive, pressed && styles.pressed]}
            >
              <FuText variant={active ? 'smMedium' : 'sm'} tone={active ? 'primary' : 'secondary'}>
                {t(`booking.slots.${key}`)}
              </FuText>
            </Pressable>
          )
        })}
      </View>

      {visible.length === 0 ? (
        <View style={styles.empty}>
          <FuText variant="sm" tone="secondary" style={styles.center}>
            {t('booking.slots.nonePart')}
          </FuText>
        </View>
      ) : (
        <View accessibilityLabel={t('booking.slots.available')} style={styles.grid}>
          {visible.map((slot) => {
            const selected = value === slot.slot_start
            const time = formatDateTime(slot.slot_start, timeZone, 'time', i18n.language)
            return (
              <Pressable
                key={slot.slot_start}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={t('booking.slots.slotAria', { time })}
                onPress={() => onChange(slot.slot_start)}
                style={({ pressed }) => [styles.slot, selected && styles.slotSelected, pressed && styles.pressed]}
              >
                <MonoText size="sm" weight="medium">
                  {time}
                </MonoText>
              </Pressable>
            )
          })}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: spacing(3) },
  segments: {
    flexDirection: 'row',
    gap: spacing(1),
    padding: spacing(1),
    borderRadius: radius.control,
    backgroundColor: color.surfaceSubtle,
  },
  segment: {
    flex: 1,
    minHeight: touchTarget - 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control - 2,
  },
  segmentActive: { backgroundColor: color.surface },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  slot: {
    minWidth: 84,
    flexGrow: 1,
    flexBasis: '30%',
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.border,
    backgroundColor: color.surface,
  },
  slotSelected: { borderColor: color.accent, backgroundColor: color.accentSoft },
  pressed: { opacity: 0.7 },
  empty: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.border,
    borderRadius: radius.card,
    paddingVertical: spacing(6),
    paddingHorizontal: spacing(4),
  },
  center: { textAlign: 'center' },
})
