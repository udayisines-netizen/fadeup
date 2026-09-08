import { useTranslation } from 'react-i18next'
import { PlaceholderScreen } from '@/shared/ui/PlaceholderScreen'

/** Placeholder honnête — les réservations sont construites par M1b. */
export default function BookingsTab() {
  const { t } = useTranslation('v2')
  return (
    <PlaceholderScreen
      icon="calendar-outline"
      title={t('mobile.placeholder.bookings.title')}
      body={t('mobile.placeholder.bookings.body')}
    />
  )
}
