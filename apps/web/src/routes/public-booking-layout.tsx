import { Link, Outlet, useParams } from 'react-router-dom'
import { Container } from '@/components/ui/container'
import { usePublicOrganization } from '@/lib/queries/public-booking'
import { useTranslation } from 'react-i18next'

/**
 * Minimal chrome for the public, anonymous booking flow at `/s/:slug` — no
 * marketing nav, no session, no organization context provider. Deliberately
 * NOT `MarketingLayout` or `AppLayout`/`RequireAuth`: a customer lands here
 * directly from a shared link to complete one focused task, not to browse
 * the marketing site or an authenticated dashboard.
 *
 * Shares the `usePublicOrganization` query with `PublicBookingPage` (same
 * cache key, deduped by TanStack Query) purely to show the shop's name in
 * the header once it resolves — the page itself owns the "unknown slug"
 * empty state and every other piece of booking-flow logic.
 */
export function PublicBookingLayout() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const organizationQuery = usePublicOrganization(slug)

  return (
    <div className="flex min-h-svh flex-col bg-paper-50">
      <header className="border-b border-border bg-paper-0">
        <Container size="md" className="flex h-14 items-center justify-between">
          <Link to="/" className="text-sm font-semibold tracking-tight text-ink-950">
            {t('common:customerNav.fadeup')}
          </Link>
          {organizationQuery.data ? (
            <span className="truncate text-sm text-ink-500">{organizationQuery.data.name}</span>
          ) : null}
        </Container>
      </header>
      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  )
}
