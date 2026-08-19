import { lazy, Suspense } from 'react'
import { PageSpinner } from '@/components/ui/spinner'
import { useTranslation } from 'react-i18next'

// RequireAuth needs to stay outside the dynamic import boundary — see
// onboarding-route.tsx for the same reasoning.
const WorkspaceSelectorPage = lazy(() =>
  import('@/pages/workspace-selector-page').then((module) => ({ default: module.WorkspaceSelectorPage })),
)

export function WorkspaceSelectorRoute() {
  const { t } = useTranslation()
  return (
    <Suspense fallback={<PageSpinner label={t('common:state.loading')} />}>
      <WorkspaceSelectorPage />
    </Suspense>
  )
}
