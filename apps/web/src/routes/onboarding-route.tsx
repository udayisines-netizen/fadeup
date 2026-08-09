import { lazy, Suspense } from 'react'
import { PageSpinner } from '@/components/ui/spinner'

// RequireAuth needs to stay outside the dynamic import boundary (so an
// unauthenticated visitor redirects instantly, without waiting on a chunk
// load), so /onboarding uses React.lazy + Suspense directly rather than the
// route-level `lazy:` loader used for the other routes in router.tsx.
const OnboardingPage = lazy(() =>
  import('@/pages/onboarding-page').then((module) => ({ default: module.OnboardingPage })),
)

export function OnboardingRoute() {
  return (
    <Suspense fallback={<PageSpinner label="Loading" />}>
      <OnboardingPage />
    </Suspense>
  )
}
