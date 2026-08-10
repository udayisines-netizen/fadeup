import { lazy, Suspense } from 'react'
import { PageSpinner } from '@/components/ui/spinner'

// RequireAuth needs to stay outside the dynamic import boundary — see
// onboarding-route.tsx for the same reasoning.
const AppCustomerPage = lazy(() =>
  import('@/pages/app-customer-page').then((module) => ({ default: module.AppCustomerPage })),
)

export function AppCustomerRoute() {
  return (
    <Suspense fallback={<PageSpinner label="Loading" />}>
      <AppCustomerPage />
    </Suspense>
  )
}
