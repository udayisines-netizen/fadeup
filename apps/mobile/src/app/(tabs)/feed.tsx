import { useTranslation } from 'react-i18next'
import { PlaceholderScreen } from '@/shared/ui/PlaceholderScreen'

/** Placeholder honnête — le feed est construit par M1b. */
export default function FeedTab() {
  const { t } = useTranslation('v2')
  return (
    <PlaceholderScreen
      icon="albums-outline"
      title={t('mobile.placeholder.feed.title')}
      body={t('mobile.placeholder.feed.body')}
    />
  )
}
