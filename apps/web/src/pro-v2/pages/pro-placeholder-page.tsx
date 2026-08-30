import { useTranslation } from 'react-i18next'
import { Notice } from '@/customer-v2/ui/notice'

/**
 * Stand-in for a pro surface whose lot has not run yet. Names the lot rather
 * than pretending, exactly like the customer placeholders did — and is
 * deleted from the route table the moment the real page lands.
 */
export function ProPlaceholderPage({ lot }: { lot: string }) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto max-w-[30rem]">
      <Notice
        tone="empty"
        title={t('app:v2pro.placeholder.title')}
        body={t('app:v2pro.placeholder.body', { lot })}
        actionLabel={null}
        onAction={null}
      />
    </div>
  )
}
