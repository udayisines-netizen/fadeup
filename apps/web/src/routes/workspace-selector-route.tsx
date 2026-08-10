import { lazy, Suspense } from 'react'
import { PageSpinner } from '@/components/ui/spinner'

// RequireAuth needs to stay outside the dynamic import boundary — see
// onboarding-route.tsx for the same reasoning.
const WorkspaceSelectorPage = lazy(() =>
  import('@/pages/workspace-selector-page').then((module) => ({ default: module.WorkspaceSelectorPage })),
)

export function WorkspaceSelectorRoute() {
  return (
    <Suspense fallback={<PageSpinner label="Loading" />}>
      <WorkspaceSelectorPage />
    </Suspense>
  )
}
