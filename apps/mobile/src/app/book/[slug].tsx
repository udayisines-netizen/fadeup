import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native'
import { EmptyState } from '@/shared/ui/EmptyState'
import { color } from '@/shared/theme/tokens'

/**
 * Le CTA Réserver mène ICI tant que le tunnel n'existe pas (M1b) —
 * placeholder HONNÊTE qui nomme son lot et ramène, jamais un bouton qui ne
 * fait rien (M1a §9).
 */
export default function BookPlaceholder() {
  const { t } = useTranslation('v2')
  const router = useRouter()
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <EmptyState
        title={t('mobile.placeholder.booking.title')}
        body={t('mobile.placeholder.booking.body')}
        actionLabel={t('mobile.placeholder.back')}
        onAction={() => router.back()}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas, justifyContent: 'center' },
})
