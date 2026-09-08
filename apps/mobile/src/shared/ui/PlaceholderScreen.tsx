import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Ionicons } from '@expo/vector-icons'
import { FuText } from '@/shared/ui/Text'
import { color, radius, spacing } from '@/shared/theme/tokens'

/**
 * Placeholder HONNÊTE (M1a §6) — un onglet non construit dit QUEL lot le
 * construira, jamais une page blanche, jamais une capacité mimée.
 */
export function PlaceholderScreen({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap
  title: string
  body: string
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.center}>
        <View style={styles.iconFrame}>
          <Ionicons name={icon} size={28} color={color.accentText} />
        </View>
        <FuText variant="title" style={styles.textCenter}>
          {title}
        </FuText>
        <FuText variant="sm" tone="secondary" style={styles.textCenter}>
          {body}
        </FuText>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(8),
    gap: spacing(2.5),
  },
  iconFrame: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    backgroundColor: color.surfaceBrand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(1),
  },
  textCenter: { textAlign: 'center' },
})
