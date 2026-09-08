import { Pressable, StyleSheet, View } from 'react-native'
import { FuText } from '@/shared/ui/Text'
import { color, radius, spacing } from '@/shared/theme/tokens'

/**
 * Une option sélectionnable (choix unique) — carte à rayon carte, cible
 * ≥ 44 px, état dit par la bordure ET le point (jamais la couleur seule).
 */
export function OptionRow({
  label,
  selected,
  onPress,
}: {
  label: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.option, selected && styles.optionSelected]}
    >
      <FuText variant={selected ? 'bodyMedium' : 'body'}>{label}</FuText>
      <View style={[styles.optionDot, selected && styles.optionDotSelected]} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing(4),
    borderRadius: radius.card,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.border,
  },
  optionSelected: { borderColor: color.accent, backgroundColor: color.accentSoft },
  optionDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: color.borderStrong,
  },
  optionDotSelected: { borderWidth: 6, borderColor: color.accent, backgroundColor: color.surface },
})
