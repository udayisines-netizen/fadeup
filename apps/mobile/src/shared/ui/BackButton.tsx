import { Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import { color, shadow, spacing, touchTarget } from '@/shared/theme/tokens'

/** Retour — par-dessus la bannière d'un profil, cible 44 px. */
export function BackButton({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation('v2')
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('common.action.back')}
      onPress={onPress}
      style={styles.back}
    >
      <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  back: {
    position: 'absolute',
    top: spacing(3),
    insetInlineStart: spacing(3),
    zIndex: 10,
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
})
