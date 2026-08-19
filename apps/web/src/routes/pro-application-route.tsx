import { lazy, Suspense } from 'react'
import { PageSpinner } from '@/components/ui/spinner'
import { useTranslation } from 'react-i18next'

// RequireAuth stays outside the dynamic import boundary — same reasoning as
// onboarding-route.tsx and workspace-selector-route.tsx.
const ProApplicationPage = lazy(() =>
  import('@/pages/pro-application-page').then((module) => ({ default: module.ProApplicationPage })),
)

export function ProApplicationRoute() {
  const { t } = useTranslation()
  return (
    <Suspense fallback={<PageSpinner label={t('common:state.loading')} />}>
      <ProApplicationPage />
    </Suspense>
  )
}
