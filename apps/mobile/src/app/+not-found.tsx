import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SafeAreaView } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native'
import { EmptyState } from '@/shared/ui/EmptyState'
import { color } from '@/shared/theme/tokens'

export default function NotFound() {
  const { t } = useTranslation('v2')
  const router = useRouter()
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <EmptyState
        title={t('mobile.notFound.title')}
        body={t('mobile.notFound.body')}
        actionLabel={t('mobile.notFound.home')}
        onAction={() => router.replace('/')}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas, justifyContent: 'center' },
})
