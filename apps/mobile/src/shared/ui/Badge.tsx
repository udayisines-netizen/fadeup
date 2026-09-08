import { StyleSheet, View, type ViewProps } from 'react-native'
import { FuText } from '@/shared/ui/Text'
import { color, radius } from '@/shared/theme/tokens'

/** Badge d'état — le seul texte autorisé à 12 px. */
export interface BadgeProps extends ViewProps {
  label: string
  variant?: 'brand' | 'neutral'
}

export function Badge({ label, variant = 'neutral', style, ...rest }: BadgeProps) {
  return (
    <View
      {...rest}
      style={[styles.base, variant === 'brand' ? styles.brand : styles.neutral, style]}
    >
      <FuText variant="badge" style={{ color: variant === 'brand' ? color.accentText : color.textSecondary }}>
        {label}
      </FuText>
    </View>
  )
}

/**
 * « Disponible maintenant » — le badge qui PRIME sur ouvert/fermé (D1 §4),
 * avec son point live. Rendu UNIQUEMENT depuis un état réel dérivé de
 * get_public_service_state + horaires serveur — jamais depuis une intuition.
 */
export function LiveBadge({ label }: { label: string }) {
  return (
    <View style={[styles.base, styles.brand, styles.liveRow]}>
      <View style={styles.liveDot} accessibilityElementsHidden />
      <FuText variant="badge" style={{ color: color.accentText }}>
        {label}
      </FuText>
    </View>
  )
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    borderRadius: radius.control,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  brand: { backgroundColor: color.accentSoft },
  neutral: { backgroundColor: color.surfaceSubtle },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: color.accent,
  },
})
