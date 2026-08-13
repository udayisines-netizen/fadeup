import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Compass, Sparkles } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Button, buttonVariants } from '@/components/ui/button'
import { ErrorState } from '@/components/ui/error-state'
import { PageSpinner } from '@/components/ui/spinner'

/**
 * /app/customer (index) — the contextual customer home. Priority order per
 * spec: active queue state > upcoming appointment > rebooking context >
 * discovery. Phase 3 only has the customer identity/onboarding piece wired
 * up yet (no appointments/favorites RPCs exist until Phase 4), so this is
 * intentionally the honest, minimal version — an onboarding nudge (if not
 * done) plus a Discover entry point, never a fabricated "no appointments"
 * dashboard pretending to have queue/appointment awareness it doesn't have
 * yet. Phase 4 replaces the body of this page with the real priority stack.
 */
export function CustomerHomePage() {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()
  const profileQuery = useMyCustomerProfile(user?.id)

  if (profileQuery.isPending) {
    return <PageSpinner label="Loading…" />
  }

  if (profileQuery.isError) {
    return (
      <Container size="sm" className="py-10">
        <ErrorState
          title="Couldn't load your profile"
          description={profileQuery.error.message}
          action={
            <Button variant="secondary" onClick={() => void profileQuery.refetch()}>
              Try again
            </Button>
          }
        />
      </Container>
    )
  }

  const needsOnboarding = !profileQuery.data?.onboardingCompletedAt

  return (
    <Container size="sm" className="flex flex-col gap-4 py-6">
      {needsOnboarding ? (
        <Card elevated className="flex items-start gap-3 p-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100 text-accent-700">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink-950">{t('home.onboardingPromptTitle')}</h2>
            <p className="mt-1 text-sm text-ink-500">{t('home.onboardingPromptDescription')}</p>
            <Link to="/app/customer/onboarding" className={buttonVariants({ size: 'sm' }, 'mt-3')}>
              {t('home.onboardingPromptCta')}
            </Link>
          </div>
        </Card>
      ) : (
        <p className="text-sm text-ink-500">{t('home.welcomeBack')}</p>
      )}

      <Card elevated className="p-6 text-center">
        <Compass className="mx-auto h-8 w-8 text-accent-600" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-semibold text-balance text-ink-950">{t('home.discoverTitle')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('home.discoverDescription')}</p>
        <Link to="/search" className={buttonVariants({ size: 'lg' }, 'mt-4 w-full')}>
          {t('home.discoverCta')}
        </Link>
      </Card>
    </Container>
  )
}
