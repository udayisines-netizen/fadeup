import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native'
import { EmptyState } from '@/shared/ui/EmptyState'
import { color } from '@/shared/theme/tokens'

/** « Rejoindre la file » mène ICI tant que la file n'existe pas (M1b). */
export default function QueuePlaceholder() {
  const { t } = useTranslation('v2')
  const router = useRouter()
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <EmptyState
        title={t('mobile.placeholder.queue.title')}
        body={t('mobile.placeholder.queue.body')}
        actionLabel={t('mobile.placeholder.back')}
        onAction={() => router.back()}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas, justifyContent: 'center' },
})
