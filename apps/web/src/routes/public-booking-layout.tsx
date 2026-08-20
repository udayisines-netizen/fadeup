import { Link, Outlet, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Container } from '@/components/ui/container'
import { FadeUpLockup } from '@/components/brand/fadeup-mark'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { usePublicOrganization } from '@/lib/queries/public-booking'

/**
 * Chrome for the public, anonymous surface at `/s/:slug/*` — no marketing
 * nav, no session, no organization context. Deliberately not the marketing or
 * app layout: a customer lands here from a shared link to complete one task.
 *
 * It carries a LANGUAGE SWITCHER, which it previously did not. This is the
 * one part of FadeUp reached by people who have never signed in, so the app's
 * language was chosen for them by GeoIP and their browser — a good guess, and
 * a guess. Somebody booking a Paris salon from a phone set to English had no
 * way to read the flow in French. Everything else here stays minimal on
 * purpose; a switcher is the exception because it is the only control that
 * makes the rest of the page usable at all.
 *
 * Shares `usePublicOrganization` with the pages below (same cache key, deduped
 * by TanStack Query) purely to show the shop's name once it resolves — the
 * pages own every piece of booking logic and every empty state.
 */
export function PublicBookingLayout() {
  const { t } = useTranslation()
  const { slug } = useParams<{ slug: string }>()
  const organizationQuery = usePublicOrganization(slug)

  return (
    <div className="flex min-h-svh flex-col bg-paper-50">
      <header className="border-b border-border bg-paper-0">
        <Container size="md" className="flex h-14 items-center gap-3">
          <Link
            to="/"
            aria-label="FadeUp"
            className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
          >
            <FadeUpLockup className="h-5 w-auto text-ink-950" />
          </Link>

          {organizationQuery.data ? (
            // Links to the shop's profile rather than sitting inert: from any
            // step of the booking, "who am I booking with?" is one tap away.
            <Link
              to={`/s/${organizationQuery.data.slug}/profile`}
              className="min-w-0 truncate rounded-md text-sm text-ink-500 underline-offset-2 hover:text-ink-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700"
            >
              {organizationQuery.data.name}
            </Link>
          ) : null}

          <div className="ms-auto shrink-0">
            <LanguageSwitcher />
          </div>
        </Container>
      </header>

      <main className="flex flex-1 flex-col">
        <Outlet />
      </main>

      <footer className="border-t border-border py-4">
        <Container size="md">
          <p className="text-center text-xs text-ink-500">{t('common:footer.poweredBy')}</p>
        </Container>
      </footer>
    </div>
  )
}
